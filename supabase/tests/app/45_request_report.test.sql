-- T-408 · I01: app.request_report, the producer of the worker's report job (#188). An editor-class member who sees the
-- check's product and market requests; the same check always gives the same job; the payload holds ids only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(22);
set local client_min_messages = warning;

-- ─── A: Alice (admin), Carl (editor), Vera (viewer), Sid (editor scoped to EU-FR), Dee (editor scoped to EU-DE),
-- Olga (editor, access ended), Ezra (external editor), Fay (editor scoped to another family). B: Bob (admin). ──────
insert into auth.users (id, email) values
  ('00000000-0000-4000-8408-0000000000a1','alice@a.test'), ('00000000-0000-4000-8408-0000000000c1','carl@a.test'),
  ('00000000-0000-4000-8408-0000000000f1','vera@a.test'),  ('00000000-0000-4000-8408-0000000000e4','sid@a.test'),
  ('00000000-0000-4000-8408-0000000000e5','dee@a.test'),   ('00000000-0000-4000-8408-0000000000e3','olga@a.test'),
  ('00000000-0000-4000-8408-0000000000e1','ezra@agency.test'), ('00000000-0000-4000-8408-0000000000e6','fay@a.test'),
  ('00000000-0000-4000-8408-0000000000b1','bob@b.test');
insert into app.people (id, user_id, display_name, email)
select ('10000000' || substr(u.id::text, 9))::uuid, u.id, split_part(u.email, '@', 1), u.email
from auth.users u where u.id::text like '00000000-0000-4000-8408-%';
insert into app.workspaces (id, name, plan, status) values
  ('20000000-0000-4000-8408-00000000000a','Workspace A','basic','active'),
  ('20000000-0000-4000-8408-00000000000b','Workspace B','basic','active');
insert into app.families (id, workspace_id, name) values
  ('30000000-0000-4000-8408-00000000000a','20000000-0000-4000-8408-00000000000a','Family A'),
  ('30000000-0000-4000-8408-00000000000f','20000000-0000-4000-8408-00000000000a','Family F');
insert into app.memberships (workspace_id, person_id, role, is_external, scope_family_ids, scope_node_ids, access_ends_at) values
  ('20000000-0000-4000-8408-00000000000a','10000000-0000-4000-8408-0000000000a1','admin',false,null,null,null),
  ('20000000-0000-4000-8408-00000000000a','10000000-0000-4000-8408-0000000000c1','editor',false,null,null,null),
  ('20000000-0000-4000-8408-00000000000a','10000000-0000-4000-8408-0000000000f1','viewer',false,null,null,null),
  ('20000000-0000-4000-8408-00000000000a','10000000-0000-4000-8408-0000000000e4','editor',false,null,'{EU-FR}',null),
  ('20000000-0000-4000-8408-00000000000a','10000000-0000-4000-8408-0000000000e5','editor',false,null,'{EU-DE}',null),
  ('20000000-0000-4000-8408-00000000000a','10000000-0000-4000-8408-0000000000e3','editor',false,null,null,now() - interval '1 day'),
  ('20000000-0000-4000-8408-00000000000a','10000000-0000-4000-8408-0000000000e1','editor',true,null,null,null),
  ('20000000-0000-4000-8408-00000000000a','10000000-0000-4000-8408-0000000000e6','editor',false,
   '{30000000-0000-4000-8408-00000000000f}',null,null),
  ('20000000-0000-4000-8408-00000000000b','10000000-0000-4000-8408-0000000000b1','admin',false,null,null,null);
insert into app.products (id, workspace_id, family_id, name) values
  ('40000000-0000-4000-8408-00000000000a','20000000-0000-4000-8408-00000000000a','30000000-0000-4000-8408-00000000000a','Product A');
