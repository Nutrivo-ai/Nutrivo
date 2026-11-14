-- T-903 · J05 scoped re-check and I05 supersession (migration 20261113105335). BE-25/BE-42: staff queue one recheck
-- job per recipe that contract 5 names. BE-30: a material diff supersedes the reports and certificates that relied on
-- the rule; an editorial diff never does, and superseded is never 'invalid'. Synthetic rows only, rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(37);
set local client_min_messages = warning;

-- ─── A: Ed (editor), Max (viewer scoped to EU-DE). B: Bo (admin). Sam: Nutrivo staff, no membership. ────────────
insert into auth.users (id, email) values
  ('00000000-0000-4000-8903-0000000000e1','ed@a.test'), ('00000000-0000-4000-8903-0000000000d1','max@a.test'),
  ('00000000-0000-4000-8903-0000000000b1','bo@b.test'), ('00000000-0000-4000-8903-0000000000c1','sam@nutrivo.test');
insert into app.people (id, user_id, display_name, email)
select ('10000000' || substr(u.id::text, 9))::uuid, u.id, split_part(u.email, '@', 1), u.email
from auth.users u where u.id::text like '00000000-0000-4000-8903-%';
insert into app.workspaces (id, name) values
  ('20000000-0000-4000-8903-00000000000a','Workspace A'), ('20000000-0000-4000-8903-00000000000b','Workspace B');
insert into app.allowances (workspace_id) values
  ('20000000-0000-4000-8903-00000000000a'), ('20000000-0000-4000-8903-00000000000b');
insert into app.families (id, workspace_id, name) values
  ('30000000-0000-4000-8903-0000000000a1','20000000-0000-4000-8903-00000000000a','Cats'),
  ('30000000-0000-4000-8903-0000000000b1','20000000-0000-4000-8903-00000000000b','Birds');
insert into app.memberships (workspace_id, person_id, role, scope_family_ids, scope_node_ids) values
  ('20000000-0000-4000-8903-00000000000a','10000000-0000-4000-8903-0000000000e1','editor', null, null),
  ('20000000-0000-4000-8903-00000000000a','10000000-0000-4000-8903-0000000000d1','viewer', null, '{EU-DE}'),
  ('20000000-0000-4000-8903-00000000000b','10000000-0000-4000-8903-0000000000b1','admin', null, null);
insert into app.products (id, workspace_id, family_id, name, stage) values
  ('40000000-0000-4000-8903-0000000000a1','20000000-0000-4000-8903-00000000000a','30000000-0000-4000-8903-0000000000a1','Cat adult','active'),
  ('40000000-0000-4000-8903-0000000000a2','20000000-0000-4000-8903-00000000000a','30000000-0000-4000-8903-0000000000a1','Cat kitten','active'),
  ('40000000-0000-4000-8903-0000000000b1','20000000-0000-4000-8903-00000000000b','30000000-0000-4000-8903-0000000000b1','Bird seed','active');

insert into ref.ruleset_versions (id, released_at) values ('T903-OLD', now() - interval '1 day'), ('T903-NEW', now());
insert into ref.rules (rule_key, shape, domain, node_id, title) values
  ('T903.R',  'mandatory_particular', 'mandatory_particulars', 'EU', 'Synthetic T-903 rule'),
  ('T903.R2', 'mandatory_particular', 'mandatory_particulars', 'EU', 'Synthetic T-903 other rule');

-- a1 applied R in EU-SE (affected); a2 only R2 (not affected); b1 withheld R in EU-SE (affected, workspace B).
insert into app.checks (id, workspace_id, product_id, node_id, ruleset_version, label_state, applied_rule_keys,
                        withheld_rule_keys) values
  ('50000000-0000-4000-8903-0000000000a1','20000000-0000-4000-8903-00000000000a','40000000-0000-4000-8903-0000000000a1','EU-SE','T903-OLD','action','{T903.R}','{}'),
  ('50000000-0000-4000-8903-0000000000a2','20000000-0000-4000-8903-00000000000a','40000000-0000-4000-8903-0000000000a2','EU-SE','T903-OLD','action','{T903.R2}','{}'),
  ('50000000-0000-4000-8903-0000000000b1','20000000-0000-4000-8903-00000000000b','40000000-0000-4000-8903-0000000000b1','EU-SE','T903-OLD','not_assessed','{}','{T903.R}');
