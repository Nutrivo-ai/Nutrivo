-- T-1103 · security sweep (#81), migration 20261114142050: certificates are issued only inside the signer's scope,
-- for the report's own market, and only for a market that displays Clear; certificates are read with market scope;
-- artwork uploads follow family scope. Synthetic rows only, rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(47);
set local client_min_messages = warning;

-- ─── A: Sam (admin, everything), Fay (editor scoped to family A1), Max (editor scoped to EU-DK). B: Bo (admin). ───
insert into auth.users (id, email) values
  ('00000000-0000-4000-8110-0000000000a1','sam@a.test'), ('00000000-0000-4000-8110-0000000000f1','fay@a.test'),
  ('00000000-0000-4000-8110-0000000000d1','max@a.test'), ('00000000-0000-4000-8110-0000000000b1','bo@b.test');
insert into app.people (id, user_id, display_name, email)
select ('10000000' || substr(u.id::text, 9))::uuid, u.id, split_part(u.email, '@', 1), u.email
from auth.users u where u.id::text like '00000000-0000-4000-8110-%';
insert into app.workspaces (id, name) values
  ('20000000-0000-4000-8110-00000000000a','Workspace A'), ('20000000-0000-4000-8110-00000000000b','Workspace B');
insert into app.allowances (workspace_id) values
  ('20000000-0000-4000-8110-00000000000a'), ('20000000-0000-4000-8110-00000000000b');
insert into app.families (id, workspace_id, name) values
  ('30000000-0000-4000-8110-0000000000a1','20000000-0000-4000-8110-00000000000a','Cats'),
  ('30000000-0000-4000-8110-0000000000a2','20000000-0000-4000-8110-00000000000a','Dogs'),
  ('30000000-0000-4000-8110-0000000000b1','20000000-0000-4000-8110-00000000000b','Birds');
insert into app.memberships (workspace_id, person_id, role, scope_family_ids, scope_node_ids) values
  ('20000000-0000-4000-8110-00000000000a','10000000-0000-4000-8110-0000000000a1','admin', null, null),
  ('20000000-0000-4000-8110-00000000000a','10000000-0000-4000-8110-0000000000f1','editor',
   '{30000000-0000-4000-8110-0000000000a1}', null),
  ('20000000-0000-4000-8110-00000000000a','10000000-0000-4000-8110-0000000000d1','editor', null, '{EU-DK}'),
  ('20000000-0000-4000-8110-00000000000b','10000000-0000-4000-8110-0000000000b1','admin', null, null);
insert into app.products (id, workspace_id, family_id, name, stage) values
  ('40000000-0000-4000-8110-0000000000a1','20000000-0000-4000-8110-00000000000a','30000000-0000-4000-8110-0000000000a1','Cat adult','active'),
  ('40000000-0000-4000-8110-0000000000a2','20000000-0000-4000-8110-00000000000a','30000000-0000-4000-8110-0000000000a2','Dog adult','active'),
  ('40000000-0000-4000-8110-0000000000b1','20000000-0000-4000-8110-00000000000b','30000000-0000-4000-8110-0000000000b1','Bird seed','active');
insert into app.signing_grants (id, workspace_id, person_id, node_id, granted_by) values
  ('50000000-0000-4000-8110-0000000000a1','20000000-0000-4000-8110-00000000000a','10000000-0000-4000-8110-0000000000a1','EU-DK','10000000-0000-4000-8110-0000000000a1'),
  ('50000000-0000-4000-8110-0000000000a2','20000000-0000-4000-8110-00000000000a','10000000-0000-4000-8110-0000000000a1','EU-SE','10000000-0000-4000-8110-0000000000a1'),
  ('50000000-0000-4000-8110-0000000000a3','20000000-0000-4000-8110-00000000000a','10000000-0000-4000-8110-0000000000a1','EU-FR','10000000-0000-4000-8110-0000000000a1'),
  ('50000000-0000-4000-8110-0000000000f1','20000000-0000-4000-8110-00000000000a','10000000-0000-4000-8110-0000000000f1','EU-DK','10000000-0000-4000-8110-0000000000a1'),
  ('50000000-0000-4000-8110-0000000000d1','20000000-0000-4000-8110-00000000000a','10000000-0000-4000-8110-0000000000d1','EU-SE','10000000-0000-4000-8110-0000000000a1');

-- Ruleset T1103-V: EU-DK and EU-SE have all six domains complete, so a clear label state survives verdict_guard.
insert into ref.ruleset_versions (id) values ('T1103-V');
insert into ref.coverage_nodes (ruleset_version, node_id, domain, state, rules_encoded, gap_id)
select 'T1103-V', n, d, 'complete', 1, null
from unnest(array['EU-DK','EU-SE']) n,
     unnest(array['mandatory_particulars','composition','claims_wording','type_geometry','language','registration']) d;
-- Cat adult: EU-DK clear and registered; EU-SE label clear but registration unknown (displays not_assessed);
-- EU-FR has no row. Dog adult: EU-DK clear and registered.
insert into app.product_nodes (product_id, node_id, workspace_id, label_state, registration_state, ruleset_version) values
  ('40000000-0000-4000-8110-0000000000a1','EU-DK','20000000-0000-4000-8110-00000000000a','clear','registered','T1103-V'),
  ('40000000-0000-4000-8110-0000000000a1','EU-SE','20000000-0000-4000-8110-00000000000a','clear','unknown','T1103-V'),
  ('40000000-0000-4000-8110-0000000000a2','EU-DK','20000000-0000-4000-8110-00000000000a','clear','registered','T1103-V');
-- Checks, oldest first: Cat EU-DK on old artwork (action), then on the current artwork once with an action and then
-- clear (the latest); Dog EU-DK clear, then clear again on the same artwork and ruleset (a new classification or
-- formula: the report citing the first is stale); Cat EU-SE clear.
insert into app.checks (id, workspace_id, product_id, node_id, ruleset_version, label_state, artwork_sha, at,
                        applied_rule_keys, passed_rule_keys) values
  ('70000000-0000-4000-8110-0000000000c0','20000000-0000-4000-8110-00000000000a','40000000-0000-4000-8110-0000000000a1','EU-DK','T1103-V','action','old-sha', now() - interval '2 days', '{T1103.R}', '{}'),
  ('70000000-0000-4000-8110-0000000000c9','20000000-0000-4000-8110-00000000000a','40000000-0000-4000-8110-0000000000a1','EU-DK','T1103-V','action','sha',     now() - interval '2 hours', '{T1103.R}', '{}'),
  ('70000000-0000-4000-8110-0000000000c1','20000000-0000-4000-8110-00000000000a','40000000-0000-4000-8110-0000000000a1','EU-DK','T1103-V','clear', 'sha',     now() - interval '1 hour', '{T1103.R}', '{T1103.R}'),
  ('70000000-0000-4000-8110-0000000000c2','20000000-0000-4000-8110-00000000000a','40000000-0000-4000-8110-0000000000a2','EU-DK','T1103-V','clear', 'sha',     now() - interval '1 hour', '{T1103.R}', '{T1103.R}'),
  ('70000000-0000-4000-8110-0000000000c3','20000000-0000-4000-8110-00000000000a','40000000-0000-4000-8110-0000000000a2','EU-DK','T1103-V','clear', 'sha',     now() - interval '30 minutes', '{T1103.R}', '{T1103.R}'),
  ('70000000-0000-4000-8110-0000000000c5','20000000-0000-4000-8110-00000000000a','40000000-0000-4000-8110-0000000000a1','EU-SE','T1103-V','clear', 'sha',     now() - interval '1 hour', '{T1103.R}', '{T1103.R}');
insert into app.reports (id, workspace_id, product_id, node_id, ref, check_ids, ruleset_version, artwork_sha, has_not_assessed) values
  ('60000000-0000-4000-8110-0000000000a1','20000000-0000-4000-8110-00000000000a','40000000-0000-4000-8110-0000000000a1','EU-DK','T1103REFAAAAAAAAAAAAAAAAA1',
   '{70000000-0000-4000-8110-0000000000c1}','T1103-V','sha',false),
  ('60000000-0000-4000-8110-0000000000a2','20000000-0000-4000-8110-00000000000a','40000000-0000-4000-8110-0000000000a2','EU-DK','T1103REFAAAAAAAAAAAAAAAAA2',
   '{70000000-0000-4000-8110-0000000000c2}','T1103-V','sha',false),
  ('60000000-0000-4000-8110-0000000000a3','20000000-0000-4000-8110-00000000000a','40000000-0000-4000-8110-0000000000a1',null,'T1103REFAAAAAAAAAAAAAAAAA3',
   '{70000000-0000-4000-8110-0000000000c1}','T1103-V','sha',false),
  ('60000000-0000-4000-8110-0000000000a4','20000000-0000-4000-8110-00000000000a','40000000-0000-4000-8110-0000000000a1','EU-SE','T1103REFAAAAAAAAAAAAAAAAA4',
   '{70000000-0000-4000-8110-0000000000c5}','T1103-V','sha',false),
  ('60000000-0000-4000-8110-0000000000a5','20000000-0000-4000-8110-00000000000a','40000000-0000-4000-8110-0000000000a1','EU-DK','T1103REFAAAAAAAAAAAAAAAAA5',
   '{70000000-0000-4000-8110-0000000000c0}','T1103-V','old-sha',true),
  ('60000000-0000-4000-8110-0000000000a6','20000000-0000-4000-8110-00000000000a','40000000-0000-4000-8110-0000000000a1','EU-DK','T1103REFAAAAAAAAAAAAAAAAA6',
   '{70000000-0000-4000-8110-0000000000c1}','T1103-V','sha',true),
  ('60000000-0000-4000-8110-0000000000a7','20000000-0000-4000-8110-00000000000a','40000000-0000-4000-8110-0000000000a1','EU-DK','T1103REFAAAAAAAAAAAAAAAAA7',
   '{70000000-0000-4000-8110-0000000000c1,70000000-0000-4000-8110-0000000000c9}','T1103-V','sha',false),
  ('60000000-0000-4000-8110-0000000000a8','20000000-0000-4000-8110-00000000000a','40000000-0000-4000-8110-0000000000a1','EU-FR','T1103REFAAAAAAAAAAAAAAAAA8',
   '{}','T1103-V','sha',false);

create function pg_temp.as_user(uid text, aal text default 'aal2') returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true);
$$;

