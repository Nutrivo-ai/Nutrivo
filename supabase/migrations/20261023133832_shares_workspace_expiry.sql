-- T-103 · A02.must.1 (BE-03): an expired membership gives no access, colleagues' names and emails included.
-- private.shares_workspace checked only ended_at, unlike every other membership helper (20261008000004), so a member
-- past access_ends_at still read every person in the workspace through app.people. It now applies the same
-- condition as private.is_member, and a tombstoned person shares nothing. CREATE OR REPLACE keeps its grants.
-- Tests: supabase/tests/app/30_auth_session.test.sql.
create or replace function private.shares_workspace(other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app.memberships a
    join app.people me on me.id = a.person_id
    join app.memberships b on b.workspace_id = a.workspace_id
    where me.user_id = auth.uid() and me.tombstoned_at is null and a.ended_at is null
      and (a.access_ends_at is null or a.access_ends_at > now())
      and b.person_id = other)
$$;