insert into app.reports (id, workspace_id, product_id, node_id, ref, check_ids, ruleset_version, artwork_sha,
                         has_not_assessed) values
  ('60000000-0000-4000-8903-0000000000a1','20000000-0000-4000-8903-00000000000a','40000000-0000-4000-8903-0000000000a1','EU-SE','T903-REF-A1-0000000001','{50000000-0000-4000-8903-0000000000a1}','T903-OLD','sha', false),
  ('60000000-0000-4000-8903-0000000000a2','20000000-0000-4000-8903-00000000000a','40000000-0000-4000-8903-0000000000a2','EU-SE','T903-REF-A2-0000000001','{50000000-0000-4000-8903-0000000000a2}','T903-OLD','sha', false),
  ('60000000-0000-4000-8903-0000000000b1','20000000-0000-4000-8903-00000000000b','40000000-0000-4000-8903-0000000000b1','EU-SE','T903-REF-B1-0000000001','{50000000-0000-4000-8903-0000000000b1}','T903-OLD','sha', true),
  -- issued on the diff's own ruleset: already reflects the change
  ('60000000-0000-4000-8903-0000000000a3','20000000-0000-4000-8903-00000000000a','40000000-0000-4000-8903-0000000000a1','EU-SE','T903-REF-A3-0000000001','{50000000-0000-4000-8903-0000000000a1}','T903-NEW','sha', false);
insert into app.signing_grants (id, workspace_id, person_id, node_id, granted_by) values
  ('70000000-0000-4000-8903-0000000000a1','20000000-0000-4000-8903-00000000000a','10000000-0000-4000-8903-0000000000e1','EU-SE','10000000-0000-4000-8903-0000000000e1');
insert into app.certificates (id, workspace_id, report_id, product_id, node_id, signer_id, grant_id, hash) values
  ('71000000-0000-4000-8903-0000000000a1','20000000-0000-4000-8903-00000000000a','60000000-0000-4000-8903-0000000000a1','40000000-0000-4000-8903-0000000000a1','EU-SE','10000000-0000-4000-8903-0000000000e1','70000000-0000-4000-8903-0000000000a1','t903-hash-1');

-- The diffs are released after the documents above were issued (documents issued later: below).
insert into ref.rule_diffs (id, ruleset_version, rule_key, from_version, to_version, effect_type) values
  ('80000000-0000-4000-8903-0000000000d1','T903-NEW','T903.R', 1, 2, 'tightened_threshold'),
  ('80000000-0000-4000-8903-0000000000d2','T903-NEW','T903.R', 2, 3, 'editorial');

create function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.as_staff(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated',
                    'app_metadata', json_build_object('nutrivo_staff', true))::text, true);
$$;
create function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;

-- ─── I05 · supersession ──────────────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_service();
select throws_ok($$select app.supersede_for_rule_diff('80000000-0000-4000-8903-0000000000ff')$$, 'P0002', null,
                 'I05: an unknown diff is P0002');
select is(app.supersede_for_rule_diff('80000000-0000-4000-8903-0000000000d2') ->> 'skipped', 'editorial',
          'I05.must.1: an editorial diff supersedes nothing');
select is((select count(*)::int from app.supersessions where rule_diff_id = '80000000-0000-4000-8903-0000000000d2'), 0,
          'I05.must.1: no row for the editorial diff');
select is(app.supersede_for_rule_diff('80000000-0000-4000-8903-0000000000d1') - 'rule_diff_id',
          '{"effect_type":"tightened_threshold","reports":2,"certificates":1}'::jsonb,
          'I05.main: the reports whose checks applied or withheld the rule, and their certificate');
select set_eq($$select artefact_type || ':' || artefact_id from app.supersessions
                where rule_diff_id = '80000000-0000-4000-8903-0000000000d1'$$,
              $$values ('report:60000000-0000-4000-8903-0000000000a1'), ('report:60000000-0000-4000-8903-0000000000b1'),
                       ('certificate:71000000-0000-4000-8903-0000000000a1')$$,
              'I05.main: not the report on another rule, nor the one on the diff''s own ruleset');
select ok((select bool_and(rule_key = 'T903.R' and ruleset_version = 'T903-NEW' and node_id = 'EU-SE')
           from app.supersessions where rule_diff_id = '80000000-0000-4000-8903-0000000000d1'),
          'I05.main: each row carries the diff''s rule and ruleset and its artefact''s market');
select is(app.supersede_for_rule_diff('80000000-0000-4000-8903-0000000000d1') ->> 'reports', '0',
          'I05: a second run writes nothing');
select is((select count(*)::int from app.audit_events where kind = 'artefact.superseded'
             and object_id = '80000000-0000-4000-8903-0000000000d1'), 2, 'I05: audited once per workspace');
