-- T-105 · A03.fail.2: inviting an address that already has a pending invitation resends it, never duplicates it.
-- A resend never bypasses the seat check (a lapsed editor invitation needs a free seat to be renewed) and never
-- queues a second email while one is in flight.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(21);
set local client_min_messages = warning;

-- ─── Workspace A: Alice (admin), Carl (editor), three editor seats. B: Bob (admin). ────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-4000-8105-0000000000a1','alice@a.test'), ('00000000-0000-4000-8105-0000000000c1','carl@a.test'),
  ('00000000-0000-4000-8105-0000000000b1','bob@b.test');
insert into app.people (id, user_id, display_name, email)
select ('10000000' || substr(u.id::text, 9))::uuid, u.id, split_part(u.email, '@', 1), u.email
from auth.users u where u.id::text like '00000000-0000-4000-8105-%';
insert into app.workspaces (id, name) values
  ('20000000-0000-4000-8105-00000000000a','Workspace A'), ('20000000-0000-4000-8105-00000000000b','Workspace B');
insert into app.memberships (workspace_id, person_id, role) values
  ('20000000-0000-4000-8105-00000000000a','10000000-0000-4000-8105-0000000000a1','admin'),
  ('20000000-0000-4000-8105-00000000000a','10000000-0000-4000-8105-0000000000c1','editor'),
  ('20000000-0000-4000-8105-00000000000b','10000000-0000-4000-8105-0000000000b1','admin');
insert into app.subscriptions (workspace_id, plan, status, editor_seats)
values ('20000000-0000-4000-8105-00000000000a','basic','active',3);

create temporary table t (k text primary key, id uuid) on commit drop;
grant all on t to authenticated;
create function pg_temp.notify_keys() returns text[] language sql as $$
  select array_agg(idempotency_key order by created_at, idempotency_key) from app.jobs
  where workspace_id = '20000000-0000-4000-8105-00000000000a' and kind = 'notify' $$;
create function pg_temp.maria() returns app.invitations language sql as $$
  select * from app.invitations where id = (select id from t where k = 'maria') $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8105-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
insert into t select 'maria', app.invite_member('20000000-0000-4000-8105-00000000000a', 'Maria@x.test', 'editor');
reset role;
-- The first email went out; then the third seat is sold off, so the plan is full.
update app.jobs set status = 'succeeded' where idempotency_key = 'invite:' || (select id from t where k = 'maria');
update app.subscriptions set editor_seats = 2 where workspace_id = '20000000-0000-4000-8105-00000000000a';

-- ─── A resend within the expiry claims nothing new ──────────────────────────────────────────────────────
set local role authenticated;
select lives_ok($$insert into t select 'again', app.invite_member('20000000-0000-4000-8105-00000000000a', 'maria@x.test', 'viewer')$$,
                '[A03.fail.2] inviting a pending address again resends it, even with the plan full');
reset role;
select is((select id from t where k = 'again'), (pg_temp.maria()).id, '[A03.fail.2] the resend returns the existing invitation');
select is((select count(*)::int from app.invitations where workspace_id = '20000000-0000-4000-8105-00000000000a'), 1,
          '[A03.fail.2] never a duplicate invitation');
select is((pg_temp.maria()).role, 'editor',
          '[A03.fail.2] the resend keeps the invitation''s role; changing it means revoke and invite again');
select is(pg_temp.notify_keys(),
          array['invite:' || (pg_temp.maria()).id, 'invite:' || (pg_temp.maria()).id || ':resend:1'],
          '[A03.fail.2] a second notify job is queued under a new key, so the email goes out again');
select ok((select bool_and(payload = jsonb_build_object('template', 'invitation', 'invitation_id', (pg_temp.maria()).id))
           from app.jobs where workspace_id = '20000000-0000-4000-8105-00000000000a' and kind = 'notify'),
          '[A03.fail.2] the resend job''s payload holds ids only, never a token');
select ok((select count(*) = 1 from pgmq.q_notify q
           where q.message ->> 'job_id' = (select id::text from app.jobs
                                            where idempotency_key = 'invite:' || (pg_temp.maria()).id || ':resend:1')),
          '[A03.fail.2] the resend job reaches the notify queue');
