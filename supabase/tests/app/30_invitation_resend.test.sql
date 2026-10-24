-- T-105 · A03.fail.2: inviting an address that already has a pending invitation resends it, never duplicates it.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(14);
set local client_min_messages = warning;

-- ─── Workspace A: Alice (admin), Carl (editor). Two editor seats, both taken. B: Bob (admin). ───────────────
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

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8105-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
insert into t select 'first', app.invite_member('20000000-0000-4000-8105-00000000000a', 'Maria@x.test', 'editor');
reset role;
update app.subscriptions set editor_seats = 2 where workspace_id = '20000000-0000-4000-8105-00000000000a';
-- A lapsed invitation still holds the pending slot.
update app.invitations set expires_at = now() - interval '1 day' where id = (select id from t where k = 'first');
set local role authenticated;
select lives_ok($$insert into t select 'second', app.invite_member('20000000-0000-4000-8105-00000000000a', 'maria@x.test', 'viewer')$$,
                '[A03.fail.2] inviting a pending address again resends, with no seat left and no error');
reset role;

select is((select id from t where k = 'second'), (select id from t where k = 'first'),
          '[A03.fail.2] the resend returns the existing invitation');
select is((select count(*)::int from app.invitations where workspace_id = '20000000-0000-4000-8105-00000000000a'), 1,
          '[A03.fail.2] never a duplicate invitation');
select is((select role from app.invitations where id = (select id from t where k = 'first')), 'editor',
          '[A03.fail.2] the resend keeps the invitation''s role; changing it means revoke and invite again');
select ok((select expires_at > now() + interval '6 days' from app.invitations where id = (select id from t where k = 'first')),
          '[A03.fail.2] the resend renews a lapsed invitation for seven days');
select is((select array_agg(idempotency_key order by created_at, idempotency_key) from app.jobs
           where workspace_id = '20000000-0000-4000-8105-00000000000a' and kind = 'notify'),
          array['invite:' || (select id from t where k = 'first'), 'invite:' || (select id from t where k = 'first') || ':resend:1'],
          '[A03.fail.2] a second notify job is queued under a new key, so the email goes out again');
select ok((select bool_and(payload = jsonb_build_object('template', 'invitation', 'invitation_id', (select id from t where k = 'first')))
           from app.jobs where workspace_id = '20000000-0000-4000-8105-00000000000a' and kind = 'notify'),
          '[A03.fail.2] the resend job''s payload holds ids only, never a token');
select ok((select count(*) = 2 from pgmq.q_notify q join app.jobs j on j.id::text = q.message ->> 'job_id'
           where j.workspace_id = '20000000-0000-4000-8105-00000000000a'),
          '[A03.fail.2] both jobs reach the notify queue');
select ok((select actor_id = '10000000-0000-4000-8105-0000000000a1' and object_id = (select id from t where k = 'first')::text
                  and after ->> 'role' = 'editor' and before ? 'expires_at'
           from app.audit_events where kind = 'invitation.resent'
             and workspace_id = '20000000-0000-4000-8105-00000000000a'),
          '[A03.fail.2] the resend is audited as invitation.resent by the admin');

set local role authenticated;
select lives_ok($$select app.invite_member('20000000-0000-4000-8105-00000000000a', 'maria@x.test', 'editor')$$,
                '[A03.fail.2] a second resend also lives');
reset role;
select ok((select count(*) = 3 and count(distinct idempotency_key) = 3 from app.jobs
           where workspace_id = '20000000-0000-4000-8105-00000000000a' and kind = 'notify'),
          '[A03.fail.2] each resend queues its own email');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8105-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select app.invite_member('20000000-0000-4000-8105-00000000000a', 'maria@x.test', 'editor')$$,
                 '42501', null, '[A03.must.1] only admins can resend an invitation');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8105-0000000000b1","role":"authenticated"}', true);
select lives_ok($$insert into t select 'other', app.invite_member('20000000-0000-4000-8105-00000000000b', 'maria@x.test', 'viewer')$$,
                '[T-105] the same address pending in another workspace is a new invitation there');
reset role;
select isnt((select id from t where k = 'other'), (select id from t where k = 'first'),
            '[T-105] a pending invitation in one workspace is never resent from another');

select * from finish();
rollback;