select is(public.verify_reference('T903-REF-A1-0000000001') ->> 'status', 'superseded',
          'I05.must.1: verification says superseded');
select is(public.verify_reference('T903-REF-A2-0000000001') ->> 'status', 'current', 'I05: an unaffected report is current');
select is(public.verify_reference('T903-REF-A3-0000000001') ->> 'status', 'current',
          'I05: a report on the diff''s ruleset is current');
select ok((select bool_and(public.verify_reference(r.ref) ->> 'status' in ('current', 'superseded'))
           from app.reports r where r.ref like 'T903-REF-%'), 'I05.must.1: superseded is never ''invalid''');

-- Documents issued after the diff: superseded when they are issued, by the same test.
insert into app.reports (id, workspace_id, product_id, node_id, ref, check_ids, ruleset_version, artwork_sha,
                         has_not_assessed) values
  ('60000000-0000-4000-8903-0000000000a4','20000000-0000-4000-8903-00000000000a','40000000-0000-4000-8903-0000000000a1','EU-SE','T903-REF-A4-0000000001','{50000000-0000-4000-8903-0000000000a1}','T903-OLD','sha', false),
  ('60000000-0000-4000-8903-0000000000a5','20000000-0000-4000-8903-00000000000a','40000000-0000-4000-8903-0000000000a1','EU-SE','T903-REF-A5-0000000001','{50000000-0000-4000-8903-0000000000a1}','T903-NEW','sha', false);
select is(public.verify_reference('T903-REF-A4-0000000001') ->> 'status', 'superseded',
          'I05.main: a report issued later from a check judged before the diff is superseded at once');
select is(public.verify_reference('T903-REF-A5-0000000001') ->> 'status', 'current',
          'I05.main: a report issued later on the diff''s own ruleset is current');
insert into app.certificates (id, workspace_id, report_id, product_id, node_id, signer_id, grant_id, hash) values
  ('71000000-0000-4000-8903-0000000000a4','20000000-0000-4000-8903-00000000000a','60000000-0000-4000-8903-0000000000a4','40000000-0000-4000-8903-0000000000a1','EU-SE','10000000-0000-4000-8903-0000000000e1','70000000-0000-4000-8903-0000000000a1','t903-hash-4');
select is((select count(*)::int from app.supersessions where artefact_id = '71000000-0000-4000-8903-0000000000a4'
             and rule_diff_id = '80000000-0000-4000-8903-0000000000d1'), 1,
          'I05.main: a certificate issued later on a superseded report is superseded too');
select is((select count(*)::int from app.supersessions where artefact_id = '60000000-0000-4000-8903-0000000000a4'
             and rule_diff_id = '80000000-0000-4000-8903-0000000000d2'), 0,
          'I05.must.1: never by the editorial diff, at issue either');
select is(app.supersede_for_rule_diff('80000000-0000-4000-8903-0000000000d1') ->> 'reports', '0',
          'I05: the release-time pass and the issue-time trigger never write the same row twice');

-- The schema itself: no editorial diff, the diff's own rule and ruleset; insert-only.
select throws_ok($$insert into app.supersessions (workspace_id, artefact_type, artefact_id, rule_key, rule_diff_id,
                   ruleset_version) values ('20000000-0000-4000-8903-00000000000a','report',
                   '60000000-0000-4000-8903-0000000000a2','T903.R','80000000-0000-4000-8903-0000000000d2','T903-NEW')$$,
                 '23514', null, 'I05.must.1: an editorial diff never supersedes, whoever writes');
select throws_ok($$insert into app.supersessions (workspace_id, artefact_type, artefact_id, rule_key, rule_diff_id,
                   ruleset_version) values ('20000000-0000-4000-8903-00000000000a','report',
                   '60000000-0000-4000-8903-0000000000a2','T903.R2','80000000-0000-4000-8903-0000000000d1','T903-NEW')$$,
                 '23514', null, 'I05: a supersession''s rule is its diff''s');
select throws_ok($$update app.supersessions set rule_key = 'x' where rule_diff_id = '80000000-0000-4000-8903-0000000000d1'$$,
                 null, null, 'I05: supersessions are insert-only');

-- Readers: their own workspace and scope only.
select pg_temp.as_user('00000000-0000-4000-8903-0000000000e1');
set local role authenticated;
select is((select count(*)::int from app.supersessions where rule_diff_id = '80000000-0000-4000-8903-0000000000d1'), 4,
          'I05: Ed reads A''s report and certificate supersessions (at release and at issue)');