-- Two checks of the product: Germany's German panel and France's French panel.
insert into app.checks (id, workspace_id, product_id, node_id, ruleset_version, artwork_sha, language, label_state,
                        withheld_rule_keys) values
  ('50000000-0000-4000-8408-0000000000de','20000000-0000-4000-8408-00000000000a','40000000-0000-4000-8408-00000000000a',
   'EU-DE','0000.00-empty',repeat('a', 64),'de','not_assessed','{TEST.T408.FIXTURE}'),
  ('50000000-0000-4000-8408-0000000000f2','20000000-0000-4000-8408-00000000000a','40000000-0000-4000-8408-00000000000a',
   'EU-FR','0000.00-empty',repeat('a', 64),'fr','not_assessed','{TEST.T408.FIXTURE}');

create temp table t_jobs (name text primary key, id uuid);
grant all on t_jobs to authenticated;
create function pg_temp.as_user(p_sub text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true)
$$;

select ok(not has_function_privilege('anon', 'app.request_report(uuid,text)', 'execute')
          and not has_function_privilege('public', 'app.request_report(uuid,text)', 'execute')
          and has_function_privilege('authenticated', 'app.request_report(uuid,text)', 'execute'),
          '[T-408] app.request_report is executable by authenticated users and never by anon or public');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p
           where p.oid = 'app.request_report(uuid,text)'::regprocedure),
          '[T-408] app.request_report is security definer with an empty search_path');

-- ─── I01.main: an editor requests a check's report ──────────────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-4000-8408-0000000000c1');
set local role authenticated;
insert into t_jobs values ('first', app.request_report('50000000-0000-4000-8408-0000000000de', 'req-i01-main-0001'));
reset role;
select ok((select id is not null from t_jobs where name = 'first'), '[I01.main] an editor requests a check''s report');
select ok((select kind = 'report' and status = 'queued' and workspace_id = '20000000-0000-4000-8408-00000000000a'
                  and idempotency_key = 'report:50000000-0000-4000-8408-0000000000de'
                  and requested_by = '10000000-0000-4000-8408-0000000000c1'
           from app.jobs where id = (select id from t_jobs where name = 'first')),
          '[I01.main] the report job is queued in the check''s workspace, keyed by the check, with the requester');
select is((select payload from app.jobs where id = (select id from t_jobs where name = 'first')),
          '{"check_id":"50000000-0000-4000-8408-0000000000de","request_id":"req-i01-main-0001"}'::jsonb,
          '[I01.main] the payload holds the check id and the request_id only, as the worker''s report handler reads it');
select is((select count(*)::int from app.audit_events where kind = 'report.requested'
           and workspace_id = '20000000-0000-4000-8408-00000000000a' and object_type = 'job'
           and object_id = (select id::text from t_jobs where name = 'first')
           and actor_id = '10000000-0000-4000-8408-0000000000c1' and ruleset_version = '0000.00-empty'
           and after ->> 'check_id' = '50000000-0000-4000-8408-0000000000de' and after ->> 'node_id' = 'EU-DE'), 1,
          '[I01.main] the request is audited once, with the requester, the check and its ruleset version');

-- ─── I01.must.1: the same check gives the same job, so it keeps one reference ──────────────────────────────────
select pg_temp.as_user('00000000-0000-4000-8408-0000000000a1');
set local role authenticated;
insert into t_jobs values ('again', app.request_report('50000000-0000-4000-8408-0000000000de', 'req-i01-main-0002'));
reset role;
select is((select id from t_jobs where name = 'again'), (select id from t_jobs where name = 'first'),
          '[I01.must.1] a repeat request for the same check, by another member, returns the same job');
update app.jobs set status = 'succeeded', progress = '{"ref":"T408REFAAAAAAAAAAAAAAAAAAA"}'
where id = (select id from t_jobs where name = 'first');
select pg_temp.as_user('00000000-0000-4000-8408-0000000000c1');
set local role authenticated;
insert into t_jobs values ('after', app.request_report('50000000-0000-4000-8408-0000000000de'));
reset role;
select is((select id from t_jobs where name = 'after'), (select id from t_jobs where name = 'first'),
          '[I01.must.1] once the report is generated, a repeat request returns that job and its one reference');
