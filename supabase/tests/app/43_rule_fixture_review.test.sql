-- Incident #360 · Rule fixtures are proposed by the worker and confirmed or rejected by staff at aal2
-- (app.decide_rule_fixture). The release gate, BE-10 and the draft digest count confirmed fixtures only.
-- Everything here is synthetic (TEST.I360.* rules, synthetic inputs): no regulatory content.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(33);
set local client_min_messages = warning;

-- ─── Staff (Sam) and a non-staff person (Nina); one accepted and one candidate synthetic version ───
insert into auth.users (id, email) values
  ('00000000-0000-4000-8360-0000000000a1','sam@staff.test'), ('00000000-0000-4000-8360-0000000000b1','nina@n.test');
insert into app.people (id, user_id, display_name, email) values
  ('10000000-0000-4000-8360-0000000000a1','00000000-0000-4000-8360-0000000000a1','sam','sam@staff.test'),
  ('10000000-0000-4000-8360-0000000000b1','00000000-0000-4000-8360-0000000000b1','nina','nina@n.test');
insert into ref.rules (rule_key, shape, domain, node_id, title) values
  ('TEST.I360.A','mandatory_particular','mandatory_particulars','EU','Synthetic rule A');
insert into ref.rule_versions (rule_key, version, status, params, article_ref, source_excerpt, effect_type,
                               accepted_by, accepted_at) values
  ('TEST.I360.A', 1, 'accepted', '{"particular":"synthetic"}', 'Synthetic Act Art. 1', 'Synthetic excerpt.',
   'new_obligation', '10000000-0000-4000-8360-0000000000a1', now());
insert into ref.rule_versions (rule_key, version, status, params, article_ref, source_excerpt) values
  ('TEST.I360.A', 2, 'candidate', '{"particular":"synthetic two"}', 'Synthetic Act Art. 1', 'Synthetic excerpt.');

-- As `nutrivo fixtures draft` writes them: proposed, with the runner's name.
insert into ref.rule_fixtures (id, rule_key, version, name, input, expected_outcome, status, proposed_by, proposed_at)
values
  ('90000000-0000-4000-8360-000000000001','TEST.I360.A',1,'synthetic passed','{"panel":"synthetic"}','passed',
   'proposed','test',now()),
  ('90000000-0000-4000-8360-000000000002','TEST.I360.A',1,'synthetic failed','{"panel":"synthetic"}','failed',
   'proposed','test',now()),
  ('90000000-0000-4000-8360-000000000003','TEST.I360.A',1,'synthetic withheld','{"panel":"synthetic"}','withheld',
   'proposed','test',now()),
  ('90000000-0000-4000-8360-000000000004','TEST.I360.A',1,'synthetic withheld, second','{"panel":"other"}','withheld',
   'proposed','test',now()),
  ('90000000-0000-4000-8360-000000000005','TEST.I360.A',2,'synthetic passed','{"panel":"synthetic"}','passed',
   'proposed','test',now());

-- ─── Shape, grants and RLS ──────────────────────────────────────────────────────────────────────
select col_default_is('ref', 'rule_fixtures', 'status', 'proposed'::text,
                      '[#360] a fixture nobody has decided is only proposed');
select throws_ok($$insert into ref.rule_fixtures (rule_key, version, name, input, expected_outcome, status, decided_by)
                   values ('TEST.I360.A', 1, 'x', '{}', 'passed', 'proposed', '10000000-0000-4000-8360-0000000000a1')$$,
                 '22023', null, '[#360] a proposed fixture carries no decider');
select throws_ok($$insert into ref.rule_fixtures (rule_key, version, name, input, expected_outcome, status, decided_by,
                                                  decided_at)
                   values ('TEST.I360.A', 1, 'x', '{}', 'passed', 'confirmed', '10000000-0000-4000-8360-0000000000a1',
                           now())$$,
                 '22023', null, '[#360] no fixture is inserted confirmed, not even by the service role');
select throws_ok($$update ref.rule_fixtures set status = 'confirmed' where id = '90000000-0000-4000-8360-000000000001'$$,
                 '22023', null, '[#360] a fixture is not confirmed without naming the person who decided');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'ref' and c.relname = 'rule_fixtures'), '[#360] ref.rule_fixtures has RLS on');
select ok(not has_table_privilege('authenticated', 'ref.rule_fixtures', 'insert')
          and not has_table_privilege('authenticated', 'ref.rule_fixtures', 'update')
          and not has_table_privilege('authenticated', 'ref.rule_fixtures', 'delete')
          and not has_table_privilege('anon', 'ref.rule_fixtures', 'select'),
          '[#360] clients get no write grant on fixtures, and anon reads nothing');
select ok(not has_function_privilege('anon', 'app.decide_rule_fixture(uuid,text,text)', 'execute')
          and has_function_privilege('authenticated', 'app.decide_rule_fixture(uuid,text,text)', 'execute')
          and not has_function_privilege('authenticated', 'private.rule_fixture_status_guard()', 'execute'),
          '[#360] decide_rule_fixture runs for authenticated users (staff and aal2 checked inside), never anon');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8360-0000000000b1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is((select count(*)::int from ref.rule_fixtures where rule_key = 'TEST.I360.A'), 0,
          '[#360] a person who is not staff cannot read proposed fixtures');
select throws_ok($$select app.decide_rule_fixture('90000000-0000-4000-8360-000000000001', 'confirm')$$,
                 '42501', null, '[#360] a person who is not staff cannot confirm a fixture');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8360-0000000000a1","role":"authenticated","aal":"aal1","app_metadata":{"nutrivo_staff":true}}', true);
