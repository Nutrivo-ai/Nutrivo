-- T-804 · O03: app.request_export and the exports bucket. Admins request, free on every plan and never gated (BE-44),
-- one open export per workspace, the payload holds ids only, and only an admin of the workspace reads its exports.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(19);
set local client_min_messages = warning;

-- ─── A: Alice (admin), Carl (editor), Vera (viewer), active, free. B: Bob (admin). C: Cara (admin), closed, free,
-- cancelled. D: Dora (admin), dunning, past due. ───────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-4000-8804-0000000000a1','alice@a.test'), ('00000000-0000-4000-8804-0000000000c1','carl@a.test'),
  ('00000000-0000-4000-8804-0000000000f1','vera@a.test'),  ('00000000-0000-4000-8804-0000000000b1','bob@b.test'),
  ('00000000-0000-4000-8804-0000000000c2','cara@c.test'),  ('00000000-0000-4000-8804-0000000000d2','dora@d.test');
insert into app.people (id, user_id, display_name, email)
select ('10000000' || substr(u.id::text, 9))::uuid, u.id, split_part(u.email, '@', 1), u.email
from auth.users u where u.id::text like '00000000-0000-4000-8804-%';
insert into app.workspaces (id, name, plan, status) values
  ('20000000-0000-4000-8804-00000000000a','Workspace A','free','active'),
  ('20000000-0000-4000-8804-00000000000b','Workspace B','basic','active'),
  ('20000000-0000-4000-8804-00000000000c','Workspace C','free','closed'),
  ('20000000-0000-4000-8804-00000000000d','Workspace D','standard','dunning');
insert into app.subscriptions (workspace_id, plan, status) values
  ('20000000-0000-4000-8804-00000000000c','basic','canceled'),
  ('20000000-0000-4000-8804-00000000000d','standard','past_due');
insert into app.memberships (workspace_id, person_id, role) values
  ('20000000-0000-4000-8804-00000000000a','10000000-0000-4000-8804-0000000000a1','admin'),
  ('20000000-0000-4000-8804-00000000000a','10000000-0000-4000-8804-0000000000c1','editor'),
  ('20000000-0000-4000-8804-00000000000a','10000000-0000-4000-8804-0000000000f1','viewer'),
  ('20000000-0000-4000-8804-00000000000b','10000000-0000-4000-8804-0000000000b1','admin'),
  ('20000000-0000-4000-8804-00000000000c','10000000-0000-4000-8804-0000000000c2','admin'),
  ('20000000-0000-4000-8804-00000000000d','10000000-0000-4000-8804-0000000000d2','admin');

create temp table t_jobs (name text primary key, id uuid);
grant all on t_jobs to authenticated;

select ok(not has_function_privilege('anon', 'app.request_export(uuid,text)', 'execute')
          and has_function_privilege('authenticated', 'app.request_export(uuid,text)', 'execute'),
          '[T-804] app.request_export is executable by authenticated users and never by anon');

-- ─── O03.main: an admin requests; one open export at a time ─────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8804-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
insert into t_jobs values ('first', app.request_export('20000000-0000-4000-8804-00000000000a', 'req-o03-main-0001'));
insert into t_jobs values ('again', app.request_export('20000000-0000-4000-8804-00000000000a', 'req-o03-main-0002'));
reset role;
select ok((select id is not null from t_jobs where name = 'first'), '[O03.main] an admin requests a full export');
select ok((select kind = 'export' and status = 'queued' and workspace_id = '20000000-0000-4000-8804-00000000000a'
                  and payload = '{"request_id":"req-o03-main-0001"}'::jsonb
                  and requested_by = '10000000-0000-4000-8804-0000000000a1'
           from app.jobs where id = (select id from t_jobs where name = 'first')),
          '[O03.main] the export job is queued for the workspace with the request_id only in its payload');