select is((select count(*)::int from app.jobs where kind = 'report'
           and payload ->> 'check_id' = '50000000-0000-4000-8408-0000000000de'), 1,
          '[I01.must.1] and nothing new is queued for the check');
select is((select count(*)::int from app.audit_events where kind = 'report.requested'
           and after ->> 'check_id' = '50000000-0000-4000-8408-0000000000de'), 1,
          '[I01.must.1] a repeat request writes no second audit event');
select is((select payload from app.jobs where id = (select id from t_jobs where name = 'first')) ->> 'request_id',
          'req-i01-main-0001', '[I01.must.1] the job keeps the first request''s payload');

-- ─── Scope: a market-scoped editor requests only their market's check ────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-4000-8408-0000000000e5');
set local role authenticated;
select throws_ok($$select app.request_report('50000000-0000-4000-8408-0000000000f2')$$, '42501', null,
                 '[I01.main] an editor scoped to Germany cannot request France''s report');
insert into t_jobs values ('de_by_de', app.request_report('50000000-0000-4000-8408-0000000000de'));
select pg_temp.as_user('00000000-0000-4000-8408-0000000000e4');
insert into t_jobs values ('fr', app.request_report('50000000-0000-4000-8408-0000000000f2', 'not a token; drop it'));
reset role;
select is((select id from t_jobs where name = 'de_by_de'), (select id from t_jobs where name = 'first'),
          '[I01.main] an editor scoped to the check''s market can request it');
select ok((select id is not null and id <> (select id from t_jobs where name = 'first') from t_jobs where name = 'fr'),
          '[I01.main] another check of the same product is its own job');
select is((select payload from app.jobs where id = (select id from t_jobs where name = 'fr')),
          '{"check_id":"50000000-0000-4000-8408-0000000000f2"}'::jsonb,
          '[T-408] a request_id that is not a plain token is dropped, never stored');

-- ─── Refusals, all 42501 so a check''s existence never leaks ───────────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8408-0000000000f1');
select throws_ok($$select app.request_report('50000000-0000-4000-8408-0000000000de')$$, '42501', null,
                 '[I01.main] a viewer cannot request a report (#188 Q2, conservative default)');
select pg_temp.as_user('00000000-0000-4000-8408-0000000000b1');
select throws_ok($$select app.request_report('50000000-0000-4000-8408-0000000000de')$$, '42501', null,
                 '[I01.main] an admin of another workspace cannot request this workspace''s report');
select pg_temp.as_user('00000000-0000-4000-8408-0000000000e6');
select throws_ok($$select app.request_report('50000000-0000-4000-8408-0000000000de')$$, '42501', null,
                 '[I01.main] an editor scoped to another family cannot request the product''s report');
select pg_temp.as_user('00000000-0000-4000-8408-0000000000e3');
select throws_ok($$select app.request_report('50000000-0000-4000-8408-0000000000de')$$, '42501', null,
                 '[I01.main] an editor whose access has ended cannot request a report');
select pg_temp.as_user('00000000-0000-4000-8408-0000000000a1');
select throws_ok($$select app.request_report('50000000-0000-4000-8408-000000000000')$$, '42501', null,
                 '[I01.main] an unknown check is refused like a hidden one');
select pg_temp.as_user('00000000-0000-4000-8408-0000000000e1');
select lives_ok($$select app.request_report('50000000-0000-4000-8408-0000000000de')$$,
                '[I01.main] an external editor within scope can request a report');
reset role;
select is((select count(*)::int from app.jobs where kind = 'report'
           and workspace_id = '20000000-0000-4000-8408-00000000000a'), 2,
          '[I01.must.1] two checks, two report jobs, whoever asked');

select * from finish();
rollback;
