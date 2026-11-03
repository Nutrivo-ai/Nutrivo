-- T-601 · I02 (BE-27): app.create_share, app.revoke_share, app.open_share and the read policy on app.shares.
-- A share is unguessable (only its SHA-256 is stored), revocable, optionally expiring and access-logged; revoking or
-- expiring it stops the share page and never the verification of the document.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(50);
set local client_min_messages = warning;

-- ─── A: Alice (admin), Carl (editor), Vera (viewer), Sid (editor scoped to family A2), Pia (portfolio manager).
-- B: Bob (admin). ─────────────────────────────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-4000-8601-0000000000a1','alice@a.test'), ('00000000-0000-4000-8601-0000000000c1','carl@a.test'),
  ('00000000-0000-4000-8601-0000000000f1','vera@a.test'),  ('00000000-0000-4000-8601-0000000000e1','sid@a.test'),
  ('00000000-0000-4000-8601-0000000000d1','pia@a.test'),   ('00000000-0000-4000-8601-0000000000b1','bob@b.test');
insert into app.people (id, user_id, display_name, email)
select ('10000000' || substr(u.id::text, 9))::uuid, u.id, split_part(u.email, '@', 1), u.email
from auth.users u where u.id::text like '00000000-0000-4000-8601-%';
insert into app.workspaces (id, name) values
  ('20000000-0000-4000-8601-00000000000a','Workspace A'), ('20000000-0000-4000-8601-00000000000b','Workspace B');
insert into app.families (id, workspace_id, name) values
  ('30000000-0000-4000-8601-00000000000a','20000000-0000-4000-8601-00000000000a','Family A'),
  ('30000000-0000-4000-8601-0000000000a2','20000000-0000-4000-8601-00000000000a','Family A2'),
  ('30000000-0000-4000-8601-00000000000b','20000000-0000-4000-8601-00000000000b','Family B');
insert into app.memberships (workspace_id, person_id, role, scope_family_ids) values
  ('20000000-0000-4000-8601-00000000000a','10000000-0000-4000-8601-0000000000a1','admin',null),
  ('20000000-0000-4000-8601-00000000000a','10000000-0000-4000-8601-0000000000c1','editor',null),
  ('20000000-0000-4000-8601-00000000000a','10000000-0000-4000-8601-0000000000f1','viewer',null),
  ('20000000-0000-4000-8601-00000000000a','10000000-0000-4000-8601-0000000000e1','editor','{30000000-0000-4000-8601-0000000000a2}'),
  ('20000000-0000-4000-8601-00000000000a','10000000-0000-4000-8601-0000000000d1','portfolio_manager',null),
  ('20000000-0000-4000-8601-00000000000b','10000000-0000-4000-8601-0000000000b1','admin',null);
insert into app.products (id, workspace_id, family_id, name) values
  ('40000000-0000-4000-8601-00000000000a','20000000-0000-4000-8601-00000000000a','30000000-0000-4000-8601-00000000000a','Salmon & Rice Adult'),
  ('40000000-0000-4000-8601-00000000000b','20000000-0000-4000-8601-00000000000b','30000000-0000-4000-8601-00000000000b','Product B');
insert into app.reports (id, workspace_id, product_id, node_id, ref, check_ids, ruleset_version, artwork_sha, has_not_assessed, pdf_path) values
  ('50000000-0000-4000-8601-00000000000a','20000000-0000-4000-8601-00000000000a','40000000-0000-4000-8601-00000000000a','EU-SE',
   'nv-t601-reference-000000000a','{}','0000.00-empty','sha-t601-a',true,
   '20000000-0000-4000-8601-00000000000a/40000000-0000-4000-8601-00000000000a/nv-t601-reference-000000000a.pdf'),
  ('50000000-0000-4000-8601-00000000000b','20000000-0000-4000-8601-00000000000b','40000000-0000-4000-8601-00000000000b','EU-SE',
   'nv-t601-reference-000000000b','{}','0000.00-empty','sha-t601-b',false,null);

