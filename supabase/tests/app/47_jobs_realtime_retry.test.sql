-- T-305 · the extraction follow-ups from #41 (D01): app.jobs in the supabase_realtime publication under RLS, the request's
-- x-request-id copied into job payloads by private.enqueue, and app.retry_extraction for a failed extraction.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(36);
set local client_min_messages = warning;

-- ─── A: Alice (editor), Vera (viewer). B: Bob (admin). ─────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-4000-8305-0000000000a1','alice@a.test'), ('00000000-0000-4000-8305-0000000000f1','vera@a.test'),
  ('00000000-0000-4000-8305-0000000000b1','bob@b.test');
insert into app.people (id, user_id, display_name, email)
select ('10000000' || substr(u.id::text, 9))::uuid, u.id, split_part(u.email, '@', 1), u.email
from auth.users u where u.id::text like '00000000-0000-4000-8305-%';
insert into app.workspaces (id, name, plan, status) values
  ('20000000-0000-4000-8305-00000000000a','Workspace A','basic','active'),
  ('20000000-0000-4000-8305-00000000000b','Workspace B','basic','active');
insert into app.families (id, workspace_id, name) values
  ('30000000-0000-4000-8305-00000000000a','20000000-0000-4000-8305-00000000000a','Family A');
insert into app.memberships (workspace_id, person_id, role) values
  ('20000000-0000-4000-8305-00000000000a','10000000-0000-4000-8305-0000000000a1','editor'),
  ('20000000-0000-4000-8305-00000000000a','10000000-0000-4000-8305-0000000000f1','viewer'),
  ('20000000-0000-4000-8305-00000000000b','10000000-0000-4000-8305-0000000000b1','admin');
insert into app.products (id, workspace_id, family_id, name) values
  ('40000000-0000-4000-8305-00000000000a','20000000-0000-4000-8305-00000000000a','30000000-0000-4000-8305-00000000000a','Product A');
-- An artwork registered before T-305 whose job never existed (P0002 below).
insert into app.artwork_versions (id, workspace_id, product_id, version, file_sha256, storage_path, is_new_artwork) values
  ('50000000-0000-4000-8305-0000000000ee','20000000-0000-4000-8305-00000000000a','40000000-0000-4000-8305-00000000000a',
   9, repeat('e', 64), '20000000-0000-4000-8305-00000000000a/40000000-0000-4000-8305-00000000000a/' || repeat('e', 64) || '.pdf', false);

create temp table t_ids (name text primary key, id uuid);
grant all on t_ids to authenticated;
create function pg_temp.as_user(p_sub text, p_request_id text default null) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true),
         set_config('request.headers',
                    case when p_request_id is null then '{}' else json_build_object('x-request-id', p_request_id)::text end,
                    true)
$$;
create function pg_temp.register(p_sha text) returns uuid language sql as $$
  select app.register_artwork('40000000-0000-4000-8305-00000000000a',
    '20000000-0000-4000-8305-00000000000a/40000000-0000-4000-8305-00000000000a/' || p_sha || '.pdf', p_sha, 'label.pdf',
    'application/pdf')
$$;
create function pg_temp.job_of(p_av uuid) returns app.jobs language sql as $$
  select j from app.jobs j where j.idempotency_key = 'extract:' || p_av::text
$$;

-- ─── Realtime: app.jobs is published, and RLS decides who receives a change ────────────────────────────────────
select ok(exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'app' and tablename = 'jobs'),
          '[T-305][D01.main] app.jobs is in the supabase_realtime publication');
select ok((select relrowsecurity from pg_class where oid = 'app.jobs'::regclass),
          '[T-305] RLS stays enabled on app.jobs, so Realtime authorizes every change with read_member');

-- Alice uploads with a request id: the job is the one Realtime delivers below.
select pg_temp.as_user('00000000-0000-4000-8305-0000000000a1', 'req-t305-upload-0001');
set local role authenticated;
insert into t_ids values ('av1', pg_temp.register(repeat('a', 64)));
reset role;
insert into t_ids select 'job1', (pg_temp.job_of(id)).id from t_ids where name = 'av1';

-- Three subscriptions to that job's id, as the web makes them: Alice (its workspace), Bob (workspace B), anon.
insert into realtime.subscription (subscription_id, entity, filters, claims)
select s.sid, 'app.jobs'::regclass,
       array[('id', 'eq', (select id from t_ids where name = 'job1')::text, null)::realtime.user_defined_filter],
       s.claims
