-- T-409 · #8 DB-5 decision 2, #188: app.jobs, app.shares and app.supersessions are read only where the member sees the
-- product (family) and the market. Product-less jobs (export, billing) keep their readers. Every producer still works
-- and sets the scope.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(41);
set local client_min_messages = warning;

-- ─── A: Alice (admin), Carl (editor), Vera (viewer), Val (viewer scoped to family A2), Fay (editor scoped to family
-- A2), Sid (editor scoped to EU-DE), Sam (editor scoped to EU-SE), Ned (editor, membership ended). B: Bob (admin). ──
insert into auth.users (id, email) values
  ('00000000-0000-4000-8409-0000000000a1','alice@a.test'), ('00000000-0000-4000-8409-0000000000c1','carl@a.test'),
  ('00000000-0000-4000-8409-0000000000f1','vera@a.test'),  ('00000000-0000-4000-8409-0000000000f2','val@a.test'),
  ('00000000-0000-4000-8409-0000000000e1','fay@a.test'),   ('00000000-0000-4000-8409-0000000000e2','sid@a.test'),
  ('00000000-0000-4000-8409-0000000000e3','sam@a.test'),   ('00000000-0000-4000-8409-0000000000d1','ned@a.test'),
  ('00000000-0000-4000-8409-0000000000b1','bob@b.test');
insert into app.people (id, user_id, display_name, email)
select ('10000000' || substr(u.id::text, 9))::uuid, u.id, split_part(u.email, '@', 1), u.email
from auth.users u where u.id::text like '00000000-0000-4000-8409-%';
insert into app.workspaces (id, name, plan, status) values
  ('20000000-0000-4000-8409-00000000000a','Workspace A','basic','active'),
  ('20000000-0000-4000-8409-00000000000b','Workspace B','basic','active');
insert into app.families (id, workspace_id, name) values
  ('30000000-0000-4000-8409-00000000000a','20000000-0000-4000-8409-00000000000a','Family A'),
  ('30000000-0000-4000-8409-0000000000a2','20000000-0000-4000-8409-00000000000a','Family A2'),
  ('30000000-0000-4000-8409-00000000000b','20000000-0000-4000-8409-00000000000b','Family B');
insert into app.memberships (workspace_id, person_id, role, scope_family_ids, scope_node_ids) values
  ('20000000-0000-4000-8409-00000000000a','10000000-0000-4000-8409-0000000000a1','admin',null,null),
  ('20000000-0000-4000-8409-00000000000a','10000000-0000-4000-8409-0000000000c1','editor',null,null),
  ('20000000-0000-4000-8409-00000000000a','10000000-0000-4000-8409-0000000000f1','viewer',null,null),
  ('20000000-0000-4000-8409-00000000000a','10000000-0000-4000-8409-0000000000f2','viewer','{30000000-0000-4000-8409-0000000000a2}',null),
  ('20000000-0000-4000-8409-00000000000a','10000000-0000-4000-8409-0000000000e1','editor','{30000000-0000-4000-8409-0000000000a2}',null),
  ('20000000-0000-4000-8409-00000000000a','10000000-0000-4000-8409-0000000000e2','editor',null,'{EU-DE}'),
  ('20000000-0000-4000-8409-00000000000a','10000000-0000-4000-8409-0000000000e3','editor',null,'{EU-SE}'),
  ('20000000-0000-4000-8409-00000000000b','10000000-0000-4000-8409-0000000000b1','admin',null,null);
insert into app.memberships (workspace_id, person_id, role, ended_at) values
  ('20000000-0000-4000-8409-00000000000a','10000000-0000-4000-8409-0000000000d1','editor',now() - interval '1 day');
insert into app.products (id, workspace_id, family_id, name) values
  ('40000000-0000-4000-8409-00000000000a','20000000-0000-4000-8409-00000000000a','30000000-0000-4000-8409-00000000000a','Product A'),
  ('40000000-0000-4000-8409-00000000000b','20000000-0000-4000-8409-00000000000b','30000000-0000-4000-8409-00000000000b','Product B');