-- ─── 1 · issue_certificate: scope, the report's own market, the latest check, and only a clear report ─────────────
select pg_temp.as_user('00000000-0000-4000-8110-0000000000f1');
set local role authenticated;
select throws_ok($$select app.issue_certificate('60000000-0000-4000-8110-0000000000a2', 'EU-DK')$$,
                 'P0002', 'report not found',
                 '[T-1103] a family-scoped signer cannot certify a product outside their families, and learns nothing');
reset role;

select pg_temp.as_user('00000000-0000-4000-8110-0000000000d1');
set local role authenticated;
select throws_ok($$select app.issue_certificate('60000000-0000-4000-8110-0000000000a4', 'EU-SE')$$,
                 'P0291', null, '[T-1103] a market-scoped signer cannot certify a market outside their scope, grant or not');
reset role;

select pg_temp.as_user('00000000-0000-4000-8110-0000000000a1');
set local role authenticated;
select throws_ok($$select app.issue_certificate('60000000-0000-4000-8110-0000000000a1', 'EU-SE')$$,
                 '22023', null, '[T-1103] a report for EU-DK is never certified for another market');
select throws_ok($$select app.issue_certificate('60000000-0000-4000-8110-0000000000a3', 'EU-DK')$$,
                 '22023', null, '[T-1103] a report that names no market is never certified for one');
