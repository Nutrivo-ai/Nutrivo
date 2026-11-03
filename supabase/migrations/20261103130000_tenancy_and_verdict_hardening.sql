-- Incident #179 · the database gaps from the pre-flight audit (#8) that need no founder decision: DB-1, DB-2, DB-6,
-- DB-5 (Storage, reports, alerts), DB-7, DB-9, DB-17 and X2. Additive: no applied migration is edited, no gate test
-- changes, and every assertion of supabase/tests/gates/ still holds. Tests: supabase/tests/app/90_tenancy_and_verdict_hardening.test.sql.
-- Out of scope here (founder decisions on #8): DB-3, DB-5 decision 2 (jobs, shares, supersessions), DB-14, X3.

-- ─── DB-1 · no rule, no verdict: Clear needs all six domains of the node complete (non-negotiable 3) ─────────────
-- Before this, verdict_guard refused only a node with no coverage rows or with a row that was not complete, so a node
-- with one complete domain and five missing rows could be Clear.
create function private.node_fully_encoded(p_ruleset text, p_node text) returns boolean
language sql stable set search_path = '' as $$
  select p_ruleset is not null and p_node is not null and not exists (
    select 1
    from unnest(array['mandatory_particulars','composition','claims_wording','type_geometry','language',
                      'registration']) as d(domain)
    where not exists (select 1 from ref.coverage_nodes c
                      where c.ruleset_version = p_ruleset and c.node_id = p_node
                        and c.domain = d.domain and c.state = 'complete'))
$$;
comment on function private.node_fully_encoded(text, text) is
  'BE-21: true only when every one of the six coverage domains of the node is complete in the ruleset.';

create or replace function private.verdict_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.label_state = 'clear' and not private.node_fully_encoded(new.ruleset_version, new.node_id) then
    raise exception 'BE-21: no rule, no verdict: % is not fully encoded in ruleset %, so a check cannot be clear',
      new.node_id, new.ruleset_version using errcode = 'P0021';
  end if;
  return new;
end $$;

-- ─── DB-2 · the board's label state: Clear only for a fully encoded market in a pinned ruleset ────────────────────
-- A downgrade, not an error: the row is the board's summary (written by the worker, by seeds and by RPCs that set
-- other columns), and Not assessed is the honest state of a market whose coverage is incomplete or unpinned.
create function private.product_node_verdict_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.label_state = 'clear' and not private.node_fully_encoded(new.ruleset_version, new.node_id) then
    new.label_state := 'not_assessed';
  end if;
  return new;
end $$;
create trigger product_node_verdict_guard before insert or update on app.product_nodes
  for each row execute function private.product_node_verdict_guard();

-- ─── DB-6 · findings: a verdict carries its rule, sits under a check it agrees with, and shares its scope ─────────
-- An action judged by a rule or by the model needs the rule_key it was judged against (non-negotiables 5 and 6).
-- check_findings is insert-only: the constraint and triggers below are added beside its insert-only triggers, and
-- VALIDATE only reads the existing rows.
alter table app.check_findings
  add constraint check_findings_verdict_needs_rule
  check (state <> 'action' or provenance not in ('deterministic_rule','model_judgement') or rule_key is not null)
  not valid;
alter table app.check_findings validate constraint check_findings_verdict_needs_rule;

-- The denormalised workspace, product and node must be the parent check's: otherwise another workspace's members
-- read the finding through their own RLS (non-negotiable 1). BEFORE INSERT, so nothing is written. P0046.
create function private.finding_scope_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_check app.checks;
begin
  select * into v_check from app.checks c where c.id = new.check_id;
  if not found then
    return new;                                   -- the foreign key reports the missing check
  end if;
  if new.workspace_id is distinct from v_check.workspace_id or new.product_id is distinct from v_check.product_id
     or new.node_id is distinct from v_check.node_id then
    raise exception 'a finding''s workspace, product and node must be its check''s' using errcode = 'P0046';
  end if;
  return new;
end $$;
create trigger finding_scope_guard before insert on app.check_findings
  for each row execute function private.finding_scope_guard();

-- A clear check has no action and nothing withheld (BE-21). This one is AFTER INSERT on purpose: a BEFORE trigger
-- would fire ahead of the table's check constraints and pre-empt their error codes (gate 03's BE-10 assertion expects
-- 23514 for a withheld finding without a gap_id under a clear check). An error here still aborts the insert.
create function private.finding_verdict_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.state in ('action','not_assessed')
     and exists (select 1 from app.checks c where c.id = new.check_id and c.label_state = 'clear') then
    raise exception 'BE-21: a clear check cannot carry a % finding', new.state using errcode = 'P0021';
  end if;
  return null;
end $$;
create trigger finding_verdict_guard after insert on app.check_findings
  for each row execute function private.finding_verdict_guard();