insert into app.checks (id, workspace_id, product_id, node_id, ruleset_version, artwork_sha, language, label_state,
                        withheld_rule_keys) values
  ('50000000-0000-4000-8409-0000000000a1','20000000-0000-4000-8409-00000000000a','40000000-0000-4000-8409-00000000000a',
   'EU-SE','0000.00-empty',repeat('a', 64),'sv','not_assessed','{TEST.T409.FIXTURE}'),
  ('50000000-0000-4000-8409-0000000000b1','20000000-0000-4000-8409-00000000000b','40000000-0000-4000-8409-00000000000b',
   'EU-SE','0000.00-empty',repeat('b', 64),'sv','not_assessed','{TEST.T409.FIXTURE}');
insert into app.reports (id, workspace_id, product_id, node_id, ref, check_ids, ruleset_version, artwork_sha, has_not_assessed) values
  ('60000000-0000-4000-8409-0000000000a1','20000000-0000-4000-8409-00000000000a','40000000-0000-4000-8409-00000000000a',
   'EU-SE','nv-t409-reference-0000000a1','{50000000-0000-4000-8409-0000000000a1}','0000.00-empty',repeat('a', 64),true),
  ('60000000-0000-4000-8409-0000000000b1','20000000-0000-4000-8409-00000000000b','40000000-0000-4000-8409-00000000000b',
   'EU-SE','nv-t409-reference-0000000b1','{50000000-0000-4000-8409-0000000000b1}','0000.00-empty',repeat('b', 64),false);
-- A synthetic requirement so a document type is "encoded" inside this transaction only (rolled back).
insert into ref.document_requirements (node_id, doc_type) values ('EU-SE', 't409_test_spec');

create temp table t (name text primary key, id uuid, v jsonb);
grant all on t to authenticated, service_role;
create function pg_temp.as_user(p_sub text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8409-0000000000' || p_sub,
                                                            'role', 'authenticated')::text, true)
$$;
create function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true)
$$;
create function pg_temp.id(p_name text) returns uuid language sql as $$ select id from t where name = p_name $$;
-- What the caller reads, under RLS: the named jobs, shares and supersessions of this test.
create function pg_temp.jobs_seen() returns text language sql as $$
  select coalesce(string_agg(t.name, ',' order by t.name), '') from t join app.jobs j on j.id = t.id where t.name like 'job:%'
$$;
create function pg_temp.others_seen() returns text language sql as $$
  select coalesce(string_agg(x, ',' order by x), '') from (
    select 'share' x from app.shares where workspace_id = '20000000-0000-4000-8409-00000000000a'
    union all select 'supersession:' || coalesce(product_id::text, 'legacy') from app.supersessions
    where workspace_id = '20000000-0000-4000-8409-00000000000a') s
$$;
grant execute on all functions in schema pg_temp to authenticated, service_role;

-- ─── Grants and shape ───────────────────────────────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('authenticated', 'private.job_scope(uuid,jsonb)', 'execute')
          and not has_function_privilege('anon', 'private.job_scope(uuid,jsonb)', 'execute')
          and has_function_privilege('authenticated', 'private.nodes_in_scope(uuid,text[])', 'execute')
          and not has_function_privilege('anon', 'private.nodes_in_scope(uuid,text[])', 'execute')
          and not has_function_privilege('anon', 'private.supersession_visible(text,uuid)', 'execute'),
          '[T-409] job_scope resolves ids for the trigger and the service role only; the policy helpers are not anon''s');
select ok(not has_table_privilege('authenticated', 'app.jobs', 'insert')
          and not has_table_privilege('authenticated', 'app.jobs', 'update')
          and not has_table_privilege('authenticated', 'app.shares', 'update')
          and not has_table_privilege('authenticated', 'app.supersessions', 'insert')
          and not has_table_privilege('anon', 'app.jobs', 'select'),
          '[T-409] no client writes jobs, shares or supersessions, and anon reads no job');
