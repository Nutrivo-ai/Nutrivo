-- T-104 · People and operator write paths: A05 change a member, A06 remove a member, A03 revoke an invitation,
-- B01 set the default operator. Pattern of 0005: security definer, search_path = '', permission check first,
-- one transaction, private.write_audit, private.enqueue. Tests: supabase/tests/app/20_members_operator.test.sql.
--
-- Last admin (A05.must.1, A06.fail.1): a write that touches an active admin must leave at least one other active
-- admin with no end date, or it raises P0043. Membership writes in a workspace serialise on an advisory lock, so two
-- admins demoting each other at the same moment cannot both succeed.

-- The editable state of a membership, as written to audit_events.before / after.
create function private.membership_audit(m app.memberships) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('person_id', m.person_id, 'role', m.role, 'is_external', m.is_external,
                            'scope_family_ids', m.scope_family_ids, 'scope_node_ids', m.scope_node_ids,
                            'access_ends_at', m.access_ends_at, 'ended_at', m.ended_at, 'ended_reason', m.ended_reason)
$$;

-- A05: change a role, scope, external flag or end date. The caller passes the whole editable state (null scope =
-- everything, null end date = no end), so nothing is cleared by omission. A role change never creates a signing
-- grant (BE-04); becoming external revokes them in this transaction (the membership_grant_sync trigger is the backstop).
create function app.change_member(p_membership uuid, p_role text, p_is_external boolean,
                                  p_scope_family_ids uuid[], p_scope_node_ids text[],
                                  p_access_ends_at timestamptz) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_m app.memberships; v_after app.memberships; v_used int; v_included int; v_revoked int := 0;
begin
  select * into v_m from app.memberships m where m.id = p_membership;
  if not found or not private.has_role(v_m.workspace_id, '{admin}') then
    raise exception 'only admins can change a member' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('memberships:' || v_m.workspace_id::text));
  select * into v_m from app.memberships m where m.id = p_membership for update;
  if v_m.ended_at is not null then
    raise exception 'this membership has ended' using errcode = 'P0044';
  end if;

  if p_access_ends_at is not null and p_access_ends_at <= now()
     and p_access_ends_at is distinct from v_m.access_ends_at then
    raise exception 'an end date must be in the future; remove the member instead' using errcode = '22023';
  end if;
  if cardinality(p_scope_family_ids) = 0 or cardinality(p_scope_node_ids) = 0 then
    raise exception 'a scope lists at least one family or market; null means all of them' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_scope_family_ids) s(f)
             where not exists (select 1 from app.families fa where fa.id = s.f and fa.workspace_id = v_m.workspace_id)) then
    raise exception 'a scoped family is not in this workspace' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_scope_node_ids) s(n)
             where not exists (select 1 from ref.jurisdictions j where j.id = s.n)) then
    raise exception 'a scoped market is not a known jurisdiction' using errcode = '22023';
  end if;

  if v_m.role = 'admin' and (v_m.access_ends_at is null or v_m.access_ends_at > now())
     and (p_role is distinct from 'admin' or p_access_ends_at is not null)
     and not exists (select 1 from app.memberships o
                     where o.workspace_id = v_m.workspace_id and o.id <> v_m.id and o.role = 'admin'
                       and o.ended_at is null and o.access_ends_at is null) then
    raise exception 'the last admin cannot be demoted or given an end date' using errcode = 'P0043';
  end if;

  -- Seats (BE-33): only a change that makes this membership start counting as an editor seat needs one.
  if p_role in ('admin','portfolio_manager','editor') and (p_access_ends_at is null or p_access_ends_at > now())
     and not (v_m.role in ('admin','portfolio_manager','editor')
              and (v_m.access_ends_at is null or v_m.access_ends_at > now())) then
    select s.editor_seats into v_included from app.subscriptions s where s.workspace_id = v_m.workspace_id;
    if v_included is not null then
      select count(*) into v_used from app.memberships m
      where m.workspace_id = v_m.workspace_id and m.ended_at is null
        and (m.access_ends_at is null or m.access_ends_at > now())
        and m.role in ('admin','portfolio_manager','editor');
      if v_used >= v_included then
        raise exception 'BE-33: no editor seat left on this plan' using errcode = 'P0033';
      end if;
    end if;
  end if;

  if p_role is not distinct from v_m.role and p_is_external is not distinct from v_m.is_external
     and p_scope_family_ids is not distinct from v_m.scope_family_ids
     and p_scope_node_ids is not distinct from v_m.scope_node_ids
     and p_access_ends_at is not distinct from v_m.access_ends_at then
    return v_m.id;   -- nothing changes: no write, no audit
  end if;

  if p_is_external and not v_m.is_external then
    update app.signing_grants g set revoked_at = now(), revoked_by = private.person_id()
    where g.workspace_id = v_m.workspace_id and g.person_id = v_m.person_id and g.revoked_at is null;
    get diagnostics v_revoked = row_count;
  end if;

  -- Audit before the update, as in remove_member: the actor's external flag is stamped as it was when they acted.
  v_after := v_m;
  v_after.role := p_role; v_after.is_external := p_is_external; v_after.scope_family_ids := p_scope_family_ids;
  v_after.scope_node_ids := p_scope_node_ids; v_after.access_ends_at := p_access_ends_at;
  perform private.write_audit(v_m.workspace_id, 'membership.changed', 'membership', v_m.id::text,
                              private.membership_audit(v_m),
                              private.membership_audit(v_after) || jsonb_build_object('signing_grants_revoked', v_revoked));
  update app.memberships m
  set role = p_role, is_external = p_is_external, scope_family_ids = p_scope_family_ids,
      scope_node_ids = p_scope_node_ids, access_ends_at = p_access_ends_at
  where m.id = v_m.id;
  return v_m.id;