create temp table t (name text primary key, v jsonb);
grant all on t to authenticated, service_role;
create function pg_temp.as_user(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true)
$$;
create function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true)
$$;
create function pg_temp.v(p_name text) returns jsonb language sql as $$ select v from t where name = p_name $$;
grant execute on all functions in schema pg_temp to service_role, authenticated;

-- ─── Grants ───────────────────────────────────────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('anon', 'app.create_share(uuid,text,text,integer,text)', 'execute')
          and has_function_privilege('authenticated', 'app.create_share(uuid,text,text,integer,text)', 'execute')
          and not has_function_privilege('anon', 'app.revoke_share(uuid)', 'execute')
          and has_function_privilege('authenticated', 'app.revoke_share(uuid)', 'execute'),
          '[T-601] create_share and revoke_share are executable by authenticated users and never by anon');
select ok(not has_function_privilege('anon', 'app.open_share(text,text)', 'execute')
          and not has_function_privilege('authenticated', 'app.open_share(text,text)', 'execute')
          and has_function_privilege('service_role', 'app.open_share(text,text)', 'execute'),
          '[T-601] open_share is executable by the service role only');
select ok(not has_table_privilege('anon', 'app.shares', 'select')
          and not has_table_privilege('authenticated', 'app.shares', 'insert')
          and not has_table_privilege('authenticated', 'app.shares', 'update')
          and not has_table_privilege('authenticated', 'app.share_access_log', 'insert'),
          '[T-601] no client writes shares or the access log, and anon reads neither');
select is((select count(*)::int from information_schema.routines
           where routine_schema = 'public' and routine_name not like 'pgtap%'
             and routine_name in ('open_share','create_share','revoke_share')), 0,
          '[T-601] nothing is added to the public schema');

-- ─── I02.main: share by link, open it, the access is logged ───────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-4000-8601-0000000000c1');
set local role authenticated;
insert into t values ('link', app.create_share('50000000-0000-4000-8601-00000000000a', 'link', null, 30, 'req-i02-main-0001'));
reset role;
select ok(pg_temp.v('link') ->> 'token' ~ '^[A-Za-z0-9_-]{43}$',
          '[I02.main] an editor shares a report by link and gets a 43-character URL-safe token once');
select ok((select token_hash = extensions.digest(pg_temp.v('link') ->> 'token', 'sha256')
                  and channel = 'link' and recipient is null and revoked_at is null
                  and product_id = '40000000-0000-4000-8601-00000000000a'
                  and created_by = '10000000-0000-4000-8601-0000000000c1'
                  and expires_at between now() + interval '29 days 23 hours' and now() + interval '30 days 1 hour'
           from app.shares where id = (pg_temp.v('link') ->> 'share_id')::uuid),
          '[I02.main] only the SHA-256 of the token is stored, with the default 30-day expiry');
select is((select count(*)::int from app.shares s
           where position(convert_to(pg_temp.v('link') ->> 'token', 'UTF8') in s.token_hash) > 0), 0,
          '[I02.main] the raw token is never stored');
select is((select count(*)::int from app.jobs where workspace_id = '20000000-0000-4000-8601-00000000000a'), 0,
          '[I02.main] a link share queues no job (the token never enters a job)');
select ok((select actor_id = '10000000-0000-4000-8601-0000000000c1' and object_type = 'share'
                  and after ->> 'channel' = 'link' and after ->> 'ref' = 'nv-t601-reference-000000000a'
                  and not (after ? 'token') and ruleset_version = '0000.00-empty'
           from app.audit_events where kind = 'share.created' and object_id = pg_temp.v('link') ->> 'share_id'),
          '[I02.main] the share is audited with its channel and reference, never its token');