select throws_ok($$select app.issue_certificate('60000000-0000-4000-8110-0000000000a5', 'EU-DK')$$,
                 'P0294', null,
                 '[T-1103] an old report on old artwork is never certified because a later check made the market Clear');
select throws_ok($$select app.issue_certificate('60000000-0000-4000-8110-0000000000a2', 'EU-DK')$$,
                 'P0294', null,
                 '[T-1103] a report whose check is no longer the market''s latest is stale, even on the same artwork and ruleset');
select throws_ok($$select app.issue_certificate('60000000-0000-4000-8110-0000000000a6', 'EU-DK')$$,
                 'P0293', null, '[T-1103] a report with Not assessed items is never certified');
select throws_ok($$select app.issue_certificate('60000000-0000-4000-8110-0000000000a7', 'EU-DK')$$,
                 'P0293', null, '[T-1103] a report citing a check with an open action is never certified');
select throws_ok($$select app.issue_certificate('60000000-0000-4000-8110-0000000000a4', 'EU-SE')$$,
                 'P0293', null,
                 '[T-1103] a market whose registration is unknown displays not assessed and is never certified (non-negotiable 8)');
select throws_ok($$select app.issue_certificate('60000000-0000-4000-8110-0000000000a8', 'EU-FR')$$,
                 'P0294', null, '[T-1103] a market never checked is never certified (non-negotiable 3)');
