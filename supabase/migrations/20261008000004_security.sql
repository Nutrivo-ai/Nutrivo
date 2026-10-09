-- 0004 · Security: helpers, guard triggers, RLS, grants, insert-only enforcement.
-- Gates: BE-02 (default deny), BE-04 (signing grants), BE-05 (insert-only), BE-06 (stamped actor),
-- BE-21 (no rule, no verdict), BE-28 (anon reads nothing). Tests: supabase/tests/gates/.

-- ─── Identity helpers (security definer: table owners bypass RLS, so no policy recursion) ───────────
create function private.person_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id from app.people p where p.user_id = auth.uid() and p.tombstoned_at is null
$$;

create function private.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app.memberships m join app.people p on p.id = m.person_id
    where m.workspace_id = ws and p.user_id = auth.uid() and m.ended_at is null
      and (m.access_ends_at is null or m.access_ends_at > now()))
$$;

create function private.has_role(ws uuid, roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app.memberships m join app.people p on p.id = m.person_id
    where m.workspace_id = ws and p.user_id = auth.uid() and m.ended_at is null
      and (m.access_ends_at is null or m.access_ends_at > now()) and m.role = any(roles))
$$;

create function private.family_in_scope(ws uuid, fam uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app.memberships m join app.people p on p.id = m.person_id
    where m.workspace_id = ws and p.user_id = auth.uid() and m.ended_at is null
      and (m.access_ends_at is null or m.access_ends_at > now())
      and (m.scope_family_ids is null or fam = any(m.scope_family_ids)))
$$;

create function private.node_in_scope(ws uuid, node text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app.memberships m join app.people p on p.id = m.person_id
    where m.workspace_id = ws and p.user_id = auth.uid() and m.ended_at is null
      and (m.access_ends_at is null or m.access_ends_at > now())
      and (m.scope_node_ids is null or node = any(m.scope_node_ids)
           or (select j.parent_id from ref.jurisdictions j where j.id = node) = any(m.scope_node_ids)))
$$;

create function private.can_see_product(pid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.products pr
                 where pr.id = pid and private.family_in_scope(pr.workspace_id, pr.family_id))
$$;

create function private.can_edit_product(pid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.products pr
                 where pr.id = pid and private.family_in_scope(pr.workspace_id, pr.family_id)
                   and private.has_role(pr.workspace_id, '{admin,portfolio_manager,editor}'))
$$;

create function private.shares_workspace(other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app.memberships a
    join app.people me on me.id = a.person_id
    join app.memberships b on b.workspace_id = a.workspace_id
    where me.user_id = auth.uid() and a.ended_at is null and b.person_id = other)
$$;

create function private.is_staff() returns boolean
language sql stable set search_path = '' as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'nutrivo_staff')::boolean, false)
$$;

create function private.aal2() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

-- ─── Audit (BE-06): actor and external flag copied in at write time, never joined later ───────────
create function private.write_audit(p_ws uuid, p_kind text, p_object_type text, p_object_id text,
                                    p_before jsonb default null, p_after jsonb default null,
                                    p_ruleset text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.person_id(); v_ext boolean;
begin
  if v_actor is not null and p_ws is not null then
    select m.is_external into v_ext from app.memberships m
    where m.workspace_id = p_ws and m.person_id = v_actor and m.ended_at is null limit 1;
  end if;
  insert into app.audit_events (workspace_id, actor_id, actor_is_external, kind, object_type, object_id,
                                before, after, ruleset_version)
  values (p_ws, v_actor, coalesce(v_ext, false), p_kind, p_object_type, p_object_id, p_before, p_after, p_ruleset);
end $$;

-- ─── Guards ────────────────────────────────────────────────────────────────────────────────────
-- BE-05: the record cannot be mutated, including by us. Privileges are revoked AND this trigger raises.
create function private.reject_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'BE-05: %.% is insert-only; % is not permitted', tg_table_schema, tg_table_name, tg_op
    using errcode = 'P0005';
end $$;

-- BE-04: a grant to an external or inactive membership raises rather than being filtered in the UI.
create function private.signing_grant_guard() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from app.memberships m
                 where m.workspace_id = new.workspace_id and m.person_id = new.person_id
                   and m.ended_at is null and not m.is_external
                   and (m.access_ends_at is null or m.access_ends_at > now())) then
    raise exception 'BE-04: signing grants require an active, internal membership' using errcode = 'P0004';
  end if;
  return new;
end $$;
create trigger signing_grant_guard before insert on app.signing_grants
  for each row execute function private.signing_grant_guard();

-- A membership that becomes external or ends loses its signing grants in the same transaction.
create function private.membership_grant_sync() returns trigger language plpgsql as $$
begin
  if (new.is_external and not old.is_external) or (new.ended_at is not null and old.ended_at is null) then
    update app.signing_grants set revoked_at = now()
    where workspace_id = new.workspace_id and person_id = new.person_id and revoked_at is null;
  end if;
  return new;
end $$;
create trigger membership_grant_sync after update on app.memberships
  for each row execute function private.membership_grant_sync();

-- BE-21: no rule, no verdict. Structural, in the write path, not a prompt instruction.
create function private.verdict_guard() returns trigger language plpgsql as $$
begin
  if new.label_state = 'clear' and (
       not exists (select 1 from ref.coverage_nodes c
                   where c.ruleset_version = new.ruleset_version and c.node_id = new.node_id)
       or exists (select 1 from ref.coverage_nodes c
                  where c.ruleset_version = new.ruleset_version and c.node_id = new.node_id
                    and c.state <> 'complete')) then
    raise exception 'BE-21: no rule, no verdict: % is not fully encoded in ruleset %, so a check cannot be clear',
      new.node_id, new.ruleset_version using errcode = 'P0021';
  end if;
  return new;
