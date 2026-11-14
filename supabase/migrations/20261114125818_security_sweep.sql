-- T-1103 · security sweep (#81). Three findings of the full-tree rls-reviewer pass, each fixed here and proven by
-- supabase/tests/app/99_security_sweep.test.sql.
--
-- 1. app.issue_certificate (BE-29, I03) checked membership, the grant, aal2 and the sum of open_actions only. A member
--    scoped to some families or markets could certify a product or market they cannot see, a report could be certified
--    for a market other than its own, and a market that is not_assessed, has unknown or blocked registration, or has
--    no product_nodes row at all summed to zero open findings and could be certified (non-negotiables 3 and 8).
--    Now, before anything is written: the product must be in the signer's scope (else the same P0002 as an unknown
--    report), the node in their market scope (else P0291, as with no grant), after the grant, the node the report's own
--    market when the report names one (22023), and after aal2, the market must exist and display Clear (P0293).
-- 2. app.certificates read policy had product scope only: a market-scoped member read every market's certificates.
--    It now also applies node_in_scope, as private.supersession_visible already does.
-- 3. storage policy member_upload_artwork checked the role on the workspace folder only, so an editor scoped to some
--    families could write objects under any product folder. It now requires private.can_edit_product on the product
--    folder, and that product to belong to the workspace folder.

-- ─── 1 · issue_certificate ─────────────────────────────────────────────────────────────────────────────────────
create or replace function app.issue_certificate(p_report uuid, p_node text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_r app.reports; v_person uuid := private.person_id(); v_grant uuid; v_open int; v_state text;
        v_prev text; v_hash text; v_id uuid := gen_random_uuid();
begin
  select * into v_r from app.reports r where r.id = p_report;
  if not found or not private.is_member(v_r.workspace_id) or not private.can_see_product(v_r.product_id) then
    raise exception 'report not found' using errcode = 'P0002';
  end if;
  if p_node is null or not private.node_in_scope(v_r.workspace_id, p_node) then
    raise exception 'BE-29: no signing grant for %', p_node using errcode = 'P0291';
  end if;
  select g.id into v_grant from app.signing_grants g
  where g.workspace_id = v_r.workspace_id and g.person_id = v_person and g.node_id = p_node and g.revoked_at is null;
  if v_grant is null then raise exception 'BE-29: no signing grant for %', p_node using errcode = 'P0291'; end if;
  if v_r.node_id is not null and p_node <> v_r.node_id then
    raise exception 'BE-29: this report is for %, not %', v_r.node_id, p_node using errcode = '22023';
  end if;
  if not private.aal2() then
    raise exception 'BE-29: signing requires two-factor authentication' using errcode = 'P0292';
  end if;
  select pn.open_actions, pn.display_state into v_open, v_state from app.product_nodes pn
  where pn.product_id = v_r.product_id and pn.node_id = p_node;
  if coalesce(v_open, 0) > 0 then
    raise exception 'BE-29: % open findings on % must be resolved before signing', v_open, p_node using errcode = 'P0293';
  end if;
  if v_state is distinct from 'clear' then
    raise exception 'BE-29: % is %, not clear: only a clear market can be signed', p_node, coalesce(v_state, 'not_assessed')
      using errcode = 'P0293';
  end if;
  perform pg_advisory_xact_lock(hashtext('certificate-chain:' || v_r.workspace_id::text));
  select c.hash into v_prev from app.certificates c where c.workspace_id = v_r.workspace_id
  order by c.signed_at desc, c.id desc limit 1;
  v_hash := encode(extensions.digest(coalesce(v_prev, '') || v_id::text || v_r.id::text || p_node || v_person::text
                                     || v_r.ruleset_version || v_r.artwork_sha, 'sha256'), 'hex');
  insert into app.certificates (id, workspace_id, report_id, product_id, node_id, signer_id, grant_id, prev_hash, hash)
  values (v_id, v_r.workspace_id, v_r.id, v_r.product_id, p_node, v_person, v_grant, v_prev, v_hash);
  perform private.write_audit(v_r.workspace_id, 'certificate.issued', 'certificate', v_id::text, null,
                              jsonb_build_object('node', p_node, 'hash', v_hash), v_r.ruleset_version);
  return v_id;
end $$;
revoke all on function app.issue_certificate(uuid, text) from public, anon;
grant execute on function app.issue_certificate(uuid, text) to authenticated, service_role;

-- ─── 2 · certificates follow market scope ──────────────────────────────────────────────────────────────────────
drop policy read_scoped on app.certificates;
create policy read_scoped on app.certificates for select to authenticated
  using (private.can_see_product(product_id) and private.node_in_scope(workspace_id, node_id));

-- ─── 3 · artwork uploads follow family scope ───────────────────────────────────────────────────────────────────
-- <workspace>/<product>/<file>: the product must be in that workspace and editable by the caller. A path whose first
-- two folders are not uuids is refused (false), never an error.
create function private.can_upload_artwork(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  with f as (select storage.foldername(p_name) as d)
  select coalesce((
    select exists (select 1 from app.products pr
                   where pr.id = f.d[2]::uuid and pr.workspace_id = f.d[1]::uuid)
           and private.can_edit_product(f.d[2]::uuid)
    from f
    where f.d[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and f.d[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'), false)
$$;
revoke all on function private.can_upload_artwork(text) from public, anon;
grant execute on function private.can_upload_artwork(text) to authenticated, service_role;

do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists member_upload_artwork on storage.objects';
    execute $p$create policy member_upload_artwork on storage.objects for insert to authenticated
      with check (bucket_id = 'artwork' and private.can_upload_artwork(name))$p$;
  end if;
end $$;