select is((select id from t_jobs where name = 'again'), (select id from t_jobs where name = 'first'),
          '[O03.main] a second request while one is open returns the same job');
select is((select count(*)::int from app.jobs where workspace_id = '20000000-0000-4000-8804-00000000000a' and kind = 'export'),
          1, '[O03.main] and queues nothing new');
select is((select count(*)::int from app.audit_events where kind = 'export.requested'
           and workspace_id = '20000000-0000-4000-8804-00000000000a'
           and object_id = (select id::text from t_jobs where name = 'first')
           and actor_id = '10000000-0000-4000-8804-0000000000a1'), 1,
          '[O03.main] the request is audited once, with the requesting admin');

update app.jobs set status = 'succeeded' where id = (select id from t_jobs where name = 'first');
set local role authenticated;
insert into t_jobs values ('next', app.request_export('20000000-0000-4000-8804-00000000000a', 'not a token; drop it'));
reset role;
select ok((select id <> (select id from t_jobs where name = 'first') from t_jobs where name = 'next'),
          '[O03.main] once the export is ready, a new request queues a new job');
select is((select payload from app.jobs where id = (select id from t_jobs where name = 'next')), '{}'::jsonb,
          '[O03.main] a request_id that is not a plain token is dropped, never stored');

-- ─── Refusals ───────────────────────────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8804-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select app.request_export('20000000-0000-4000-8804-00000000000a')$$, '42501', null,
                 '[O03.main] an editor cannot request a full export');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8804-0000000000b1","role":"authenticated"}', true);
select throws_ok($$select app.request_export('20000000-0000-4000-8804-00000000000a')$$, '42501', null,
                 '[O03.main] an admin of another workspace cannot request this one''s export');
reset role;

-- ─── O03.must.1: free on every plan, never gated ────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8804-0000000000c2","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select app.request_export('20000000-0000-4000-8804-00000000000c')$$,
                '[O03.must.1] a closed workspace with a cancelled subscription still exports');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8804-0000000000d2","role":"authenticated"}', true);
select lives_ok($$select app.request_export('20000000-0000-4000-8804-00000000000d')$$,
                '[O03.must.1] a workspace in dunning with a past-due subscription still exports');
reset role;
select is((select count(*)::int from app.jobs where kind = 'export' and workspace_id in
           ('20000000-0000-4000-8804-00000000000c','20000000-0000-4000-8804-00000000000d')), 2,
          '[O03.must.1] both exports are queued');
select is((select count(*)::int from app.jobs where kind = 'export' and workspace_id = '20000000-0000-4000-8804-00000000000a'), 2,
          '[O03.must.1] the free workspace exports as often as it asks');

-- ─── Storage: only an admin of the workspace reads its exports ──────────────────────────────────────────────
insert into storage.objects (bucket_id, name) values
  ('exports', '20000000-0000-4000-8804-00000000000a/one.zip'),
  ('reports', '20000000-0000-4000-8804-00000000000a/report.pdf');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8804-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from storage.objects where bucket_id = 'exports'), 1,
          '[O03.main] an admin reads the workspace''s export, so they can sign its link');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8804-0000000000c1","role":"authenticated"}', true);
select is((select count(*)::int from storage.objects where bucket_id = 'exports'), 0,
          '[O03.main] an editor cannot read the export');
select is((select count(*)::int from storage.objects where bucket_id = 'reports'
           and name like '20000000-0000-4000-8804-00000000000a/%'), 1,
          '[T-804] members still read the workspace''s reports');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8804-0000000000f1","role":"authenticated"}', true);
select is((select count(*)::int from storage.objects where bucket_id = 'exports'), 0,
          '[O03.main] a viewer cannot read the export');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8804-0000000000b1","role":"authenticated"}', true);
select is((select count(*)::int from storage.objects where bucket_id = 'exports'), 0,
          '[O03.main] an admin of another workspace cannot read the export');
reset role;

select * from finish();
rollback;