from (values
  ('70000000-0000-4000-8305-0000000000a1'::uuid, jsonb_build_object('sub','00000000-0000-4000-8305-0000000000a1','role','authenticated')),
  ('70000000-0000-4000-8305-0000000000b1'::uuid, jsonb_build_object('sub','00000000-0000-4000-8305-0000000000b1','role','authenticated'))) s(sid, claims);
-- anon holds no column privilege on app.jobs, so Realtime refuses its filter on id at subscribe time; unfiltered, it
-- is still checked against every change.
select throws_ok($$insert into realtime.subscription (subscription_id, entity, filters, claims)
                   values ('70000000-0000-4000-8305-0000000000fe', 'app.jobs',
                           array[('id', 'eq', gen_random_uuid()::text, null)::realtime.user_defined_filter],
                           '{"role":"anon"}')$$, 'P0001', 'invalid column for filter id',
                 '[T-305] an anonymous client cannot subscribe to a job by id');
insert into realtime.subscription (subscription_id, entity, filters, claims)
values ('70000000-0000-4000-8305-0000000000ff', 'app.jobs', '{}', '{"role":"anon"}');

-- The change Realtime reads from the WAL when the worker marks the job succeeded, fed through its own RLS check.
create temp table t_rt as
select r.subscription_ids, r.errors, r.wal ? 'record' as has_record
from realtime.apply_rls(jsonb_build_object(
  'action', 'U', 'schema', 'app', 'table', 'jobs',
  'pk', jsonb_build_array(jsonb_build_object('name', 'id', 'type', 'uuid', 'typeoid', 2950)),
  'columns', jsonb_build_array(
    jsonb_build_object('name', 'id', 'type', 'uuid', 'typeoid', 2950, 'value', (select id from t_ids where name = 'job1')),
    jsonb_build_object('name', 'workspace_id', 'type', 'uuid', 'typeoid', 2950, 'value', '20000000-0000-4000-8305-00000000000a'),
    jsonb_build_object('name', 'status', 'type', 'text', 'typeoid', 25, 'value', 'succeeded')),
  'identity', jsonb_build_array(
    jsonb_build_object('name', 'id', 'type', 'uuid', 'typeoid', 2950, 'value', (select id from t_ids where name = 'job1')))
), 1048576) r;

select ok(exists (select 1 from t_rt where '70000000-0000-4000-8305-0000000000a1' = any(subscription_ids)
                  and has_record and errors = '{}'),
          '[T-305][D01.main] a member of the job''s workspace receives its change over Realtime');
select ok(not exists (select 1 from t_rt where '70000000-0000-4000-8305-0000000000b1' = any(subscription_ids)),
          '[T-305] a member of another workspace receives no change to the job over Realtime');
select ok(not exists (select 1 from t_rt where '70000000-0000-4000-8305-0000000000ff' = any(subscription_ids) and has_record),
          '[T-305] an anonymous subscriber receives no job record over Realtime, only an authorization error');
select pg_temp.as_user('00000000-0000-4000-8305-0000000000b1');
set local role authenticated;
select is((select count(*)::int from app.jobs where workspace_id = '20000000-0000-4000-8305-00000000000a'), 0,
          '[T-305] the same RLS hides workspace A''s jobs from workspace B on a plain read');
reset role;

-- ─── request_id: private.enqueue copies the request's x-request-id ────────────────────────────────────────────
select ok(not has_function_privilege('authenticated', 'private.request_id()', 'execute')
          and not has_function_privilege('anon', 'private.request_id()', 'execute')
          and not has_function_privilege('authenticated', 'private.enqueue(text,uuid,text,jsonb)', 'execute')
          and not has_function_privilege('anon', 'private.enqueue(text,uuid,text,jsonb)', 'execute'),
          '[T-305] private.request_id and private.enqueue stay closed to authenticated and anon (#179)');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p
           where p.oid = 'private.enqueue(text,uuid,text,jsonb)'::regprocedure),
          '[T-305] private.enqueue is still security definer with an empty search_path');
select is((select payload from app.jobs where id = (select id from t_ids where name = 'job1')),
          jsonb_build_object('artwork_version_id', (select id from t_ids where name = 'av1'), 'request_id', 'req-t305-upload-0001'),
          '[T-305][D01.main] the extract job''s payload carries the artwork version and the request''s request_id, ids only');