select throws_ok($$select app.supersede_for_rule_diff('80000000-0000-4000-8903-0000000000d1')$$, '42501', null,
                 'I05: a member cannot write supersessions');
reset role;
select pg_temp.as_user('00000000-0000-4000-8903-0000000000d1');
set local role authenticated;
select is((select count(*)::int from app.supersessions), 0, 'I05: Max, scoped to EU-DE, reads none of EU-SE''s');
reset role;
select pg_temp.as_user('00000000-0000-4000-8903-0000000000b1');
set local role authenticated;
select is((select count(*)::int from app.supersessions where rule_diff_id = '80000000-0000-4000-8903-0000000000d1'), 1,
          'I05: Bo reads only workspace B''s');
reset role;

-- ─── J05 · scoped re-check ───────────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-4000-8903-0000000000e1');
set local role authenticated;
select throws_ok($$select app.request_scoped_recheck('80000000-0000-4000-8903-0000000000d1')$$, '42501', null,
                 'J05: a workspace member cannot request it (staff only)');
reset role;
select pg_temp.as_staff('00000000-0000-4000-8903-0000000000c1');
set local role authenticated;
select throws_ok($$select app.request_scoped_recheck('80000000-0000-4000-8903-0000000000ff')$$, 'P0002', null,
                 'J05: an unknown diff is P0002');
select is(app.request_scoped_recheck('80000000-0000-4000-8903-0000000000d2') -> 'jobs', '[]'::jsonb,
          'J05: an editorial diff queues nothing');
create temporary table t903_r on commit drop as
  select app.request_scoped_recheck('80000000-0000-4000-8903-0000000000d1') as r;
reset role;
select is(jsonb_array_length((select r -> 'jobs' from t903_r)), 2, 'J05.main: one job per recipe contract 5 names');
select set_eq($$select product_id::text || ' ' || array_to_string(node_ids, ',') || ' ' || requested_by::text
                from app.jobs where kind = 'recheck' and idempotency_key like 'recheck:80000000-0000-4000-8903-0000000000d1:%'$$,
              $$values ('40000000-0000-4000-8903-0000000000a1 EU-SE 10000000-0000-4000-8903-0000000000c1'),
                       ('40000000-0000-4000-8903-0000000000b1 EU-SE 10000000-0000-4000-8903-0000000000c1')$$,
              'J05.must.1: only the recipes that applied or withheld the rule, on their market, requested by staff');
select ok((select bool_and(payload - 'request_id' = jsonb_build_object('product_id', product_id, 'node_ids', to_jsonb(node_ids),
                                                     'rule_diff_id', '80000000-0000-4000-8903-0000000000d1'))
           from app.jobs where kind = 'recheck' and idempotency_key like 'recheck:80000000-0000-4000-8903-0000000000d1:%'),
          'J05: the payload holds ids only');
select is((select count(*)::int from app.audit_events where kind = 'recheck.requested'
             and object_id = '80000000-0000-4000-8903-0000000000d1'), 2, 'J05: audited once per workspace');
select pg_temp.as_staff('00000000-0000-4000-8903-0000000000c1');
set local role authenticated;
select is(jsonb_array_length(app.request_scoped_recheck('80000000-0000-4000-8903-0000000000d1') -> 'jobs'), 2,
          'J05: asking again returns the same jobs');
reset role;
select is((select count(*)::int from app.jobs where kind = 'recheck'), 2, 'J05: and queues none');
select is((select count(*)::int from app.audit_events where kind = 'recheck.requested'
             and object_id = '80000000-0000-4000-8903-0000000000d1'), 2, 'J05: nor audits a second request');

-- Job readers: the recipe's own members in scope, nobody else.
select pg_temp.as_user('00000000-0000-4000-8903-0000000000e1');
set local role authenticated;
select is((select count(*)::int from app.jobs where kind = 'recheck'), 1, 'J05: Ed reads A''s re-check job only');
reset role;
select pg_temp.as_user('00000000-0000-4000-8903-0000000000d1');
set local role authenticated;
select is((select count(*)::int from app.jobs where kind = 'recheck'), 0, 'J05: Max (EU-DE) does not read the EU-SE job');
reset role;

-- Grants.
select ok(not has_function_privilege('anon', 'app.request_scoped_recheck(uuid)', 'execute')
          and not has_function_privilege('anon', 'app.supersede_for_rule_diff(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'app.supersede_for_rule_diff(uuid)', 'execute'),
          'anon executes neither; authenticated cannot write supersessions');

select * from finish();
rollback;