select pg_temp.as_service();
set local role service_role;
insert into t values ('open1', app.open_share(pg_temp.v('link') ->> 'token', 'Mozilla/5.0 (I02 test)'));
reset role;
select ok(pg_temp.v('open1') ->> 'status' = 'open'
          and pg_temp.v('open1') ->> 'ref' = 'nv-t601-reference-000000000a'
          and pg_temp.v('open1') ->> 'product_name' = 'Salmon & Rice Adult'
          and pg_temp.v('open1') ->> 'workspace_name' = 'Workspace A'
          and pg_temp.v('open1') ->> 'ruleset_version' = '0000.00-empty'
          and pg_temp.v('open1') ->> 'artwork_sha' = 'sha-t601-a'
          and (pg_temp.v('open1') ->> 'has_not_assessed')::boolean
          and pg_temp.v('open1') ->> 'pdf_path' like '20000000-0000-4000-8601-00000000000a/%',
          '[I02.main] the share page opens the report''s face facts and its stored PDF');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.v('open1')) k),
          array['artwork_sha','expires_at','has_not_assessed','issued_at','node_id','pdf_path','product_name','ref',
                'ruleset_version','share_id','status','workspace_name'],
          '[I02.main] and nothing else from the workspace');
select ok((select workspace_id = '20000000-0000-4000-8601-00000000000a' and user_agent = 'Mozilla/5.0 (I02 test)'
                  and ip_hash is null
           from app.share_access_log where share_id = (pg_temp.v('link') ->> 'share_id')::uuid),
          '[I02.main] the access is logged with time and user agent, no IP');
set local role service_role;
select app.open_share(pg_temp.v('link') ->> 'token', repeat('x', 400));
reset role;
select is((select count(*)::int from app.share_access_log where share_id = (pg_temp.v('link') ->> 'share_id')::uuid), 2,
          '[I02.main] every opening is a new access row');
select is((select max(length(user_agent)) from app.share_access_log where share_id = (pg_temp.v('link') ->> 'share_id')::uuid),
          256, '[I02.main] a long user agent is cut to 256 characters');
select throws_ok($$update app.share_access_log set user_agent = 'rewritten'$$, null, null,
                 '[I02.main] the access log is insert-only, even for its owner');

-- ─── I02.main: share by email: a placeholder hash and an ids-only notify job ──────────────────────────────────
select pg_temp.as_user('00000000-0000-4000-8601-0000000000c1');
set local role authenticated;
insert into t values ('mail', app.create_share('50000000-0000-4000-8601-00000000000a', 'email', '  Buyer@Retailer.TEST ', null, 'req-i02-main-0002'));
reset role;
select ok(pg_temp.v('mail') ->> 'token' is null and pg_temp.v('mail') ->> 'job_id' is not null
          and pg_temp.v('mail') ->> 'expires_at' is null,
          '[I02.main] an email share returns no token, a job, and no expiry when none was asked');
select ok((select recipient = 'buyer@retailer.test' and channel = 'email' and octet_length(token_hash) = 32
           from app.shares where id = (pg_temp.v('mail') ->> 'share_id')::uuid),
          '[I02.main] the recipient is stored normalised, with a placeholder hash the worker replaces');
select ok((select kind = 'notify' and status = 'queued' and idempotency_key = 'share:' || (pg_temp.v('mail') ->> 'share_id')
                  and payload = jsonb_build_object('template', 'report', 'share_id', pg_temp.v('mail') ->> 'share_id',
                                                   'request_id', 'req-i02-main-0002')
                  and requested_by = '10000000-0000-4000-8601-0000000000c1'
           from app.jobs where id = (pg_temp.v('mail') ->> 'job_id')::uuid),
          '[I02.main] the notify job holds ids only (template, share_id, request_id), key share:<id>');

-- ─── Refusals ─────────────────────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-4000-8601-0000000000c1');
set local role authenticated;
select throws_ok($$select app.create_share('50000000-0000-4000-8601-00000000000a', 'fax')$$, '22023', null,
                 '[T-601] a share is a link or an email');
select throws_ok($$select app.create_share('50000000-0000-4000-8601-00000000000a', 'email', 'not an address')$$, '22023', null,
                 '[T-601] an email share needs a valid address');