select pg_temp.as_user('00000000-0000-4000-8305-0000000000a1', 'bad id with spaces; drop table');
set local role authenticated;
insert into t_ids values ('av2', pg_temp.register(repeat('b', 64)));
reset role;
select is((select (pg_temp.job_of(id)).payload from t_ids where name = 'av2'),
          jsonb_build_object('artwork_version_id', (select id from t_ids where name = 'av2')),
          '[T-305] a request id that is not a plain token never reaches the payload');

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8305-0000000000a1',
                                                          'role', 'authenticated')::text, true);
select set_config('request.headers', '', true);
set local role authenticated;
insert into t_ids values ('av3', pg_temp.register(repeat('c', 64)));
reset role;
select is((select (pg_temp.job_of(id)).payload from t_ids where name = 'av3'),
          jsonb_build_object('artwork_version_id', (select id from t_ids where name = 'av3')),
          '[T-305] without a request header the payload holds the ids only');

select set_config('request.headers', 'not json', true);
select is(private.request_id(), null, '[T-305] unreadable request headers give no request id, never an error');
select set_config('request.headers', '{"x-request-id":"req-t305-header-0001"}', true);
select is(private.request_id(), 'req-t305-header-0001', '[T-305] private.request_id reads x-request-id from the request');
insert into t_ids values ('explicit', private.enqueue('export', '20000000-0000-4000-8305-00000000000a', 'export:t305:explicit',
                                                      '{"request_id":"req-t305-explicit-01"}'));
select is((select payload from app.jobs where id = (select id from t_ids where name = 'explicit')),
          '{"request_id":"req-t305-explicit-01"}'::jsonb,
          '[T-305] a payload that names its own request_id keeps it over the header');
select set_config('request.headers', '{}', true);

-- ─── app.retry_extraction ───────────────────────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('anon', 'app.retry_extraction(uuid)', 'execute')
          and not has_function_privilege('public', 'app.retry_extraction(uuid)', 'execute')
          and has_function_privilege('authenticated', 'app.retry_extraction(uuid)', 'execute'),
          '[T-305] app.retry_extraction is executable by authenticated users and never by anon or public');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p
           where p.oid = 'app.retry_extraction(uuid)'::regprocedure),
          '[T-305] app.retry_extraction is security definer with an empty search_path');

-- A queued job is returned unchanged.
create temp table t_counts as
select (select count(*) from pgmq.q_extract) as msgs,
       (select count(*) from app.allowance_consumptions where workspace_id = '20000000-0000-4000-8305-00000000000a') as used;
grant all on t_counts to authenticated;
select pg_temp.as_user('00000000-0000-4000-8305-0000000000a1', 'req-t305-retry-0001');
set local role authenticated;
select is(app.retry_extraction((select id from t_ids where name = 'av1')), (select id from t_ids where name = 'job1'),
          '[T-305][D01.must.4] retrying a queued extraction returns its job');
reset role;
select ok((select status = 'queued' and attempts = 0 from app.jobs where id = (select id from t_ids where name = 'job1'))
          and (select count(*) from pgmq.q_extract) = (select msgs from t_counts)
          and not exists (select 1 from app.audit_events where kind = 'extraction.retried'
                          and workspace_id = '20000000-0000-4000-8305-00000000000a'),
          '[T-305][D01.must.4] a job that has not failed is not queued again and nothing is audited');

-- The worker gives up: the job is failed after its attempts.
update app.jobs set status = 'failed', attempts = 5, last_error = 'artwork_version 0000 missing from storage',
                    progress = '{"stage":"reading"}' where id = (select id from t_ids where name = 'job1');
update app.workspaces set status = 'new_artwork_stopped' where id = '20000000-0000-4000-8305-00000000000a';

select pg_temp.as_user('00000000-0000-4000-8305-0000000000f1', 'req-t305-retry-0002');
set local role authenticated;
select throws_ok($$select app.retry_extraction((select id from t_ids where name = 'av1'))$$, '42501', null,
                 '[T-305] a viewer cannot retry an extraction');
select pg_temp.as_user('00000000-0000-4000-8305-0000000000b1', 'req-t305-retry-0003');
select throws_ok($$select app.retry_extraction((select id from t_ids where name = 'av1'))$$, '42501', null,
                 '[T-305] a member of another workspace cannot retry its extraction');