end $$;

-- A06: remove a member. The row stays (ended_at, ended_reason), so every past event still resolves its actor
-- (BE-06); access ends on the next request because every private helper requires ended_at is null. Signing grants
-- are revoked here, and a 'session_revoke' job signs the person out (payload: ids only). Idempotent.
create function app.remove_member(p_membership uuid, p_reason text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_m app.memberships; v_revoked int;
begin
  select * into v_m from app.memberships m where m.id = p_membership;
  if not found or not private.has_role(v_m.workspace_id, '{admin}') then
    raise exception 'only admins can remove a member' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('memberships:' || v_m.workspace_id::text));
  select * into v_m from app.memberships m where m.id = p_membership for update;
  if v_m.ended_at is not null then return v_m.id; end if;

  if v_m.role = 'admin' and (v_m.access_ends_at is null or v_m.access_ends_at > now())
     and not exists (select 1 from app.memberships o
                     where o.workspace_id = v_m.workspace_id and o.id <> v_m.id and o.role = 'admin'
                       and o.ended_at is null and o.access_ends_at is null) then
    raise exception 'the last admin cannot be removed' using errcode = 'P0043';
  end if;

  update app.signing_grants g set revoked_at = now(), revoked_by = private.person_id()
  where g.workspace_id = v_m.workspace_id and g.person_id = v_m.person_id and g.revoked_at is null;
  get diagnostics v_revoked = row_count;

  -- Audit before the update: write_audit stamps the actor's external flag from their active membership, which is
  -- this one when an admin removes themselves.
  perform private.write_audit(v_m.workspace_id, 'membership.ended', 'membership', v_m.id::text,
                              private.membership_audit(v_m),
                              private.membership_audit(v_m)
                                || jsonb_build_object('ended_at', now(), 'ended_reason', nullif(btrim(p_reason), ''),
                                                      'signing_grants_revoked', v_revoked));
  update app.memberships m set ended_at = now(), ended_reason = nullif(btrim(p_reason), '')
  where m.id = v_m.id;
  perform private.enqueue('session_revoke', v_m.workspace_id, 'session_revoke:' || v_m.id::text,
                          jsonb_build_object('membership_id', v_m.id, 'person_id', v_m.person_id));
  return v_m.id;
end $$;

