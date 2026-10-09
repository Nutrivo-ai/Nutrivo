-- 0005 · Write paths (RPCs) and the queries the screens assume.
-- Pattern every new RPC follows: security definer, search_path = '', explicit permission check first,
-- one transaction, audit via private.write_audit, async work via private.enqueue. Never trust a
-- workspace_id from the client without checking membership.

-- Job creation: idempotent by key; pgmq carries only the job id. Payloads never hold secrets.
create function private.enqueue(p_kind text, p_ws uuid, p_key text, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_job uuid;
begin
  insert into app.jobs (kind, workspace_id, idempotency_key, payload, requested_by)
  values (p_kind, p_ws, p_key, p_payload, private.person_id())
  on conflict (idempotency_key) do nothing
  returning id into v_job;
  if v_job is null then
    select j.id into v_job from app.jobs j where j.idempotency_key = p_key;
    return v_job;
  end if;
  if to_regnamespace('pgmq') is not null then
    execute format('select pgmq.send(%L, %L::jsonb)', p_kind, jsonb_build_object('job_id', v_job)::text);
  end if;
  return v_job;
end $$;

-- BE-32: count a new artwork once; re-checks, extra markets and revisions never count.
create function private.consume_allowance(p_artwork uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_new boolean; v_rows int;
begin
  select av.workspace_id, av.is_new_artwork into v_ws, v_new from app.artwork_versions av where av.id = p_artwork;
  if not coalesce(v_new, false) then return false; end if;
  insert into app.allowance_consumptions (artwork_version_id, workspace_id) values (p_artwork, v_ws)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    update app.allowances set labels_used = labels_used + 1, updated_at = now() where workspace_id = v_ws;
    perform private.write_audit(v_ws, 'allowance.consumed', 'artwork_version', p_artwork::text);
  end if;
  return v_rows = 1;
end $$;

-- A01: create a workspace with its first admin and the free allowance, in one transaction.
create function app.create_workspace(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_person uuid; v_ws uuid; v_email text;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select p.id into v_person from app.people p where p.user_id = v_uid;
  if v_person is null then
    select u.email into v_email from auth.users u where u.id = v_uid;
    insert into app.people (user_id, display_name, email)
    values (v_uid, coalesce(nullif(split_part(v_email, '@', 1), ''), 'Member'), v_email)
    returning id into v_person;
  end if;
  insert into app.workspaces (name, created_by) values (p_name, v_person) returning id into v_ws;
  insert into app.memberships (workspace_id, person_id, role) values (v_ws, v_person, 'admin');
  insert into app.allowances (workspace_id) values (v_ws);
  perform private.write_audit(v_ws, 'workspace.created', 'workspace', v_ws::text, null,
                              jsonb_build_object('name', p_name, 'plan', 'free', 'labels_allowed', 3));
  return v_ws;
end $$;

-- A03: invite. Seats are checked for editor-class roles; viewers are always free (Handoff §04).
-- The token is generated and hashed by the worker when the email is sent, so it never sits in a job payload.
create function app.invite_member(p_ws uuid, p_email text, p_role text, p_is_external boolean default false,
                                  p_scope_family_ids uuid[] default null, p_scope_node_ids text[] default null,
                                  p_access_ends_at timestamptz default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_inv uuid; v_used int; v_included int;
begin
  if not private.has_role(p_ws, '{admin}') then raise exception 'only admins can invite' using errcode = '42501'; end if;
  if p_role in ('admin','portfolio_manager','editor') then
    select s.editor_seats into v_included from app.subscriptions s where s.workspace_id = p_ws;
    if v_included is not null then
      select count(*) into v_used from app.memberships m
      where m.workspace_id = p_ws and m.ended_at is null and (m.access_ends_at is null or m.access_ends_at > now())
        and m.role in ('admin','portfolio_manager','editor');
      if v_used >= v_included then
        raise exception 'BE-33: no editor seat left on this plan' using errcode = 'P0033';
      end if;
    end if;
  end if;
  insert into app.invitations (workspace_id, email, role, is_external, scope_family_ids, scope_node_ids,
                               access_ends_at, invited_by)
  values (p_ws, lower(p_email), p_role, p_is_external, p_scope_family_ids, p_scope_node_ids, p_access_ends_at,
          private.person_id())
  returning id into v_inv;
  perform private.enqueue('notify', p_ws, 'invite:' || v_inv::text,
                          jsonb_build_object('template', 'invitation', 'invitation_id', v_inv));
  perform private.write_audit(p_ws, 'invitation.sent', 'invitation', v_inv::text, null,
                              jsonb_build_object('email', lower(p_email), 'role', p_role, 'is_external', p_is_external));
  return v_inv;
end $$;

-- A04: accept. One-time, email-bound, external flag stamped on the audit event at write time.
create function app.accept_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_email text; v_inv app.invitations; v_person uuid; v_m uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into v_inv from app.invitations i where i.token_hash = extensions.digest(p_token, 'sha256');
  if not found or v_inv.revoked_at is not null or v_inv.accepted_at is not null or v_inv.expires_at < now() then
    raise exception 'this invitation is not valid any more' using errcode = 'P0040';
  end if;
  select u.email into v_email from auth.users u where u.id = v_uid;
  if lower(v_email) <> lower(v_inv.email::text) then
    raise exception 'this invitation was sent to a different email address' using errcode = 'P0041';
  end if;
  select p.id into v_person from app.people p where p.user_id = v_uid;
  if v_person is null then
    insert into app.people (user_id, display_name, email) values (v_uid, split_part(v_email, '@', 1), v_email)
    returning id into v_person;
  end if;
  if exists (select 1 from app.memberships m where m.workspace_id = v_inv.workspace_id
             and m.person_id = v_person and m.ended_at is null) then
    raise exception 'already a member of this workspace' using errcode = 'P0042';
  end if;
  insert into app.memberships (workspace_id, person_id, role, is_external, scope_family_ids, scope_node_ids, access_ends_at)
  values (v_inv.workspace_id, v_person, v_inv.role, v_inv.is_external, v_inv.scope_family_ids,
          v_inv.scope_node_ids, v_inv.access_ends_at)
  returning id into v_m;
  update app.invitations set accepted_at = now() where id = v_inv.id;
  perform private.write_audit(v_inv.workspace_id, 'membership.created', 'membership', v_m::text, null,
                              jsonb_build_object('role', v_inv.role, 'is_external', v_inv.is_external));
  return v_inv.workspace_id;
end $$;

-- D01 + B02: register an uploaded artwork. Idempotent per (product, file hash).
create function app.register_artwork(p_product uuid, p_storage_path text, p_sha256 text,
                                     p_file_name text default null, p_mime text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_status text; v_plan text; v_new boolean; v_version int; v_av uuid; v_used int; v_allowed int;
begin
  if not private.can_edit_product(p_product) then raise exception 'not permitted' using errcode = '42501'; end if;
  select pr.workspace_id into v_ws from app.products pr where pr.id = p_product;
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

-- D04: request a check. Same inputs (artwork, ruleset, classification, markets) map to the same job.
create function app.request_check(p_product uuid, p_nodes text[] default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_av uuid; v_sha text; v_ruleset text; v_class uuid; v_nodes text[];
begin
  if not private.can_edit_product(p_product) then raise exception 'not permitted' using errcode = '42501'; end if;
  select pr.workspace_id into v_ws from app.products pr where pr.id = p_product;
  select av.id, av.file_sha256 into v_av, v_sha from app.artwork_versions av
  where av.product_id = p_product order by av.version desc limit 1;
  if v_av is null then raise exception 'this product has no artwork to check yet' using errcode = 'P0002'; end if;
  select rv.id into v_ruleset from ref.ruleset_versions rv order by rv.released_at desc limit 1;
  if v_ruleset is null then raise exception 'no ruleset has been released' using errcode = 'P0003'; end if;
  select c.id into v_class from app.classifications c where c.product_id = p_product order by c.created_at desc limit 1;
  v_nodes := coalesce(p_nodes, array(select pn.node_id from app.product_nodes pn
                                     where pn.product_id = p_product order by pn.node_id));
  return private.enqueue('check', v_ws,
    format('check:%s:%s:%s:%s:%s', p_product, v_sha, v_ruleset, coalesce(v_class::text, '-'), array_to_string(v_nodes, ',')),
    jsonb_build_object('product_id', p_product, 'artwork_version_id', v_av, 'ruleset_version', v_ruleset,
                       'classification_id', v_class, 'node_ids', to_jsonb(v_nodes)));
end $$;

-- BE-29 / I03: certificate preconditions checked in the database; the error says which one failed.
create function app.issue_certificate(p_report uuid, p_node text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_r app.reports; v_person uuid := private.person_id(); v_grant uuid; v_open int;
        v_prev text; v_hash text; v_id uuid := gen_random_uuid();
begin
  select * into v_r from app.reports r where r.id = p_report;
  if not found or not private.is_member(v_r.workspace_id) then
    raise exception 'report not found' using errcode = 'P0002';
  end if;
  select g.id into v_grant from app.signing_grants g
  where g.workspace_id = v_r.workspace_id and g.person_id = v_person and g.node_id = p_node and g.revoked_at is null;
  if v_grant is null then raise exception 'BE-29: no signing grant for %', p_node using errcode = 'P0291'; end if;
  if not private.aal2() then
    raise exception 'BE-29: signing requires two-factor authentication' using errcode = 'P0292';
  end if;
  select coalesce(sum(pn.open_actions), 0) into v_open from app.product_nodes pn
  where pn.product_id = v_r.product_id and pn.node_id = p_node;
  if v_open > 0 then
    raise exception 'BE-29: % open findings on % must be resolved before signing', v_open, p_node using errcode = 'P0293';
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

-- BE-15: roll-up in the database. A parent is never better than its worst child.
create function app.rollup_state(p_product uuid, p_node text) returns text
language sql stable security invoker set search_path = '' as $$
  with states as (
    select pn.display_state as s from app.product_nodes pn
    join ref.jurisdictions j on j.id = pn.node_id
    where pn.product_id = p_product and (j.id = p_node or j.parent_id = p_node))
  select case
    when not exists (select 1 from states) then 'not_assessed'
    when exists (select 1 from states where s = 'blocked') then 'blocked'
    when exists (select 1 from states where s = 'action') then 'action'
    when exists (select 1 from states where s = 'not_assessed') then 'not_assessed'
    else 'clear' end
$$;

-- BE-24: the affected-object query. A join over the applied-rule record, never a re-evaluation.
create function app.affected_objects(p_rule_diff uuid)
returns table (workspace_id uuid, product_id uuid, node_id text)
language sql stable security invoker set search_path = '' as $$
  with d as (select rd.rule_key from ref.rule_diffs rd where rd.id = p_rule_diff),
  latest as (
    select distinct on (c.product_id, c.node_id) c.product_id, c.node_id, c.job_id
    from app.checks c order by c.product_id, c.node_id, c.at desc)
  select distinct c.workspace_id, c.product_id, c.node_id
  from latest l
  join app.checks c on c.product_id = l.product_id and c.node_id = l.node_id and c.job_id is not distinct from l.job_id
  join app.products pr on pr.id = c.product_id and pr.stage <> 'discontinued'
  cross join d
  where c.applied_rule_keys @> array[d.rule_key] or c.withheld_rule_keys @> array[d.rule_key]
$$;

-- BE-33: live billable counts, read at request time.
create function app.live_billable_counts(p_ws uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when not private.is_member(p_ws) then null else jsonb_build_object(
    'recipes', (select count(*) from app.families f where f.workspace_id = p_ws and f.discontinued_at is null
                and exists (select 1 from app.products p where p.family_id = f.id and p.stage <> 'discontinued')),
    'regions', (select coalesce(jsonb_agg(distinct j.parent_id), '[]'::jsonb) from app.product_nodes pn
                join ref.jurisdictions j on j.id = pn.node_id
                join app.products p on p.id = pn.product_id
                where pn.workspace_id = p_ws and p.stage <> 'discontinued'),
    'editor_seats', (select count(*) from app.memberships m where m.workspace_id = p_ws and m.ended_at is null
                     and (m.access_ends_at is null or m.access_ends_at > now())
                     and m.role in ('admin','portfolio_manager','editor')),
    'labels_used', (select a.labels_used from app.allowances a where a.workspace_id = p_ws),
    'labels_allowed', (select a.labels_allowed from app.allowances a where a.workspace_id = p_ws)) end
$$;

-- BE-28: public verification. Status, issue date, ruleset, whether not-assessed items existed. Nothing else.
-- Independent of subscription state on purpose (Handoff non-negotiable 8).
create function public.verify_reference(p_ref text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid; v_at timestamptz; v_ruleset text; v_na boolean;
begin
  if p_ref is null or length(p_ref) not between 20 and 64 then return jsonb_build_object('status', 'unknown'); end if;
  select r.id, r.created_at, r.ruleset_version, r.has_not_assessed into v_id, v_at, v_ruleset, v_na
  from app.reports r where r.ref = p_ref;
  if v_id is null then return jsonb_build_object('status', 'unknown'); end if;
  return jsonb_build_object(
    'status', case when exists (select 1 from app.supersessions s
                                where s.artefact_type = 'report' and s.artefact_id = v_id)
                   then 'superseded' else 'current' end,
    'issued_at', v_at, 'ruleset_version', v_ruleset, 'has_not_assessed', v_na);
end $$;

-- Public coverage snapshot for the marketing coverage page (P01): reads the latest released ruleset only.
create function public.coverage_snapshot() returns jsonb
language sql stable security definer set search_path = '' as $$
  with latest as (select rv.id from ref.ruleset_versions rv order by rv.released_at desc limit 1)
  select jsonb_build_object('ruleset_version', (select id from latest),
    'nodes', coalesce((select jsonb_agg(jsonb_build_object('node_id', c.node_id, 'domain', c.domain, 'state', c.state,
                                         'rules_encoded', c.rules_encoded, 'method', c.method,
                                         'last_checked_at', c.last_checked_at, 'gap_id', c.gap_id)
                                         order by c.node_id, c.domain)
                       from ref.coverage_nodes c where c.ruleset_version = (select id from latest)), '[]'::jsonb))
$$;

-- Function grants: clients execute app RPCs as authenticated; anon only the two public functions.
revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
revoke all on function public.verify_reference(text) from public;
revoke all on function public.coverage_snapshot() from public;
grant execute on function public.verify_reference(text) to anon, authenticated, service_role;
grant execute on function public.coverage_snapshot() to anon, authenticated, service_role;
revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;