select is((select string_agg(tablename || ':' || policyname, ',' order by tablename) from pg_policies
           where schemaname = 'app' and tablename in ('jobs','shares','supersessions')),
          'jobs:read_scoped,shares:read_scoped,supersessions:read_scoped',
          '[T-409] jobs, shares and supersessions each have one read policy, read_scoped');

-- ─── Every producer still works and sets the scope ──────────────────────────────────────────────────────────────
select pg_temp.as_user('c1');
set local role authenticated;
insert into t (name, id) values ('av', app.register_artwork('40000000-0000-4000-8409-00000000000a',
  '20000000-0000-4000-8409-00000000000a/40000000-0000-4000-8409-00000000000a/' || repeat('c', 64) || '.pdf',
  repeat('c', 64), 'label.pdf', 'application/pdf'));
insert into t (name, id) values ('job:check_se', app.request_check('40000000-0000-4000-8409-00000000000a', '{EU-SE}'));
insert into t (name, id) values ('job:report', app.request_report('50000000-0000-4000-8409-0000000000a1', 'req-t409-0001'));
insert into t (name, v) values ('share', app.create_share('60000000-0000-4000-8409-0000000000a1', 'email', 'buyer@shop.test', 30));
insert into t (name, v) values ('docreq', app.request_document('20000000-0000-4000-8409-00000000000a', 'Spec sheet',
  't409_test_spec', null, 'Aldrich Nutrition', 'specs@aldrich.test', '40000000-0000-4000-8409-00000000000a', null));
reset role;
insert into t (name, id) select 'job:extract', j.id from app.jobs j where j.idempotency_key = 'extract:' || pg_temp.id('av');
insert into t (name, id) select 'job:share_notify', j.id from app.jobs j
  where j.idempotency_key = 'share:' || (select v ->> 'share_id' from t where name = 'share');
insert into t (name, id) select 'job:docreq_notify', j.id from app.jobs j
  where j.idempotency_key = 'docreq:' || (select v ->> 'request_id' from t where name = 'docreq');

-- Sid (scoped to EU-DE) checks the product in Sweden and Germany: a job naming a market outside his scope.
select pg_temp.as_user('e2');
set local role authenticated;
insert into t (name, id) values ('job:check_both', app.request_check('40000000-0000-4000-8409-00000000000a', '{EU-DE,EU-SE}'));
reset role;
select pg_temp.as_user('a1');
set local role authenticated;
insert into t (name, id) values ('job:export', app.request_export('20000000-0000-4000-8409-00000000000a', 'req-t409-0002'));
reset role;

-- The supplier uploads through the link (H03): the scan job. The token is what the worker's notify job would mint.
update app.document_requests set token_hash = private.supplier_token_hash('T409supplierLinkToken_aaaaaaaaaaaaaaaaaaaaa')
where id = (select (v ->> 'request_id')::uuid from t where name = 'docreq');
select pg_temp.as_service();
set local role service_role;
insert into t (name, v) values ('upload', app.accept_supplier_upload('T409supplierLinkToken_aaaaaaaaaaaaaaaaaaaaa',
  '20000000-0000-4000-8409-00000000000a/' || (select v ->> 'request_id' from t where name = 'docreq') || '/spec.pdf',
  repeat('ab', 32)));
reset role;
insert into t (name, id) select 'job:scan', j.id from app.jobs j
  where j.kind = 'scan' and j.workspace_id = '20000000-0000-4000-8409-00000000000a';
-- A billing job, through private.enqueue as the Stripe webhook's RPC calls it; and a raw check job naming nothing.
insert into t (name, id) values ('job:billing', private.enqueue('billing_sync', '20000000-0000-4000-8409-00000000000a',
  'billing_sync:evt_t409', '{"stripe_event_id":"evt_t409"}'));
insert into app.jobs (id, kind, workspace_id, idempotency_key, payload) values
  ('70000000-0000-4000-8409-000000000001', 'check', '20000000-0000-4000-8409-00000000000a', 't409-raw-check', '{}');
