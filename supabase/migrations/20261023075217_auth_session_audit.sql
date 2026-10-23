-- T-103 · Sign-in and password access events (A02, A07), and what the Access removed screen may read (S-REC-004).
-- Tests: supabase/tests/app/30_auth_session.test.sql.
--
-- The access events are recorded where they happen: Supabase Auth inserts a row in auth.sessions for every sign-in
-- (password, magic link, recovery link) and updates auth.users.encrypted_password for every password change or reset.
-- Triggers there need no client call, so a client can neither skip nor forge them. They write one row per active
-- membership (audit_events is per workspace), never block the sign-in or the change they record (a failure becomes a
-- warning in the database log), and never record a password, its hash, a token or an email address (A07.must.1).

-- The active memberships of the person holding an auth user, for the two triggers below.
create function private.active_workspaces_of(p_user uuid)
returns table (person_id uuid, workspace_id uuid, is_external boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, m.workspace_id, m.is_external
  from app.people p join app.memberships m on m.person_id = p.id
  where p.user_id = p_user and p.tombstoned_at is null and m.ended_at is null
    and (m.access_ends_at is null or m.access_ends_at > now())
$$;

-- A02 step 5: session.started, with the assurance level the session began at.
create function private.audit_session_started() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    insert into app.audit_events (workspace_id, actor_id, actor_is_external, kind, object_type, object_id, after)
    select a.workspace_id, a.person_id, a.is_external, 'session.started', 'session', new.id::text,
           jsonb_build_object('aal', coalesce(new.aal::text, 'aal1'))
    from private.active_workspaces_of(new.user_id) a;
  exception when others then
    raise warning 'T-103: session.started was not audited for session %: %', new.id, sqlstate;
  end;
  return null;
end $$;
create trigger audit_session_started after insert on auth.sessions
  for each row execute function private.audit_session_started();

-- A07 step 3: the access event, never the secret. Neither before nor after is written.
create function private.audit_password_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    insert into app.audit_events (workspace_id, actor_id, actor_is_external, kind, object_type, object_id)
    select a.workspace_id, a.person_id, a.is_external, 'access.password_changed', 'person', a.person_id::text
    from private.active_workspaces_of(new.id) a;
  exception when others then
    raise warning 'T-103: access.password_changed was not audited for user %: %', new.id, sqlstate;
  end;
  return null;
end $$;
create trigger audit_password_changed after update of encrypted_password on auth.users
  for each row when (old.encrypted_password is distinct from new.encrypted_password)
  execute function private.audit_password_changed();

-- S-REC-004 (A02.fail.1): what a person whose membership ended may still read about that workspace: its name, the
-- date access ended, and the admin to ask. Null for an active member (the shell serves them) and for anybody who
-- never had a membership there, so it tells a stranger nothing NoAccess does not (BE-03). It never says whether the
-- end date passed or an admin removed them (the design's "It never says which").
create function app.my_ended_access(p_ws uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_person uuid := private.person_id(); v_ended timestamptz; v_ws app.workspaces; v_admin app.people;
begin
  if v_person is null or p_ws is null or private.is_member(p_ws) then return null; end if;
  select max(coalesce(m.ended_at, m.access_ends_at)) into v_ended
  from app.memberships m
  where m.workspace_id = p_ws and m.person_id = v_person
    and (m.ended_at is not null or m.access_ends_at <= now());
  if v_ended is null then return null; end if;
  select * into v_ws from app.workspaces w where w.id = p_ws;
  -- The admin to ask: an active admin who was already in the workspace before the caller's access ended, so the
  -- name and email are ones the caller could read while a member (shares_workspace), never a later admin's. The
  -- creator first, otherwise the longest-standing; none, and the screen offers the person's other workspaces.
  select p.* into v_admin
  from app.memberships m join app.people p on p.id = m.person_id
  where m.workspace_id = p_ws and m.role = 'admin' and m.ended_at is null and p.tombstoned_at is null
    and (m.access_ends_at is null or m.access_ends_at > now()) and m.created_at < v_ended
  order by (p.id = v_ws.created_by) desc, m.created_at, m.id
  limit 1;
  return jsonb_build_object('workspace_name', v_ws.name, 'ended_on', v_ended,
                            'admin_name', v_admin.display_name, 'admin_email', v_admin.email);
end $$;

revoke all on function private.active_workspaces_of(uuid) from public, anon, authenticated;
revoke all on function private.audit_session_started() from public, anon, authenticated;
revoke all on function private.audit_password_changed() from public, anon, authenticated;
revoke all on function app.my_ended_access(uuid) from public, anon;
grant execute on function app.my_ended_access(uuid) to authenticated, service_role;