select ok((select actor_id = '10000000-0000-4000-8105-0000000000a1' and after ->> 'role' = 'editor'
                  and (after ->> 'email_queued')::boolean and before ? 'expires_at'
           from app.audit_events where kind = 'invitation.resent' and object_id = (pg_temp.maria()).id::text),
          '[A03.fail.2] the resend is audited as invitation.resent by the admin');

-- ─── A double submit while that email is still queued queues no second one ─────────────────────────────
set local role authenticated;
select lives_ok($$select app.invite_member('20000000-0000-4000-8105-00000000000a', 'maria@x.test', 'editor')$$,
                '[A03.fail.2] a resend while the last email is still queued lives');
reset role;
select is(array_length(pg_temp.notify_keys(), 1), 2,
          '[A03.fail.2] no second notify job while one is in flight: parallel jobs would race on the token');
select ok((select count(*) = 2 and bool_or(not (after ->> 'email_queued')::boolean) from app.audit_events
           where kind = 'invitation.resent' and object_id = (pg_temp.maria()).id::text),
          '[A03.fail.2] the extra resend is still audited, as email_queued false');

-- ─── A lapsed editor invitation needs a free seat to be renewed ────────────────────────────────────────
update app.jobs set status = 'succeeded' where idempotency_key like 'invite:' || (pg_temp.maria()).id || '%';
update app.invitations set expires_at = now() - interval '1 day' where id = (pg_temp.maria()).id;
set local role authenticated;
select throws_ok($$select app.invite_member('20000000-0000-4000-8105-00000000000a', 'maria@x.test', 'editor')$$,
                 'P0033', null, '[A03.fail.2] resending a lapsed editor invitation with no seat left is P0033 (BE-33)');
reset role;
select ok((pg_temp.maria()).expires_at < now() and array_length(pg_temp.notify_keys(), 1) = 2,
          '[A03.fail.2] the refused resend leaves the invitation lapsed and queues nothing');

update app.subscriptions set editor_seats = 3 where workspace_id = '20000000-0000-4000-8105-00000000000a';
set local role authenticated;
select lives_ok($$select app.invite_member('20000000-0000-4000-8105-00000000000a', 'maria@x.test', 'editor')$$,
                '[A03.fail.2] with a seat free, the lapsed editor invitation is resent');
reset role;
select ok((pg_temp.maria()).expires_at > now() + interval '6 days', '[A03.fail.2] the resend renews it for seven days');
select is((pg_temp.notify_keys())[3], 'invite:' || (pg_temp.maria()).id || ':resend:3',
          '[A03.fail.2] and queues its email under a new key');

-- ─── A lapsed viewer invitation never needs a seat ─────────────────────────────────────────────────────
update app.subscriptions set editor_seats = 2 where workspace_id = '20000000-0000-4000-8105-00000000000a';
set local role authenticated;
insert into t select 'vera', app.invite_member('20000000-0000-4000-8105-00000000000a', 'vera@x.test', 'viewer');
reset role;
update app.jobs set status = 'succeeded' where idempotency_key = 'invite:' || (select id from t where k = 'vera');
update app.invitations set expires_at = now() - interval '1 day' where id = (select id from t where k = 'vera');
set local role authenticated;
select lives_ok($$select app.invite_member('20000000-0000-4000-8105-00000000000a', 'vera@x.test', 'viewer')$$,
                '[A03.must.3] a lapsed viewer invitation is resent with the plan full: viewers never use a seat');
reset role;
select ok((select expires_at > now() + interval '6 days' from app.invitations where id = (select id from t where k = 'vera')),
          '[A03.must.3] and renewed');

-- ─── Who may resend, and where ─────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8105-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select app.invite_member('20000000-0000-4000-8105-00000000000a', 'maria@x.test', 'editor')$$,
                 '42501', null, '[A03.must.1] only admins can resend an invitation');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8105-0000000000b1","role":"authenticated"}', true);
select lives_ok($$insert into t select 'other', app.invite_member('20000000-0000-4000-8105-00000000000b', 'maria@x.test', 'viewer')$$,
                '[T-105] the same address pending in another workspace is a new invitation there');
reset role;
select isnt((select id from t where k = 'other'), (pg_temp.maria()).id,
            '[T-105] a pending invitation in one workspace is never resent from another');

select * from finish();
rollback;