insert into t (name, id) values ('job:raw_check', '70000000-0000-4000-8409-000000000001');
-- The worker finishes the report job: its progress names the reference.
update app.jobs set status = 'succeeded', progress = '{"ref":"nv-t409-reference-0000000a1"}' where id = pg_temp.id('job:report');
-- Supersessions of the report: one written now, and one written before T-409 (no product: the trigger is off).
insert into app.supersessions (workspace_id, artefact_type, artefact_id, rule_key, ruleset_version) values
  ('20000000-0000-4000-8409-00000000000a', 'report', '60000000-0000-4000-8409-0000000000a1', 'TEST.T409.RULE', '0000.00-empty');
alter table app.supersessions disable trigger supersessions_scope;
insert into app.supersessions (workspace_id, artefact_type, artefact_id, rule_key, ruleset_version) values
  ('20000000-0000-4000-8409-00000000000a', 'report', '60000000-0000-4000-8409-0000000000a1', 'TEST.T409.LEGACY', '0000.00-empty');
alter table app.supersessions enable trigger supersessions_scope;

select is((select count(*)::int from t where name like 'job:%' and id is not null), 10,
          '[T-409] every producer still queues its job: artwork, check (twice), report, share email, supplier request, '
          'supplier upload, export and billing');
select is((select product_id::text || ' ' || coalesce(node_ids::text, '-') from app.jobs where id = pg_temp.id('job:extract')),
          '40000000-0000-4000-8409-00000000000a -', '[T-409] register_artwork: the extract job carries its product');
select is((select product_id::text || ' ' || node_ids::text from app.jobs where id = pg_temp.id('job:check_se')),
          '40000000-0000-4000-8409-00000000000a {EU-SE}', '[T-409] request_check: the check job carries its product and market');
select is((select node_ids from app.jobs where id = pg_temp.id('job:check_both')), '{EU-DE,EU-SE}'::text[],
          '[T-409] request_check: a job of several markets carries all of them');
select is((select product_id::text || ' ' || node_ids::text from app.jobs where id = pg_temp.id('job:report')),
          '40000000-0000-4000-8409-00000000000a {EU-SE}', '[T-409] request_report: the report job carries the check''s product and market');
select is((select product_id::text || ' ' || node_ids::text from app.jobs where id = pg_temp.id('job:share_notify')),
          '40000000-0000-4000-8409-00000000000a {EU-SE}', '[T-409] create_share by email: the notify job carries the report''s product and market');
select is((select node_id from app.shares where id = (select (v ->> 'share_id')::uuid from t where name = 'share')), 'EU-SE',
          '[T-409] create_share: the share carries its report''s market');
select is((select product_id from app.jobs where id = pg_temp.id('job:docreq_notify')), '40000000-0000-4000-8409-00000000000a'::uuid,
          '[T-409] request_document: the supplier notify job carries its product');
select is((select product_id from app.jobs where id = pg_temp.id('job:scan')), '40000000-0000-4000-8409-00000000000a'::uuid,
          '[T-409] accept_supplier_upload: the scan job carries the document''s product');
select ok((select bool_and(product_id is null and node_ids is null) from app.jobs
           where id in (pg_temp.id('job:export'), pg_temp.id('job:billing'), pg_temp.id('job:raw_check'))),
          '[T-409] export and billing jobs, and a job whose payload names nothing, carry no product');
select is((select string_agg(rule_key || ' ' || coalesce(product_id::text, '-') || ' ' || coalesce(node_id, '-'), ',' order by rule_key)
           from app.supersessions where workspace_id = '20000000-0000-4000-8409-00000000000a'),
          'TEST.T409.LEGACY - -,TEST.T409.RULE 40000000-0000-4000-8409-00000000000a EU-SE',
          '[T-409] a supersession carries its report''s product and market (a row from before T-409 has none)');