select throws_ok($$select app.retry_extraction('50000000-0000-4000-8305-000000000000')$$, '42501', null,
                 '[T-305] an unknown artwork is refused like another workspace''s, so its existence never leaks');
reset role;
select ok((select status = 'failed' from app.jobs where id = (select id from t_ids where name = 'job1')),
          '[T-305] a refused retry leaves the failed job as it was');

select pg_temp.as_user('00000000-0000-4000-8305-0000000000a1', 'req-t305-retry-0004');
set local role authenticated;
select throws_ok($$select app.retry_extraction('50000000-0000-4000-8305-0000000000ee')$$, 'P0002', null,
                 '[T-305] an artwork with no extract job has nothing to retry (P0002)');
select is(app.retry_extraction((select id from t_ids where name = 'av1')), (select id from t_ids where name = 'job1'),
          '[T-305][D01.main] an editor retries a failed extraction and gets the same job back');
reset role;
select ok((select status = 'queued' and attempts = 0 and last_error is null and progress = '{}'::jsonb
           from app.jobs where id = (select id from t_ids where name = 'job1')),
          '[T-305][D01.main] the failed job is queued again with its attempts, error and progress cleared');
select is((select payload from app.jobs where id = (select id from t_ids where name = 'job1')),
          jsonb_build_object('artwork_version_id', (select id from t_ids where name = 'av1'), 'request_id', 'req-t305-retry-0004'),
          '[T-305] the retried job carries the retry''s request_id and still only ids');
select is((select count(*) from pgmq.q_extract), (select msgs + 1 from t_counts),
          '[T-305][D01.main] the retry sends the worker one fresh message');
select is((select count(*)::int from app.audit_events where kind = 'extraction.retried'
           and object_id = (select id::text from t_ids where name = 'job1')
           and actor_id = '10000000-0000-4000-8305-0000000000a1'
           and before ->> 'last_error' = 'artwork_version 0000 missing from storage'
           and after ->> 'artwork_version_id' = (select id::text from t_ids where name = 'av1')), 1,
          '[T-305] the retry is audited once, with the person and the error the job had');
select is((select count(*) from app.allowance_consumptions where workspace_id = '20000000-0000-4000-8305-00000000000a'),
          (select used from t_counts),
          '[T-305][BE-32] a retry never consumes the free allowance');
select ok((select status = 'new_artwork_stopped' from app.workspaces where id = '20000000-0000-4000-8305-00000000000a')
          and (select status = 'queued' from app.jobs where id = (select id from t_ids where name = 'job1')),
          '[T-305][BE-36] a workspace with new artworks paused by dunning can still retry an existing artwork');

-- A second click while the retry is queued queues nothing more.
select pg_temp.as_user('00000000-0000-4000-8305-0000000000a1', 'req-t305-retry-0005');
set local role authenticated;
select is(app.retry_extraction((select id from t_ids where name = 'av1')), (select id from t_ids where name = 'job1'),
          '[T-305][D01.must.4] a second retry returns the same job');
reset role;
select ok((select count(*) from pgmq.q_extract) = (select msgs + 1 from t_counts)
          and (select count(*) from app.audit_events where kind = 'extraction.retried'
               and workspace_id = '20000000-0000-4000-8305-00000000000a') = 1
          and (select payload ->> 'request_id' from app.jobs where id = (select id from t_ids where name = 'job1'))
              = 'req-t305-retry-0004',
          '[T-305][D01.must.4] a second retry sends no message, writes no audit and keeps the first retry''s request_id');

-- A succeeded job is never run again by a retry.
update app.jobs set status = 'succeeded' where id = (select id from t_ids where name = 'job1');
select pg_temp.as_user('00000000-0000-4000-8305-0000000000a1');
set local role authenticated;
select is(app.retry_extraction((select id from t_ids where name = 'av1')), (select id from t_ids where name = 'job1'),
          '[T-305] retrying a finished extraction returns its job');
reset role;
select ok((select status = 'succeeded' from app.jobs where id = (select id from t_ids where name = 'job1'))
          and (select count(*) from pgmq.q_extract) = (select msgs + 1 from t_counts),
          '[T-305] a succeeded extraction is never queued again');

-- The retry RPC writes jobs only through its definer: authenticated still has no write on app.jobs.
select ok(not has_table_privilege('authenticated', 'app.jobs', 'update')
          and not has_table_privilege('authenticated', 'app.jobs', 'insert'),
          '[T-305] authenticated has no client write on app.jobs');

select * from finish();
rollback;