reset role;
select pg_temp.as_user('00000000-0000-4000-8110-0000000000a1', 'aal1');
set local role authenticated;
select throws_ok($$select app.issue_certificate('60000000-0000-4000-8110-0000000000a1', 'EU-DK')$$,
                 'P0292', null, '[T-1103] two-factor is still required before the report''s state is looked at');
reset role;
select pg_temp.as_user('00000000-0000-4000-8110-0000000000a1');
set local role authenticated;
select ok(app.issue_certificate('60000000-0000-4000-8110-0000000000a1', 'EU-DK') is not null,
          '[T-1103] a signer in scope certifies a clear report of the market''s latest check');
reset role;
select pg_temp.as_user('00000000-0000-4000-8110-0000000000f1');
set local role authenticated;
select ok(app.issue_certificate('60000000-0000-4000-8110-0000000000a1', 'EU-DK') is not null,
          '[T-1103] a family-scoped signer still certifies a product in their family');
reset role;

-- ─── 2 · certificates are read with market scope ─────────────────────────────────────────────────────────────────
-- A certificate for EU-SE written before this sweep (insert-only rows stay; reads now follow the market).
insert into app.certificates (workspace_id, report_id, product_id, node_id, signer_id, grant_id, prev_hash, hash) values
  ('20000000-0000-4000-8110-00000000000a','60000000-0000-4000-8110-0000000000a4','40000000-0000-4000-8110-0000000000a1',
   'EU-SE','10000000-0000-4000-8110-0000000000a1','50000000-0000-4000-8110-0000000000a2', null, 'legacy-hash');
select pg_temp.as_user('00000000-0000-4000-8110-0000000000a1');
set local role authenticated;
select is((select count(*)::int from app.certificates), 3, '[T-1103] an unscoped member reads every certificate of the workspace');
reset role;
select pg_temp.as_user('00000000-0000-4000-8110-0000000000d1');
set local role authenticated;
select is((select array_agg(distinct node_id) from app.certificates), array['EU-DK'],
          '[T-1103] a market-scoped member reads certificates for their own markets only');
reset role;
select pg_temp.as_user('00000000-0000-4000-8110-0000000000f1');
set local role authenticated;
select is((select count(*)::int from app.certificates where product_id <> '40000000-0000-4000-8110-0000000000a1'), 0,
          '[T-1103] a family-scoped member reads no certificate of another family''s product');
reset role;
select pg_temp.as_user('00000000-0000-4000-8110-0000000000b1');
set local role authenticated;
select is((select count(*)::int from app.certificates), 0, '[T-1103] another workspace reads no certificate');
reset role;

-- ─── 3 · artwork uploads follow family scope ─────────────────────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-4000-8110-0000000000f1');
set local role authenticated;
select lives_ok($$insert into storage.objects (bucket_id, name) values
                  ('artwork', '20000000-0000-4000-8110-00000000000a/40000000-0000-4000-8110-0000000000a1/' || repeat('a', 64) || '.pdf')$$,
                '[T-1103] a family-scoped editor uploads artwork for a product in their family');