-- ─── Backfill: the derivation the migration ran over existing rows ─────────────────────────────────────────────
select pg_temp.as_service();
set local role service_role;
select is((select s.product_id::text || ' ' || s.node_ids::text
           from private.job_scope('20000000-0000-4000-8409-00000000000a', '{"check_id":"50000000-0000-4000-8409-0000000000a1"}') s),
          '40000000-0000-4000-8409-00000000000a {EU-SE}', '[T-409] backfill: a report job''s scope is its check''s product and market');
select is((select s.product_id from private.job_scope('20000000-0000-4000-8409-00000000000a',
             jsonb_build_object('artwork_version_id', pg_temp.id('av'))) s),
          '40000000-0000-4000-8409-00000000000a'::uuid, '[T-409] backfill: an extract job''s scope is its artwork''s product');
select ok((select s.product_id is null and s.node_ids is null
           from private.job_scope('20000000-0000-4000-8409-00000000000a', '{"template":"invite","invitation_id":"x"}') s),
          '[T-409] backfill: an invite or billing payload stays product-less');
reset role;

-- ─── Refusals ──────────────────────────────────────────────────────────────────────────────────────────────────────
insert into t (name, id) values ('job:cross', private.enqueue('report', '20000000-0000-4000-8409-00000000000a', 't409-cross',
                                          '{"check_id":"50000000-0000-4000-8409-0000000000b1"}'));
select ok((select product_id is null and node_ids is null from app.jobs where id = pg_temp.id('job:cross')),
          '[T-409] a job naming another workspace''s check gets no scope (the worker refuses it), never that check''s');
select throws_ok($$insert into app.jobs (kind, workspace_id, idempotency_key, product_id)
                   values ('check', '20000000-0000-4000-8409-00000000000a', 't409-cross-2', '40000000-0000-4000-8409-00000000000b')$$,
                 '23514', null, '[T-409] a job carrying another workspace''s product is refused');
select throws_ok($$insert into app.supersessions (workspace_id, artefact_type, artefact_id, rule_key, ruleset_version)
                   values ('20000000-0000-4000-8409-00000000000a', 'report', '60000000-0000-4000-8409-0000000000b1',
                           'TEST.T409.RULE', '0000.00-empty')$$,
                 '23514', null, '[T-409] a supersession of another workspace''s report is refused');
select throws_ok($$insert into app.supersessions (workspace_id, artefact_type, artefact_id, rule_key, ruleset_version)
                   values ('20000000-0000-4000-8409-00000000000a', 'certificate', '60000000-0000-4000-8409-0000000000a1',
                           'TEST.T409.RULE', '0000.00-empty')$$,
                 '23514', null, '[T-409] a supersession of an artefact that does not exist is refused');
select throws_ok($$insert into app.supersessions (workspace_id, artefact_type, artefact_id, rule_key, ruleset_version, node_id)
                   values ('20000000-0000-4000-8409-00000000000a', 'report', '60000000-0000-4000-8409-0000000000a1',
                           'TEST.T409.RULE', '0000.00-empty', 'EU-DE')$$,
                 '23514', null, '[T-409] a supersession naming a market other than its report''s is refused');
select throws_ok($$update app.shares set node_id = 'EU-DE'
                   where id = (select (v ->> 'share_id')::uuid from t where name = 'share')$$,
                 '23514', null, '[T-409] a share''s market cannot move away from its report''s');

-- ─── Who reads what ─────────────────────────────────────────────────────────────────────────────────────────────
-- Unscoped members read every job of the workspace except a product job that names no product (fail closed).
select pg_temp.as_user('a1');
set local role authenticated;
select is(pg_temp.jobs_seen(), 'job:billing,job:check_both,job:check_se,job:docreq_notify,job:export,job:extract,job:report,job:scan,job:share_notify',
          '[T-409] an unscoped admin reads every job; a check job naming no product is read by no member');
select is(pg_temp.others_seen(), 'share,supersession:40000000-0000-4000-8409-00000000000a,supersession:legacy',
          '[T-409] an unscoped admin reads the share and both supersessions');