-- ─── DB-5 (part) · Storage reads follow the record, and reports and alerts follow market scope ───────────────────
-- An object in artwork, documents or reports is readable only through the row that names it, and only by someone who
-- may read that row's product (and market): a family- or market-scoped member no longer lists every file of the
-- workspace. The object's first folder must also be the row's workspace, so a row that names another workspace's
-- object (registered before DB-7) never opens it. A row's path may carry the bucket name in front (tolerated as the
-- export worker tolerates it). Objects no row names are read by the service role only. exports keeps its own policy
-- (admin_read_exports, 20261024193051) unchanged.
create function private.can_read_object(p_bucket text, p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_bucket
    when 'artwork' then exists (
      select 1 from app.artwork_versions av
      where av.storage_path in (p_name, 'artwork/' || p_name)
        and split_part(p_name, '/', 1) = av.workspace_id::text
        and private.can_see_product(av.product_id))
    when 'reports' then exists (
      select 1 from app.reports r
      where r.pdf_path in (p_name, 'reports/' || p_name)
        and split_part(p_name, '/', 1) = r.workspace_id::text
        and private.can_see_product(r.product_id)
        and (r.node_id is null or private.node_in_scope(r.workspace_id, r.node_id)))
    when 'documents' then exists (
      select 1 from app.supplier_documents d
      where d.storage_path in (p_name, 'documents/' || p_name)
        and split_part(p_name, '/', 1) = d.workspace_id::text
        and case when d.product_id is null then private.is_member(d.workspace_id)
                 else private.can_see_product(d.product_id) end)
    else false end
$$;
create index if not exists artwork_versions_storage_path on app.artwork_versions(storage_path);
create index if not exists reports_pdf_path on app.reports(pdf_path) where pdf_path is not null;
create index if not exists supplier_documents_storage_path on app.supplier_documents(storage_path);

do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists member_read_own_workspace on storage.objects;
    execute $p$create policy read_by_record on storage.objects for select to authenticated
      using (bucket_id in ('artwork','documents','reports') and private.can_read_object(bucket_id, name))$p$;
  end if;
end $$;

drop policy read_scoped on app.reports;
create policy read_scoped on app.reports for select to authenticated
  using (private.can_see_product(product_id) and (node_id is null or private.node_in_scope(workspace_id, node_id)));
drop policy read_scoped on app.alerts;
create policy read_scoped on app.alerts for select to authenticated
  using (private.can_see_product(product_id) and private.node_in_scope(workspace_id, node_id));

-- ─── DB-7 · register_artwork: only a path in the caller's workspace and product folder ──────────────────────────
-- Same signature, permission check first, audit and enqueue as 20261008000005; the path checks are new. The path is
-- the object's name in the artwork bucket, <workspace_id>/<product_id>/<file> (apps/web/src/lib/artwork, docs/04);
-- a leading 'artwork/' is tolerated. A malformed path (leading '/', '//', a '.' or '..' segment, a trailing '/', a
-- backslash or a control character) is 22023. A path that names any workspace or product id (a uuid segment) must
-- name this product in this workspace, else 42501. A path with no uuid segment names no workspace's folder: no member
-- can upload there (the bucket's insert policy keys on a workspace uuid), so it opens nobody's file; it stays
-- accepted because gate 04 registers 'artwork/a/1.pdf'. The worker keeps its own canonical-path and hash check.
create or replace function app.register_artwork(p_product uuid, p_storage_path text, p_sha256 text,
                                                p_file_name text default null, p_mime text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_status text; v_plan text; v_new boolean; v_version int; v_av uuid; v_used int; v_allowed int;
        v_path text;
begin
  if not private.can_edit_product(p_product) then raise exception 'not permitted' using errcode = '42501'; end if;
  select pr.workspace_id into v_ws from app.products pr where pr.id = p_product;

  if p_storage_path is null or length(p_storage_path) not between 3 and 1024
     or left(p_storage_path, 1) = '/' or right(p_storage_path, 1) = '/' or position('//' in p_storage_path) > 0
     or p_storage_path ~ '(^|/)\.\.?(/|$)' or p_storage_path ~ '[\\[:cntrl:]]' then
    raise exception 'the artwork path must be <workspace_id>/<product_id>/<file>, with no empty, "." or ".." part'
      using errcode = '22023';
  end if;
  v_path := case when p_storage_path like 'artwork/%' then substr(p_storage_path, 9) else p_storage_path end;
  if p_storage_path ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
     and left(v_path, 74) <> v_ws::text || '/' || p_product::text || '/' then
    raise exception 'the artwork path must be in this workspace''s folder for this product' using errcode = '42501';
  end if;
  select w.status, w.plan into v_status, v_plan from app.workspaces w where w.id = v_ws;

  select av.id into v_av from app.artwork_versions av where av.product_id = p_product and av.file_sha256 = p_sha256;
  if v_av is not null then return v_av; end if;

  v_new := not exists (select 1 from app.artwork_versions av where av.product_id = p_product);
  if v_new and v_status in ('new_artwork_stopped','closed') then
    raise exception 'BE-36: new artworks are paused until payment is resolved; everything else keeps working'
      using errcode = 'P0036';
  end if;
  if v_new and v_plan = 'free' then
    select a.labels_used, a.labels_allowed into v_used, v_allowed from app.allowances a
    where a.workspace_id = v_ws for update;
    if v_used >= v_allowed then
      raise exception 'BE-32: all % free label artworks are used', v_allowed using errcode = 'P0032';
    end if;
  end if;

  select coalesce(max(av.version), 0) + 1 into v_version from app.artwork_versions av where av.product_id = p_product;
  insert into app.artwork_versions (workspace_id, product_id, version, file_sha256, storage_path, file_name,
                                    mime_type, is_new_artwork, uploaded_by)
  values (v_ws, p_product, v_version, p_sha256, p_storage_path, p_file_name, p_mime, v_new, private.person_id())
  returning id into v_av;
  perform private.consume_allowance(v_av);
  perform private.enqueue('extract', v_ws, 'extract:' || v_av::text, jsonb_build_object('artwork_version_id', v_av));
  perform private.write_audit(v_ws, 'artwork.registered', 'artwork_version', v_av::text, null,
                              jsonb_build_object('version', v_version, 'is_new_artwork', v_new, 'sha256', p_sha256));
  return v_av;
end $$;
revoke all on function app.register_artwork(uuid, text, text, text, text) from public, anon;
grant execute on function app.register_artwork(uuid, text, text, text, text) to authenticated, service_role;

-- ─── DB-9 · nothing new in public is granted to anon or authenticated by default ─────────────────────────────────
-- Supabase's defaults grant every new table, view, sequence and function in public to anon and authenticated. The
-- function EXECUTE that PUBLIC holds by default is a global default that a per-schema rule cannot remove (and a
-- global revoke would reach the extensions' functions too), so a new public function still revokes from public
-- itself, as verify_reference and coverage_snapshot do.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
-- The two public functions keep exactly the grants 20261008000005 gave them (BE-28, non-negotiable 9).
revoke all on function public.verify_reference(text), public.coverage_snapshot() from public;
grant execute on function public.verify_reference(text), public.coverage_snapshot() to anon, authenticated, service_role;

-- ─── DB-17 · every trigger function runs with a fixed, empty search_path ────────────────────────────────────────
-- Each body below already names its tables schema-qualified (ref.jurisdictions, ref.rule_versions, app.memberships,
-- app.signing_grants) or touches no table; now() and the tg_* variables come from pg_catalog. verdict_guard got its
-- search_path in its create or replace above.
alter function private.jurisdiction_shape() set search_path = '';
alter function private.rule_version_guard() set search_path = '';
alter function private.ruleset_member_guard() set search_path = '';
alter function private.reject_mutation() set search_path = '';
alter function private.signing_grant_guard() set search_path = '';
alter function private.membership_grant_sync() set search_path = '';

-- ─── X2 · the write helpers run only inside security definer RPCs and the worker ────────────────────────────────
-- Every caller in the migrations is a security definer function owned by the migration owner (app RPCs,
-- private.consume_allowance, private.family_for_product, private.enqueue_billing_reconcile), so it executes these
-- as that owner; no security invoker function, trigger or RLS policy calls them. The worker calls write_audit and
-- enqueue over DATABASE_URL as the service role or the owner.
revoke execute on function private.enqueue(text, uuid, text, jsonb),
  private.write_audit(uuid, text, text, text, jsonb, jsonb, text),
  private.consume_allowance(uuid) from public, anon, authenticated;
grant execute on function private.enqueue(text, uuid, text, jsonb),
  private.write_audit(uuid, text, text, text, jsonb, jsonb, text),
  private.consume_allowance(uuid) to service_role;

-- ─── Grants for the functions this migration adds ────────────────────────────────────────────────────────────────
-- Trigger functions are never called directly (EXECUTE is checked when a trigger is created, not when it fires).
revoke all on function private.product_node_verdict_guard(), private.finding_scope_guard(),
  private.finding_verdict_guard() from public, anon, authenticated;
-- node_fully_encoded reads only ref coverage, which authenticated reads anyway; can_read_object is the Storage policy.
revoke all on function private.node_fully_encoded(text, text), private.can_read_object(text, text) from public, anon;
grant execute on function private.node_fully_encoded(text, text), private.can_read_object(text, text)
  to authenticated, service_role;
