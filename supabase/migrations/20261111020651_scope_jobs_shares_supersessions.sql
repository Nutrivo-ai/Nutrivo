-- T-409 · #8 DB-5 decision 2 (abnutrivo, 3 Nov 2026), #188: app.jobs, app.shares and app.supersessions are scoped to
-- family and market, like app.product_nodes and app.checks. A member reads a job, share or supersession only where
-- they see its product (private.can_see_product) and its market (private.node_in_scope). Product-less jobs (export,
-- billing, invites, dunning) keep their readers (private.is_member).
--
-- Expand, migrate, contract, in this one additive migration:
--   1. nullable scope columns: app.jobs.product_id and node_ids, app.shares.node_id, app.supersessions.product_id
--      and node_id;
--   2. every producer sets them through a before-insert trigger. Jobs take their scope from the ids the payload
--      already carries (private.job_scope), so private.enqueue and the RPCs that call it stay as they are, and a new
--      producer is scoped as soon as its payload names its product, check, artwork, share, request or document;
--   3. existing jobs and shares are backfilled with the same derivation. app.supersessions is insert-only (BE-05,
--      non-negotiable 2), so its rows are never updated: a row written before this migration has no product and is
--      scoped through its artefact instead (private.supersession_visible). No producer writes supersessions yet;
--   4. the read policies change.
--
-- Multi-market jobs (#198 Q1): a check job names several markets (node_ids). A member reads it only when every one is
-- in their scope, so a job never shows a market outside it. Requesting a job grants nothing more: a member whose scope
-- does not cover it (or no longer does) does not read it.
-- Product-less jobs fail closed: only the kinds listed below are read workspace-wide, and never when their payload names
-- an id that is missing or of another workspace (scope_unresolved). An id of a product-less row of the workspace (a
-- workspace document and its request) keeps the job workspace-wide, as the row itself is.
-- Share writes follow the share read policy: create_share and revoke_share also need the report's market in scope.

-- ─── 1 · Columns ─────────────────────────────────────────────────────────────────────────────────────────────────
alter table app.jobs add column product_id uuid references app.products(id), add column node_ids text[],
                     add column scope_unresolved boolean not null default false;
alter table app.shares add column node_id text references ref.jurisdictions(id);
alter table app.supersessions add column product_id uuid references app.products(id),
                              add column node_id text references ref.jurisdictions(id);
create index jobs_product on app.jobs(product_id) where product_id is not null;

-- ─── 2 · Producers set the scope ────────────────────────────────────────────────────────────────────────────────
-- A job's scope from its payload. The first id present wins, in this order: product_id (with node_ids or node_id),
-- check_id (the check's product and market), artwork_version_id, share_id (the product and market of the share's
-- report, so it does not depend on app.shares.node_id being backfilled first), document_request_id, document_id.
-- A payload naming none of them is product-less. One naming an id that is missing or of another workspace gives no
-- scope and unresolved = true.
create function private.job_scope(p_ws uuid, p_payload jsonb, out product_id uuid, out node_ids text[],
                                  out unresolved boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_ws uuid; v_node text; p jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  unresolved := false;
  if p ? 'product_id' then
    select pr.id, pr.workspace_id into product_id, v_ws from app.products pr where pr.id = (p ->> 'product_id')::uuid;
    if jsonb_typeof(p -> 'node_ids') = 'array' then
      node_ids := array(select jsonb_array_elements_text(p -> 'node_ids'));
    elsif p ? 'node_id' then
      node_ids := array[p ->> 'node_id'];
    end if;
  elsif p ? 'check_id' then
    select c.product_id, c.workspace_id, c.node_id into product_id, v_ws, v_node
    from app.checks c where c.id = (p ->> 'check_id')::uuid;
    if v_node is not null then node_ids := array[v_node]; end if;
  elsif p ? 'artwork_version_id' then
    select av.product_id, av.workspace_id into product_id, v_ws
    from app.artwork_versions av where av.id = (p ->> 'artwork_version_id')::uuid;
  elsif p ? 'share_id' then
    select s.product_id, s.workspace_id, r.node_id into product_id, v_ws, v_node
    from app.shares s join app.reports r on r.id = s.report_id where s.id = (p ->> 'share_id')::uuid;
    if v_node is not null then node_ids := array[v_node]; end if;
  elsif p ? 'document_request_id' then
    select d.product_id, d.workspace_id into product_id, v_ws
    from app.document_requests d where d.id = (p ->> 'document_request_id')::uuid;
  elsif p ? 'document_id' then
    select d.product_id, d.workspace_id into product_id, v_ws
    from app.supplier_documents d where d.id = (p ->> 'document_id')::uuid;
  end if;
  -- An id that is missing or of another workspace gives no scope. The job is still written: the worker refuses it and
  -- the failure stays visible (worker/tests/test_report_pg.py), and the policy shows it to no member.
  if p ?| array['product_id','check_id','artwork_version_id','share_id','document_request_id','document_id']
     and v_ws is distinct from p_ws then
    product_id := null;
    node_ids := null;
    unresolved := true;
  end if;
end $$;

create function private.job_scope_fill() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_ws uuid;
begin
  if new.product_id is null then
    select s.product_id, coalesce(new.node_ids, s.node_ids), s.unresolved
    into new.product_id, new.node_ids, new.scope_unresolved
    from private.job_scope(new.workspace_id, new.payload) s;
  else
    select pr.workspace_id into v_ws from app.products pr where pr.id = new.product_id;
    if v_ws is distinct from new.workspace_id then
      raise exception 'a job''s product belongs to the job''s workspace' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger jobs_scope before insert on app.jobs for each row execute function private.job_scope_fill();

-- Shares: the existing trigger also sets the report's market, and refuses a node_id that disagrees with it.
create or replace function private.share_product() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_product uuid; v_ws uuid; v_node text;
begin
  select r.product_id, r.workspace_id, r.node_id into v_product, v_ws, v_node from app.reports r where r.id = new.report_id;
  if v_ws is distinct from new.workspace_id then
    raise exception 'a share belongs to its report''s workspace' using errcode = '23514';
  end if;
  if new.product_id is null then
    new.product_id := v_product;
  elsif new.product_id is distinct from v_product then
    raise exception 'a share''s product is its report''s product' using errcode = '23514';
  end if;
  if new.node_id is null then
    new.node_id := v_node;
  elsif new.node_id is distinct from v_node then
    raise exception 'a share''s market is its report''s market' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger shares_product on app.shares;
create trigger shares_product before insert or update of product_id, node_id, report_id, workspace_id on app.shares
  for each row execute function private.share_product();

-- Supersessions: the product and market of the report or certificate, which must exist in the same workspace.
create function private.supersession_scope() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_product uuid; v_node text;
begin
  if new.artefact_type = 'report' then
    select r.workspace_id, r.product_id, r.node_id into v_ws, v_product, v_node from app.reports r where r.id = new.artefact_id;
  else
    select c.workspace_id, c.product_id, c.node_id into v_ws, v_product, v_node
    from app.certificates c where c.id = new.artefact_id;
  end if;
  if v_ws is null or v_ws is distinct from new.workspace_id then
    raise exception 'a supersession names a % of its own workspace', new.artefact_type using errcode = '23514';
  end if;
  if (new.product_id is not null and new.product_id is distinct from v_product)
     or (new.node_id is not null and new.node_id is distinct from v_node) then
    raise exception 'a supersession''s product and market are its artefact''s' using errcode = '23514';
  end if;
  new.product_id := v_product;
  new.node_id := v_node;
  return new;
end $$;
create trigger supersessions_scope before insert on app.supersessions
  for each row execute function private.supersession_scope();

-- ─── 3 · Backfill ────────────────────────────────────────────────────────────────────────────────────────────────
-- Shares first, then jobs (job_scope reads a share's market from its report either way).
update app.shares s set node_id = r.node_id from app.reports r
where r.id = s.report_id and s.node_id is null and r.node_id is not null;
update app.jobs j set (product_id, node_ids, scope_unresolved) = (select s.product_id, s.node_ids, s.unresolved
                                                                  from private.job_scope(j.workspace_id, j.payload) s)
where j.product_id is null;

-- No constraint yet: a raw writer (tests, the service role) may still insert a check job whose payload names nothing.
-- The policy fails closed instead (section 4): such a job is read by no member, never workspace-wide.

-- ─── 4 · Policies ────────────────────────────────────────────────────────────────────────────────────────────────
-- Every node of the list is in the caller's scope in the workspace (an empty or null list names no market).
create function private.nodes_in_scope(ws uuid, nodes text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_member(ws)
     and not exists (select 1 from unnest(coalesce(nodes, '{}'::text[])) n where not private.node_in_scope(ws, n))
$$;

-- A supersession written before this migration (no product): scoped through its report or certificate.
create function private.supersession_visible(p_type text, p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_type
    when 'report' then exists (select 1 from app.reports r where r.id = p_id and private.can_see_product(r.product_id)
                                 and (r.node_id is null or private.node_in_scope(r.workspace_id, r.node_id)))
    when 'certificate' then exists (select 1 from app.certificates c where c.id = p_id
                                      and private.can_see_product(c.product_id)
                                      and private.node_in_scope(c.workspace_id, c.node_id))
    else false end
$$;

drop policy read_member on app.jobs;
create policy read_scoped on app.jobs for select to authenticated
  using (case when product_id is null
                then private.is_member(workspace_id)
                     and kind in ('export','notify','scan','session_revoke','billing_sync','billing_reconcile',
                                  'recipe_overage','dunning','diff_fanout')
                     and not scope_unresolved
              else private.can_see_product(product_id) and private.nodes_in_scope(workspace_id, node_ids) end);

drop policy read_scoped on app.shares;
create policy read_scoped on app.shares for select to authenticated
  using (private.can_see_product(product_id) and (node_id is null or private.node_in_scope(workspace_id, node_id)));

drop policy read_member on app.supersessions;
create policy read_scoped on app.supersessions for select to authenticated
  using (case when product_id is null then private.supersession_visible(artefact_type, artefact_id)
              else private.can_see_product(product_id)
                   and (node_id is null or private.node_in_scope(workspace_id, node_id)) end);

-- ─── 5 · Share writes follow the share read policy ──────────────────────────────────────────────────────────────
-- The bodies of 20261107061456, with one more condition each: the report's market is in the caller's scope,
-- so a member scoped to EU-DE can neither mint nor revoke a share of an EU-SE report. create or replace keeps the grants.
create or replace function app.create_share(p_report uuid, p_channel text, p_recipient text default null,
                                 p_expires_in_days int default 30, p_request_id text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_r app.reports; v_id uuid := gen_random_uuid(); v_token text; v_hash bytea; v_recipient text;
        v_expires timestamptz; v_job uuid; v_rid text;
begin
  select * into v_r from app.reports r where r.id = p_report;
  if not found or not private.can_edit_product(v_r.product_id) or private.person_id() is null
     or (v_r.node_id is not null and not private.node_in_scope(v_r.workspace_id, v_r.node_id)) then
    raise exception 'only an editor of this product can share its report' using errcode = '42501';
  end if;
  if p_channel is null or p_channel not in ('link','email') then
    raise exception 'a share is a link or an email' using errcode = '22023';
  end if;
  if p_expires_in_days is not null and p_expires_in_days not between 1 and 365 then
    raise exception 'a share expires after 1 to 365 days, or never' using errcode = '22023';
  end if;
  v_expires := case when p_expires_in_days is null then null else now() + make_interval(days => p_expires_in_days) end;

  if p_channel = 'email' then
    v_recipient := lower(btrim(p_recipient));
    if v_recipient is null or length(v_recipient) > 254 or v_recipient !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      raise exception 'an email share needs one valid address' using errcode = '22023';
    end if;
    v_hash := extensions.digest(extensions.gen_random_bytes(32), 'sha256');
  else
    if p_recipient is not null then
      raise exception 'a link share has no recipient' using errcode = '22023';
    end if;
    v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
    v_hash := private.share_token_hash(v_token);
  end if;

  insert into app.shares (id, workspace_id, product_id, report_id, token_hash, channel, recipient, expires_at, created_by)
  values (v_id, v_r.workspace_id, v_r.product_id, v_r.id, v_hash, p_channel, v_recipient, v_expires, private.person_id());

  if p_channel = 'email' then
    v_rid := case when p_request_id ~ '^[A-Za-z0-9-]{8,64}$' then p_request_id end;
    v_job := private.enqueue('notify', v_r.workspace_id, 'share:' || v_id::text,
                             jsonb_build_object('template', 'report', 'share_id', v_id)
                               || case when v_rid is null then '{}'::jsonb else jsonb_build_object('request_id', v_rid) end);
  end if;

  perform private.write_audit(v_r.workspace_id, 'share.created', 'share', v_id::text, null,
                              jsonb_build_object('report_id', v_r.id, 'ref', v_r.ref, 'channel', p_channel,
                                                 'recipient', v_recipient, 'expires_at', v_expires),
                              v_r.ruleset_version);
  return jsonb_build_object('share_id', v_id, 'channel', p_channel, 'token', v_token, 'expires_at', v_expires,
                            'job_id', v_job);
end $$;

create or replace function app.revoke_share(p_share uuid) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v_s app.shares;
begin
  select s.* into v_s from app.shares s where s.id = p_share for update;
  if not found or private.person_id() is null
     or not (private.can_edit_product(v_s.product_id)
             or (private.can_see_product(v_s.product_id)
                 and private.has_role(v_s.workspace_id, '{admin,portfolio_manager}')))
     or exists (select 1 from app.reports r where r.id = v_s.report_id and r.node_id is not null
                and not private.node_in_scope(r.workspace_id, r.node_id)) then
    raise exception 'only an editor of this product or a workspace manager can revoke its share' using errcode = '42501';
  end if;
  if v_s.revoked_at is not null then
    return v_s.revoked_at;
  end if;
  update app.shares set revoked_at = now() where id = v_s.id;
  perform private.write_audit(v_s.workspace_id, 'share.revoked', 'share', v_s.id::text,
                              jsonb_build_object('report_id', v_s.report_id, 'channel', v_s.channel,
                                                 'recipient', v_s.recipient, 'expires_at', v_s.expires_at),
                              jsonb_build_object('revoked_at', now()));
  return now();
end $$;

-- ─── Grants ──────────────────────────────────────────────────────────────────────────────────────────────────────
-- job_scope resolves any id to its product, so only the trigger (as the owner) and the service role call it. The
-- policy helpers return a boolean about the caller's own scope.
revoke all on function private.job_scope(uuid, jsonb), private.job_scope_fill(), private.supersession_scope()
  from public, anon, authenticated;
grant execute on function private.job_scope(uuid, jsonb) to service_role;
revoke all on function private.nodes_in_scope(uuid, text[]), private.supersession_visible(text, uuid) from public, anon;
grant execute on function private.nodes_in_scope(uuid, text[]), private.supersession_visible(text, uuid)
  to authenticated, service_role;