set local role authenticated;
select is((select count(*)::int from ref.rule_fixtures where rule_key = 'TEST.I360.A'), 5,
          '[#360] staff read proposed fixtures');
select throws_ok($$select app.decide_rule_fixture('90000000-0000-4000-8360-000000000001', 'confirm')$$,
                 '42501', null, '[#360] staff at aal1 cannot confirm a fixture: staff work at aal2');
reset role;

-- ─── The gate counts confirmed fixtures only ─────────────────────────────────────────────────────
select ok(not private.version_tested('TEST.I360.A', 1),
          '[K05.must.1] proposed passed, failed and withheld fixtures do not make a version tested');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8360-0000000000a1","role":"authenticated","aal":"aal2","app_metadata":{"nutrivo_staff":true}}', true);
set local role authenticated;
select lives_ok($$select app.create_ruleset_draft('2026.93-i360', 'synthetic')$$, '[#360] a draft is started');
select lives_ok($$select app.set_draft_member('2026.93-i360', 'TEST.I360.A', 1)$$, '[#360] the version is a member');
select throws_ok($$select app.set_draft_coverage('2026.93-i360', 'EU-SE', 'mandatory_particulars', 'complete')$$,
                 'P0010', null, '[#360] BE-10: complete is refused while the member''s fixtures are only proposed');
select throws_ok($$select app.release_ruleset('2026.93-i360')$$, 'P0039', null,
                 '[K05.must.1] no release while a member''s fixtures are only proposed');
reset role;
select is(private.ruleset_draft_fixture_count('2026.93-i360'), 0,
          '[#360] the fixture count a run must reach counts no proposed fixture');
create temp table digests as select private.ruleset_draft_digest('2026.93-i360') as before;

-- ─── Deciding ────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
select throws_ok($$select app.decide_rule_fixture('90000000-0000-4000-8360-000000000001', 'accept')$$,
                 '22023', null, '[#360] a fixture decision is confirm or reject');
select throws_ok($$select app.decide_rule_fixture('90000000-0000-4000-8360-000000000005', 'confirm')$$,
                 '22023', null, '[#360] a fixture of a version that is not accepted cannot be confirmed');
select is(app.decide_rule_fixture('90000000-0000-4000-8360-000000000001', 'confirm', 'checked against the text')
            ->> 'status', 'confirmed', '[#360] staff at aal2 confirm a proposed fixture');
reset role;
select isnt(private.ruleset_draft_digest('2026.93-i360'), (select before from digests),
            '[#360] confirming a fixture changes the draft digest, so an earlier fixture run goes stale');
set local role authenticated;
select is(app.decide_rule_fixture('90000000-0000-4000-8360-000000000004', 'reject') ->> 'status', 'rejected',
          '[#360] staff reject a proposed fixture');
select throws_ok($$select app.decide_rule_fixture('90000000-0000-4000-8360-000000000001', 'reject')$$,
                 '22023', null, '[#360] a decided fixture is not decided again');
select is(app.decide_rule_fixture('90000000-0000-4000-8360-000000000002', 'confirm') ->> 'tested', 'false',
          '[#360] two of three outcomes confirmed: not tested yet');
select is(app.decide_rule_fixture('90000000-0000-4000-8360-000000000003', 'confirm') ->> 'tested', 'true',
          '[K05.must.1] confirmed passed, failed and withheld fixtures make the version tested');
reset role;
select is(private.ruleset_draft_fixture_count('2026.93-i360'), 3,
          '[#360] the run must judge the three confirmed fixtures, not the rejected one');
select results_eq(
  $$select status, decided_by, decided_at is not null, decision_note from ref.rule_fixtures
    where id = '90000000-0000-4000-8360-000000000001'$$,
  $$values ('confirmed'::text, '10000000-0000-4000-8360-0000000000a1'::uuid, true, 'checked against the text'::text)$$,
  '[#360] the fixture records who confirmed it, when, and their note');
select is((select count(*)::int from app.audit_events where object_type = 'rule_fixture'
           and object_id like '90000000-0000-4000-8360-%' and actor_id = '10000000-0000-4000-8360-0000000000a1'
           and kind in ('rule_fixture.confirmed','rule_fixture.rejected')), 4,
          '[#360] every decision is audited with the staff actor');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8360-0000000000b1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is((select count(*)::int from ref.rule_fixtures where rule_key = 'TEST.I360.A'), 3,
          '[#360] authenticated users read confirmed fixtures only');
reset role;

-- ─── A decision is final ─────────────────────────────────────────────────────────────────────────
select throws_ok($$update ref.rule_fixtures set status = 'proposed', decided_by = null, decided_at = null
                   where id = '90000000-0000-4000-8360-000000000001'$$,
                 '22023', null, '[#360] a confirmed fixture never goes back to proposed');
select throws_ok($$update ref.rule_fixtures set status = 'confirmed' where id = '90000000-0000-4000-8360-000000000004'$$,
                 '22023', null, '[#360] a rejected fixture is never confirmed later');
select is((select status from ref.rule_fixtures where id = '90000000-0000-4000-8360-000000000004'), 'rejected',
          '[#360] the rejected fixture stays rejected');
select throws_ok($$update ref.rule_fixtures set expected_outcome = 'withheld', input = '{"panel":"other"}'
                   where id = '90000000-0000-4000-8360-000000000001'$$,
                 '22023', null, '[#360] a confirmed fixture''s content never changes after the person''s decision');

select * from finish();
rollback;