select throws_ok($$insert into storage.objects (bucket_id, name) values
                  ('artwork', '20000000-0000-4000-8110-00000000000a/40000000-0000-4000-8110-0000000000a2/' || repeat('b', 64) || '.pdf')$$,
                 '42501', null, '[T-1103] a family-scoped editor cannot upload under another family''s product');
select throws_ok($$insert into storage.objects (bucket_id, name) values
                  ('artwork', '20000000-0000-4000-8110-00000000000a/stray.pdf')$$,
                 '42501', null, '[T-1103] no upload outside a product folder');
select ok(not private.can_upload_artwork('20000000-0000-4000-8110-00000000000b/40000000-0000-4000-8110-0000000000a1/x.pdf')
          and not private.can_upload_artwork('not-a-uuid/also-not/x.pdf') and not private.can_upload_artwork(''),
          '[T-1103] a product under another workspace''s folder, or a malformed path, is refused without an error');
reset role;
select pg_temp.as_user('00000000-0000-4000-8110-0000000000a1');
set local role authenticated;
select ok(private.can_upload_artwork('20000000-0000-4000-8110-00000000000a/40000000-0000-4000-8110-0000000000a2/x.pdf'),
          '[T-1103] an unscoped editor still uploads for every product of the workspace');
reset role;
select ok(not has_function_privilege('anon', 'private.can_upload_artwork(text)', 'execute')
          and not has_function_privilege('anon', 'app.issue_certificate(uuid,text)', 'execute'),
          '[T-1103] anon executes neither the upload check nor issue_certificate');

-- ─── 4 · rate limits on RPCs: per job kind, per person and per workspace, signed-in callers only ─────────────────
update private.rate_limits set per_person = 2, per_workspace = 3 where kind = 'export';
select pg_temp.as_user('00000000-0000-4000-8110-0000000000a1');
select ok(private.enqueue('export', '20000000-0000-4000-8110-00000000000a', 't1103:e1', '{}') is not null
          and private.enqueue('export', '20000000-0000-4000-8110-00000000000a', 't1103:e2', '{}') is not null,
          '[T-1103] a person''s requests within the limit are queued');
select ok(private.enqueue('export', '20000000-0000-4000-8110-00000000000a', 't1103:e1', '{}') is not null,
          '[T-1103] a request answered by the existing job is not counted');
select throws_ok($$select private.enqueue('export', '20000000-0000-4000-8110-00000000000a', 't1103:e3', '{}')$$,
                 'P0049', null, '[T-1103] past the per-person limit the request is refused with P0049');
select is((select count(*)::int from app.jobs where idempotency_key = 't1103:e3'), 0,
          '[T-1103] a refused request queues nothing');
select pg_temp.as_user('00000000-0000-4000-8110-0000000000f1');
select ok(private.enqueue('export', '20000000-0000-4000-8110-00000000000a', 't1103:e4', '{}') is not null,
          '[T-1103] another person in the workspace still has their own allowance');
select throws_ok($$select private.enqueue('export', '20000000-0000-4000-8110-00000000000a', 't1103:e5', '{}')$$,
                 'P0049', null, '[T-1103] past the per-workspace limit every member is refused');
select pg_temp.as_user('00000000-0000-4000-8110-0000000000b1');
select ok(private.enqueue('export', '20000000-0000-4000-8110-00000000000b', 't1103:e6', '{}') is not null,
          '[T-1103] another workspace is not affected');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select ok(private.enqueue('export', '20000000-0000-4000-8110-00000000000a', 't1103:e7', '{}') is not null,
          '[T-1103] the worker and the service role are never limited');
select set_config('request.jwt.claims', '', true);
select ok(private.enqueue('export', '20000000-0000-4000-8110-00000000000a', 't1103:e8', '{}') is not null,
          '[T-1103] pg_cron and other callers without a JWT are never limited');
-- The earlier exports finished, so request_export would queue a new one.
update app.jobs set status = 'succeeded' where idempotency_key like 't1103:e%';
select pg_temp.as_user('00000000-0000-4000-8110-0000000000a1');
set local role authenticated;
select throws_ok($$select app.request_export('20000000-0000-4000-8110-00000000000a')$$,
                 'P0049', null, '[T-1103] the limit reaches the RPC itself: request_export rolls back with P0049');