reset role;
select pg_temp.as_user('f1');
set local role authenticated;
select is(pg_temp.jobs_seen(), 'job:billing,job:check_both,job:check_se,job:docreq_notify,job:export,job:extract,job:report,job:scan,job:share_notify',
          '[T-409] an unscoped viewer still reads the workspace''s jobs');
select is((select progress ->> 'ref' from app.jobs where id = pg_temp.id('job:report')), 'nv-t409-reference-0000000a1',
          '[T-409] an unscoped viewer reads the report job''s reference');
reset role;

-- A viewer scoped to another family: product jobs, the share and the supersessions are gone; export and billing stay.
select pg_temp.as_user('f2');
set local role authenticated;
select is(pg_temp.jobs_seen(), 'job:billing,job:export',
          '[T-409] a viewer scoped to another family no longer reads the family''s report, check, artwork, share or supplier jobs');
select is((select count(*)::int from app.jobs where progress ? 'ref'), 0,
          '[T-409] a viewer scoped to another family no longer reads the report job''s reference (progress.ref)');
select is(pg_temp.others_seen(), '', '[T-409] a viewer scoped to another family reads no share or supersession of it');
reset role;

-- An editor scoped to another family.
select pg_temp.as_user('e1');
set local role authenticated;
select is(pg_temp.jobs_seen(), 'job:billing,job:export',
          '[T-409] a family-scoped member no longer reads another family''s report job or check job');
select is(pg_temp.others_seen(), '', '[T-409] a family-scoped member reads no share or supersession of another family');
reset role;

-- An editor scoped to EU-DE: the product's Swedish report, check, share and supersessions are gone; the artwork and
-- supplier jobs (no market) stay, and so does the two-market check he requested himself.
select pg_temp.as_user('e2');
set local role authenticated;
select is(pg_temp.jobs_seen(), 'job:billing,job:check_both,job:docreq_notify,job:export,job:extract,job:scan',
          '[T-409] a market-scoped member no longer reads another market''s report job or check job');
select is((select count(*)::int from app.jobs where progress ? 'ref'), 0,
          '[T-409] a market-scoped member no longer reads another market''s report reference (progress.ref)');
select is(pg_temp.others_seen(), '', '[T-409] a market-scoped member reads no share or supersession of another market');
reset role;

-- An editor scoped to EU-SE: the Swedish jobs, share and supersessions, but not the check that also names Germany.
select pg_temp.as_user('e3');
set local role authenticated;
select is(pg_temp.jobs_seen(), 'job:billing,job:check_se,job:docreq_notify,job:export,job:extract,job:report,job:scan,job:share_notify',
          '[T-409] a member scoped to the market reads its jobs, and not a job naming a market outside the scope (#198 Q1)');
select is(pg_temp.others_seen(), 'share,supersession:40000000-0000-4000-8409-00000000000a,supersession:legacy',
          '[T-409] a member scoped to the market reads its share and supersessions, a row from before T-409 included');
reset role;

-- Ended membership and another workspace: nothing, not even product-less jobs or one they requested.
select pg_temp.as_user('d1');
set local role authenticated;
select is(pg_temp.jobs_seen() || '|' || pg_temp.others_seen(), '|', '[T-409] an ended membership reads nothing');
reset role;
select pg_temp.as_user('b1');
set local role authenticated;
select is(pg_temp.jobs_seen() || '|' || pg_temp.others_seen(), '|',
          '[T-409] another workspace''s admin reads no job, share or supersession of workspace A');
reset role;
update app.memberships set ended_at = now() where person_id = '10000000-0000-4000-8409-0000000000e2';
select pg_temp.as_user('e2');
set local role authenticated;
select is(pg_temp.jobs_seen(), '', '[T-409] a requester whose membership has ended no longer reads their own job');
reset role;

-- Realtime authorizes each change with this policy: the publication still carries app.jobs.
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                  and schemaname = 'app' and tablename = 'jobs'), '[T-409] app.jobs stays in the realtime publication');

select * from finish();
rollback;