end $$;
create trigger verdict_guard before insert on app.checks
  for each row execute function private.verdict_guard();

-- ─── Row-level security: on for every table in app, default deny (BE-02) ────────────────────────
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'app' and c.relkind = 'r' loop
    execute format('alter table app.%I enable row level security', t.relname);
  end loop;
end $$;

-- Reads. Writes from clients go through security-definer RPCs only (no insert/update/delete grants).
create policy read_self_or_colleague on app.people for select to authenticated
  using (id = private.person_id() or private.shares_workspace(id));
create policy read_member on app.workspaces for select to authenticated using (private.is_member(id));
create policy read_member on app.memberships for select to authenticated using (private.is_member(workspace_id));
create policy read_admin on app.invitations for select to authenticated using (private.has_role(workspace_id, '{admin}'));
create policy read_member on app.signing_grants for select to authenticated using (private.is_member(workspace_id));
create policy read_scoped on app.families for select to authenticated
  using (private.family_in_scope(workspace_id, id));
create policy read_scoped on app.products for select to authenticated using (private.can_see_product(id));
create policy read_scoped on app.product_nodes for select to authenticated
  using (private.can_see_product(product_id) and private.node_in_scope(workspace_id, node_id));
create policy read_scoped on app.checks for select to authenticated
  using (private.can_see_product(product_id) and private.node_in_scope(workspace_id, node_id));
create policy read_scoped on app.check_findings for select to authenticated
  using (private.can_see_product(product_id) and private.node_in_scope(workspace_id, node_id));

do $$
declare t text;
begin
  foreach t in array array['formula_lines','intended_claims','artwork_versions','extraction_runs','artwork_panels',
                           'text_objects','classifications','envelopes','envelope_items','reports','certificates',
                           'registrations','registration_packs','alerts'] loop
    execute format('create policy read_scoped on app.%I for select to authenticated using (private.can_see_product(product_id))', t);
  end loop;
  foreach t in array array['jobs','shares','supersessions','suppliers','supplier_documents','document_requests',
                           'subscriptions','allowances','allowance_consumptions','saved_views'] loop
    execute format('create policy read_member on app.%I for select to authenticated using (private.is_member(workspace_id))', t);
  end loop;
  foreach t in array array['billing_details','payment_events','share_access_log'] loop
    execute format('create policy read_admin on app.%I for select to authenticated using (private.has_role(workspace_id, ''{admin}''))', t);
  end loop;
end $$;

create policy read_own on app.notifications for select to authenticated using (person_id = private.person_id());
create policy read_own on app.notification_prefs for select to authenticated using (person_id = private.person_id());
create policy read_own on app.alert_reads for select to authenticated using (person_id = private.person_id());
create policy read_managers on app.audit_events for select to authenticated
  using (private.has_role(workspace_id, '{admin,portfolio_manager}'));
-- app.model_calls deliberately has no policy: unreadable by clients (service role only).

-- ref: shared and readable, except unaccepted content, which only staff tooling sees.
alter table ref.rule_versions enable row level security;
alter table ref.term_entries enable row level security;
create policy read_accepted on ref.rule_versions for select to authenticated
  using (status = 'accepted' or private.is_staff());
create policy read_accepted on ref.term_entries for select to authenticated
  using (status = 'accepted' or private.is_staff());

-- ─── Grants ────────────────────────────────────────────────────────────────────────────────────
revoke all on schema app, ref, private from public;
revoke all on all tables in schema app from public;
revoke all on all tables in schema ref from public;
revoke all on all functions in schema private from public;
grant usage on schema extensions to authenticated, service_role;

grant usage on schema app to authenticated, service_role;
grant select on all tables in schema app to authenticated;
grant select, insert, update, delete on all tables in schema app to service_role;
grant usage, select on all sequences in schema app to service_role;

grant usage on schema ref to authenticated, service_role;
grant select on all tables in schema ref to authenticated;
revoke select on ref.rule_candidates, ref.sources, ref.term_decisions from authenticated;   -- staff tooling only
grant select, insert, update, delete on all tables in schema ref to service_role;

grant usage on schema private to authenticated, service_role;
grant execute on all functions in schema private to authenticated, service_role;

-- anon reaches nothing in app or ref (BE-28). Verification goes through public.verify_reference only.
revoke all on schema app, ref, private from anon;
revoke all on all tables in schema app from anon;
revoke all on all tables in schema ref from anon;
revoke all on all functions in schema private from anon;

-- ─── Insert-only enforcement (BE-05): revoke AND trigger ────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['app.checks','app.check_findings','app.reports','app.certificates','app.supersessions',
                           'app.supplier_documents','app.audit_events','app.payment_events',
                           'app.allowance_consumptions','app.classifications','app.model_calls',
                           'app.share_access_log','ref.ruleset_versions','ref.ruleset_members',
                           'ref.term_decisions'] loop
    execute format('revoke update, delete, truncate on %s from authenticated, service_role, anon', t);
    execute format('create trigger insert_only_row before update or delete on %s for each row execute function private.reject_mutation()', t);
    execute format('create trigger insert_only_truncate before truncate on %s for each statement execute function private.reject_mutation()', t);
  end loop;
end $$;

-- BE-13: products have no delete at all.
revoke delete, truncate on app.products from authenticated, service_role, anon;
create trigger products_no_delete before delete on app.products
  for each row execute function private.reject_mutation();