reset role;
-- A requeue of a finished job counts too (retry_extraction, request_envelope): Sam's allowance is spent.
reset role;
select pg_temp.as_user('00000000-0000-4000-8110-0000000000a1');
select throws_ok($$update app.jobs set status = 'queued' where idempotency_key = 't1103:e1'$$,
                 'P0049', null, '[T-1103] requeueing a finished job past the limit is refused like a new request');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok($$update app.jobs set status = 'queued' where idempotency_key = 't1103:e1'$$,
                '[T-1103] the worker requeues without a limit');
update private.rate_limits set per_person = 1, per_workspace = 1 where kind = 'notify';
select pg_temp.as_user('00000000-0000-4000-8110-0000000000a1');
select ok(private.enqueue('notify', '20000000-0000-4000-8110-00000000000a', 't1103:n1', '{}') is not null
          and private.enqueue('notify', '20000000-0000-4000-8110-00000000000a', 'allowance:t1103', '{}') is not null,
          '[T-1103] the system''s allowance-used email never counts against the person who triggered it');
select is((select array_agg(kind order by kind) from private.rate_limits),
          array['check','envelope','export','extract','notify','report'],
          '[T-1103] every kind a member can queue at will has a limit: checks, extractions, reports, envelopes, exports, email');
-- retry_after_s follows the sliding window, not the fixed one.
select is(private.rate_retry_after(1, 20, 10, 3600, 0), 1801,
          '[T-1103] refused by the previous window''s weight: retry when that weight has fallen to the limit (half an hour)');
select is(private.rate_retry_after(1, 20, 10, 3600, 1000), 801,
          '[T-1103] the same, later in the window: less to wait');
select is(private.rate_retry_after(11, 0, 10, 3600, 600), 3001,
          '[T-1103] the current window alone is full: retry just after it ends');
create function pg_temp.refusal_hint(p_sql text) returns jsonb language plpgsql as $$
declare v_hint text;
begin
  execute p_sql;
  return null;
exception when sqlstate 'P0049' then
  get stacked diagnostics v_hint = pg_exception_hint;
  return v_hint::jsonb;
end $$;
select pg_temp.as_user('00000000-0000-4000-8110-0000000000d1');
update private.rate_limits set per_person = 1, per_workspace = 100 where kind = 'report';
select ok(private.enqueue('report', '20000000-0000-4000-8110-00000000000a', 't1103:r1', '{}') is not null,
          '[T-1103] a first report request within a limit of one');
select is(pg_temp.refusal_hint($$select private.enqueue('report', '20000000-0000-4000-8110-00000000000a', 't1103:r2', '{}')$$)
          -> 'kind', '"report"'::jsonb, '[T-1103] the P0049 hint names the kind');
select ok((pg_temp.refusal_hint($$select private.enqueue('report', '20000000-0000-4000-8110-00000000000a', 't1103:r3', '{}')$$)
           ->> 'retry_after_s')::int between 1 and 3601,
          '[T-1103] the P0049 hint gives the seconds to wait');
reset role;
select ok(not has_function_privilege('authenticated', 'app.purge_rate_counters(text)', 'execute')
          and not has_function_privilege('authenticated', 'private.enqueue_rate_purge()', 'execute'),
          '[T-1103] only the worker purges the counters');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into private.rate_counters (kind, subject, window_start, hits)
values ('report', '20000000-0000-4000-8110-00000000000a', now() - interval '3 days', 5);
select is(app.purge_rate_counters('t1103') ->> 'deleted', '1', '[T-1103] the purge deletes counters older than two days only');
select ok(private.enqueue_rate_purge() is not null, '[T-1103] the daily rate_purge job can be queued (a known job kind)');
select ok(not has_table_privilege('authenticated', 'private.rate_counters', 'select')
          and not has_function_privilege('authenticated', 'private.take_rate(text,uuid,int,int)', 'execute'),
          '[T-1103] members can neither read nor reset the counters');

select * from finish();
rollback;