-- A03: revoke a pending invitation. Its queued 'notify' job is cancelled so no token is ever minted for it.
-- Idempotent; an accepted invitation cannot be revoked (remove the member instead).
create function app.revoke_invitation(p_invitation uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_inv app.invitations;
begin
  select * into v_inv from app.invitations i where i.id = p_invitation;
  if not found or not private.has_role(v_inv.workspace_id, '{admin}') then
    raise exception 'only admins can revoke an invitation' using errcode = '42501';
  end if;
  select * into v_inv from app.invitations i where i.id = p_invitation for update;
  if v_inv.revoked_at is not null then return v_inv.id; end if;
  if v_inv.accepted_at is not null then
    raise exception 'this invitation was already accepted; remove the member instead' using errcode = 'P0040';
  end if;
  update app.invitations i set revoked_at = now() where i.id = v_inv.id;
  update app.jobs j set status = 'cancelled', updated_at = now()
  where j.idempotency_key = 'invite:' || v_inv.id::text and j.status = 'queued';
  perform private.write_audit(v_inv.workspace_id, 'invitation.revoked', 'invitation', v_inv.id::text,
                              jsonb_build_object('email', v_inv.email, 'role', v_inv.role, 'is_external', v_inv.is_external),
                              jsonb_build_object('revoked_at', now()));
  return v_inv.id;
end $$;

-- B01: the business responsible for labelling, exactly as printed: {name, address, country, approval_number?}.
-- The approval or registration number is optional; without it the establishment-number rule reports Action once
-- that rule is encoded. Products inherit this unless they override it; past checks never change (they are
-- insert-only and do not read it).
create function app.set_default_operator(p_ws uuid, p_operator jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_before jsonb; v_after jsonb;
begin
  if not private.has_role(p_ws, '{admin}') then
    raise exception 'only admins can set the default operator' using errcode = '42501';
  end if;
  if jsonb_typeof(p_operator) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p_operator) k
                where k not in ('name','address','country','approval_number'))
     or jsonb_typeof(p_operator -> 'name') is distinct from 'string'
     or length(btrim(p_operator ->> 'name')) not between 1 and 300
     or jsonb_typeof(p_operator -> 'address') is distinct from 'string'
     or length(btrim(p_operator ->> 'address')) not between 1 and 500
     or jsonb_typeof(p_operator -> 'country') is distinct from 'string'
     or (p_operator ->> 'country') !~ '^[A-Z]{2}$'
     or jsonb_typeof(coalesce(p_operator -> 'approval_number', 'null')) not in ('string','null')
     or length(p_operator ->> 'approval_number') > 100 then
    raise exception 'the operator needs a name, an address and a two-letter country code; the approval number is optional'
      using errcode = '22023';
  end if;
  v_after := jsonb_strip_nulls(jsonb_build_object(
    'name', btrim(p_operator ->> 'name'), 'address', btrim(p_operator ->> 'address'),
    'country', p_operator ->> 'country', 'approval_number', nullif(btrim(p_operator ->> 'approval_number'), '')));

  select w.default_operator into v_before from app.workspaces w where w.id = p_ws for update;
  if v_before is not distinct from v_after then return p_ws; end if;
  update app.workspaces w set default_operator = v_after where w.id = p_ws;
  perform private.write_audit(p_ws, 'workspace.default_operator_set', 'workspace', p_ws::text, v_before, v_after);
  return p_ws;
end $$;

revoke all on function private.membership_audit(app.memberships) from public, anon;
revoke all on function app.change_member(uuid, text, boolean, uuid[], text[], timestamptz) from public, anon;
revoke all on function app.remove_member(uuid, text) from public, anon;
revoke all on function app.revoke_invitation(uuid) from public, anon;
revoke all on function app.set_default_operator(uuid, jsonb) from public, anon;
grant execute on function private.membership_audit(app.memberships) to authenticated, service_role;
grant execute on function app.change_member(uuid, text, boolean, uuid[], text[], timestamptz) to authenticated, service_role;
grant execute on function app.remove_member(uuid, text) to authenticated, service_role;
grant execute on function app.revoke_invitation(uuid) to authenticated, service_role;
grant execute on function app.set_default_operator(uuid, jsonb) to authenticated, service_role;