select throws_ok($$select app.create_share('50000000-0000-4000-8601-00000000000a', 'email', null)$$, '22023', null,
                 '[T-601] an email share needs an address');
select throws_ok($$select app.create_share('50000000-0000-4000-8601-00000000000a', 'link', 'x@y.test')$$, '22023', null,
                 '[T-601] a link share has no recipient');
select throws_ok($$select app.create_share('50000000-0000-4000-8601-00000000000a', 'link', null, 0)$$, '22023', null,
                 '[T-601] an expiry of zero days is refused');
select throws_ok($$select app.create_share('50000000-0000-4000-8601-00000000000a', 'link', null, 366)$$, '22023', null,
                 '[T-601] an expiry over a year is refused');
select throws_ok($$select app.create_share('50000000-0000-4000-8601-00000000000b', 'link')$$, '42501', null,
                 '[T-601] another workspace''s report cannot be shared');
select throws_ok($$select app.create_share(gen_random_uuid(), 'link')$$, '42501', null,
                 '[T-601] a missing report is refused like a forbidden one');
reset role;
select pg_temp.as_user('00000000-0000-4000-8601-0000000000f1');
set local role authenticated;
select throws_ok($$select app.create_share('50000000-0000-4000-8601-00000000000a', 'link')$$, '42501', null,
                 '[T-601] a viewer cannot share');
reset role;
select pg_temp.as_user('00000000-0000-4000-8601-0000000000e1');
set local role authenticated;
select throws_ok($$select app.create_share('50000000-0000-4000-8601-00000000000a', 'link')$$, '42501', null,
                 '[T-601] an editor scoped to another family cannot share');
reset role;
select pg_temp.as_user('00000000-0000-4000-8601-0000000000a1');
set local role authenticated;
select throws_ok(format($$select app.open_share(%L)$$, pg_temp.v('link') ->> 'token'), '42501', null,
                 '[T-601] a signed-in member cannot call open_share');
reset role;

-- ─── Reads: scoped to the product, never across workspaces ────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-4000-8601-0000000000f1');
set local role authenticated;
select is((select count(*)::int from app.shares), 2, '[T-601] a viewer of the product reads its shares');
reset role;
select pg_temp.as_user('00000000-0000-4000-8601-0000000000e1');
set local role authenticated;
select is((select count(*)::int from app.shares), 0, '[T-601] a member scoped to another family reads none of them');
reset role;
select pg_temp.as_user('00000000-0000-4000-8601-0000000000b1');
set local role authenticated;
insert into t values ('b_link', app.create_share('50000000-0000-4000-8601-00000000000b', 'link'));
select is((select count(*)::int from app.shares), 1, '[T-601] another workspace reads only its own share');
reset role;
select pg_temp.as_user('00000000-0000-4000-8601-0000000000a1');
set local role authenticated;
select is((select count(*)::int from app.shares where workspace_id = '20000000-0000-4000-8601-00000000000b'), 0,
          '[T-601] and workspace A reads none of B''s');
select throws_ok(format($$select app.revoke_share(%L)$$, pg_temp.v('b_link') ->> 'share_id'), '42501', null,
                 '[T-601] nor revokes it');
reset role;
select pg_temp.as_user('00000000-0000-4000-8601-0000000000b1');
set local role authenticated;
select is((select count(*)::int from app.shares where workspace_id = '20000000-0000-4000-8601-00000000000a'), 0, '[T-601] another workspace reads none of them');
select is((select count(*)::int from app.share_access_log), 0, '[T-601] nor their access log');
select throws_ok(format($$select app.revoke_share(%L)$$, pg_temp.v('link') ->> 'share_id'), '42501', null,
                 '[T-601] another workspace cannot revoke a share');
reset role;
select pg_temp.as_user('00000000-0000-4000-8601-0000000000c1');
set local role authenticated;
select is((select count(*)::int from app.share_access_log), 0, '[T-601] only admins read the access log');
reset role;
select pg_temp.as_user('00000000-0000-4000-8601-0000000000a1');
set local role authenticated;
select is((select count(*)::int from app.share_access_log), 2, '[T-601] an admin reads the access log');
reset role;
select throws_ok($$insert into app.shares (workspace_id, report_id, token_hash, channel)
                   values ('20000000-0000-4000-8601-00000000000b', '50000000-0000-4000-8601-00000000000a', '\x00', 'link')$$,
                 '23514', null, '[T-601] a share cannot name another workspace''s report');

-- ─── I02.must.1: revoking stops the page, never verification (BE-27) ─────────────────────────────────────────
insert into t values ('verify_before', public.verify_reference('nv-t601-reference-000000000a'));
select pg_temp.as_user('00000000-0000-4000-8601-0000000000f1');
set local role authenticated;
select throws_ok(format($$select app.revoke_share(%L)$$, pg_temp.v('link') ->> 'share_id'), '42501', null,
                 '[I02.must.1] a viewer cannot revoke');
reset role;
select pg_temp.as_user('00000000-0000-4000-8601-0000000000d1');
set local role authenticated;
insert into t values ('revoked', to_jsonb(app.revoke_share((pg_temp.v('link') ->> 'share_id')::uuid)));
insert into t values ('revoked_again', to_jsonb(app.revoke_share((pg_temp.v('link') ->> 'share_id')::uuid)));
reset role;
select ok(pg_temp.v('revoked') is not null and pg_temp.v('revoked') = pg_temp.v('revoked_again'),
          '[I02.must.1] a portfolio manager revokes a link; revoking again keeps the first time');
select is((select count(*)::int from app.audit_events where kind = 'share.revoked'
           and object_id = pg_temp.v('link') ->> 'share_id' and actor_id = '10000000-0000-4000-8601-0000000000d1'), 1,
          '[I02.must.1] the revoke is audited once');
select pg_temp.as_service();
set local role service_role;
insert into t values ('open_revoked', app.open_share(pg_temp.v('link') ->> 'token', 'after revoke'));
insert into t values ('open_unknown', app.open_share(repeat('A', 43)));
insert into t values ('open_malformed', app.open_share('short'));
reset role;
select is(pg_temp.v('open_revoked'), '{"status":"unknown"}'::jsonb,
          '[I02.must.1] revoking a link stops the share page: it answers unknown');
select ok(pg_temp.v('open_revoked') = pg_temp.v('open_unknown') and pg_temp.v('open_unknown') = pg_temp.v('open_malformed'),
          '[I02.must.1] a revoked, an unknown and a malformed token get the identical answer');
select is((select count(*)::int from app.share_access_log where user_agent = 'after revoke'), 0,
          '[I02.must.1] a refused opening logs no access');
select is(public.verify_reference('nv-t601-reference-000000000a'), pg_temp.v('verify_before'),
          '[I02.must.1] revoking a link never stops verification of the document (BE-27)');
select is(public.verify_reference('nv-t601-reference-000000000a') ->> 'status', 'current',
          '[I02.must.1] the reference still verifies as current');

-- An expired link stops the page the same way, and verification still answers.
select pg_temp.as_user('00000000-0000-4000-8601-0000000000c1');
set local role authenticated;
insert into t values ('short', app.create_share('50000000-0000-4000-8601-00000000000a', 'link', null, 1));
reset role;
update app.shares set expires_at = now() - interval '1 minute' where id = (pg_temp.v('short') ->> 'share_id')::uuid;
select pg_temp.as_service();
set local role service_role;
insert into t values ('open_expired', app.open_share(pg_temp.v('short') ->> 'token'));
reset role;
select is(pg_temp.v('open_expired'), '{"status":"unknown"}'::jsonb, '[I02.must.1] an expired link answers unknown');
select is(public.verify_reference('nv-t601-reference-000000000a') ->> 'status', 'current',
          '[I02.must.1] and the document still verifies');

select * from finish();
rollback;
