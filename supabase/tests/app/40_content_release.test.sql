-- T-204 · Staff content RPCs: accept or reject a candidate, term decisions, coverage edits on a draft, and
-- release_ruleset with the fixture gate (K05) writing typed diffs (J02).
-- Everything here is synthetic (TEST.T204.* rules, a synthetic act and excerpts): no regulatory content.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(68);
set local client_min_messages = warning;

-- ─── Staff (Sam) and a non-staff member (Nina) ──────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-4000-8204-0000000000a1','sam@staff.test'), ('00000000-0000-4000-8204-0000000000b1','nina@n.test');
insert into app.people (id, user_id, display_name, email) values
  ('10000000-0000-4000-8204-0000000000a1','00000000-0000-4000-8204-0000000000a1','sam','sam@staff.test'),
  ('10000000-0000-4000-8204-0000000000b1','00000000-0000-4000-8204-0000000000b1','nina','nina@n.test');

insert into ref.sources (id, kind, celex, title, url, language, licence, sha256, storage_path) values
  ('60000000-0000-4000-8204-0000000000a1','eurlex','TEST-T204','Synthetic act (Swedish)','https://example.test/sv','sv',
   'eu_reuse','aa','eurlex/TEST-T204/sv/aa.xhtml'),
  ('60000000-0000-4000-8204-0000000000a2','eurlex','TEST-T204','Synthetic act (English)','https://example.test/en','en',
   'eu_reuse','bb','eurlex/TEST-T204/en/bb.xhtml');

-- A value as the K01/K02 extractor stores it (content/extract.py): the model's answer under "extraction".
create function pg_temp.val(p_params jsonb, p_excerpt text, p_verified boolean default true) returns jsonb
language sql as $$
  select jsonb_build_object('extraction', jsonb_build_object('found', true, 'params', p_params,
                              'article_ref', 'Synthetic Act Art. 1(a)', 'excerpt', p_excerpt),
                            'verified', p_verified, 'prompt_version', 'test.v1')
$$;

insert into ref.rule_candidates (id, source_id, article, proposed_rule_key, first_value, second_value, agree, decision) values
  ('70000000-0000-4000-8204-0000000000a1','60000000-0000-4000-8204-0000000000a1','Art. 1','TEST.T204.A',
   pg_temp.val('{"particular":"synthetic_a"}','Synthetic excerpt A one.'),
   pg_temp.val('{"particular":"synthetic_a"}','Synthetic excerpt A one.'), true, 'pending'),
  ('70000000-0000-4000-8204-0000000000a2','60000000-0000-4000-8204-0000000000a1','Art. 1','TEST.T204.A',
   pg_temp.val('{"particular":"synthetic_a2"}','Synthetic excerpt A two.'),
   pg_temp.val('{"particular":"synthetic_a2_other"}','Synthetic excerpt A two.'), false, 'needs_review'),
  ('70000000-0000-4000-8204-0000000000b1','60000000-0000-4000-8204-0000000000a1','Art. 2','TEST.T204.B',
   pg_temp.val('{"particular":"synthetic_b"}','Synthetic excerpt B one.'),
   pg_temp.val('{"particular":"synthetic_b"}','Synthetic excerpt B one.'), true, 'pending'),
  ('70000000-0000-4000-8204-0000000000b2','60000000-0000-4000-8204-0000000000a1','Art. 2','TEST.T204.B',
   pg_temp.val('{"particular":"synthetic_b"}','Synthetic excerpt B one, reworded.'),
   pg_temp.val('{"particular":"synthetic_b"}','Synthetic excerpt B one, reworded.'), true, 'pending'),
  ('70000000-0000-4000-8204-0000000000a3','60000000-0000-4000-8204-0000000000a1','Art. 1','TEST.T204.A',
   pg_temp.val('{"particular":"synthetic_a2_other"}','Synthetic excerpt A two, reworded.'),
   pg_temp.val('{"particular":"synthetic_a2_other"}','Synthetic excerpt A two, reworded.'), true, 'pending'),
  ('70000000-0000-4000-8204-0000000000d1','60000000-0000-4000-8204-0000000000a1','Art. 4','TEST.T204.D',
   pg_temp.val('{"particular":"synthetic_d"}','Synthetic excerpt D.'),
   pg_temp.val('{"particular":"synthetic_d"}','Synthetic excerpt D.'), true, 'pending'),
  ('70000000-0000-4000-8204-0000000000c1','60000000-0000-4000-8204-0000000000a1','Art. 3','TEST.T204.C',
   pg_temp.val('{"particular":"synthetic_c"}','Synthetic excerpt C.'), null, null, 'pending'),
  ('70000000-0000-4000-8204-0000000000c2','60000000-0000-4000-8204-0000000000a1','Art. 3','TEST.T204.C',
   pg_temp.val('{"particular":"synthetic_c"}','Synthetic excerpt C.', false),
   pg_temp.val('{"particular":"synthetic_c"}','Synthetic excerpt C.'), false, 'needs_review'),
  ('70000000-0000-4000-8204-0000000000c3','60000000-0000-4000-8204-0000000000a1','Art. 3','TEST.T204.C',
   pg_temp.val('{"particular":"synthetic_c"}','Synthetic excerpt C.'),
   pg_temp.val('{"particular":"synthetic_c"}','Synthetic excerpt C.'), true, 'pending');

insert into ref.term_entries (id, term_key, language, term, kind, article_ref, source_id) values
  ('80000000-0000-4000-8204-0000000000a1','test_t204_term','sv','syntetisk term','heading','Synthetic Act Art. 1',
   '60000000-0000-4000-8204-0000000000a1'),
  ('80000000-0000-4000-8204-0000000000a2','test_t204_term','de','synthetischer Begriff','heading','Synthetic Act Art. 1',
   '60000000-0000-4000-8204-0000000000a2'),
  ('80000000-0000-4000-8204-0000000000a3','test_t204_other','sv','annan term','heading','Synthetic Act Art. 2',
   '60000000-0000-4000-8204-0000000000a1');

-- ─── Grants ─────────────────────────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('anon', 'app.release_ruleset(text,text)', 'execute')
          and not has_function_privilege('anon', 'app.accept_candidate(uuid,text,text,text,text,text,jsonb,text,date,date)', 'execute')
          and has_function_privilege('authenticated', 'app.release_ruleset(text,text)', 'execute'),
          '[T-204] the staff RPCs are executable by authenticated users (staff checked inside) and never by anon');
select ok(not has_table_privilege('authenticated', 'ref.ruleset_drafts', 'select')
          and not has_table_privilege('authenticated', 'ref.ruleset_draft_members', 'select')
          and not has_table_privilege('authenticated', 'ref.ruleset_draft_coverage', 'select')
          and not has_table_privilege('authenticated', 'ref.fixture_runs', 'select')
          and not has_table_privilege('authenticated', 'ref.fixture_runs', 'insert')
          and not has_table_privilege('anon', 'ref.fixture_runs', 'select'),
          '[T-204] drafts and fixture runs are staff tooling: no client can read or write them');
select ok(not has_function_privilege('authenticated', 'private.open_draft(text)', 'execute')
          and not has_function_privilege('authenticated', 'private.coverage_supported(text,text,text)', 'execute')
          and not has_function_privilege('authenticated', 'private.ruleset_draft_digest(text)', 'execute'),
          '[T-204] the release helpers are not executable by clients');

-- ─── Not staff: refused before anything is read ─────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8204-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select app.accept_candidate('70000000-0000-4000-8204-0000000000a1', 'first', 'A', 'mandatory_particular',
                    'mandatory_particulars', 'EU', '{"all": []}', 'new_obligation')$$,
                 '42501', null, '[T-204] a member who is not staff cannot accept a candidate');
select throws_ok($$select app.release_ruleset('0000.00-empty')$$, '42501', null,
                 '[T-204] a member who is not staff cannot release a ruleset');
select throws_ok($$select app.decide_term('80000000-0000-4000-8204-0000000000a1', 'accept')$$, '42501', null,
                 '[T-204] a member who is not staff cannot decide a term');

-- ─── Staff: accepting a candidate takes values only from a verified extraction ─────────────────────
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8204-0000000000a1","role":"authenticated","app_metadata":{"nutrivo_staff":true}}', true);
select throws_ok($$select app.accept_candidate('70000000-0000-4000-8204-0000000000c1', 'first', 'C', 'mandatory_particular',
                    'mandatory_particulars', 'EU', '{"all": []}', 'new_obligation')$$,
                 '22023', null, '[T-204] a candidate whose second key has not run cannot be accepted');
select throws_ok($$select app.accept_candidate('70000000-0000-4000-8204-0000000000c2', 'first', 'C', 'mandatory_particular',
                    'mandatory_particulars', 'EU', '{"all": []}', 'new_obligation')$$,
                 '22023', null, '[T-204] an extraction that is not verbatim in the source cannot be accepted');
select throws_ok($$select app.accept_candidate('70000000-0000-4000-8204-0000000000c3', 'first', 'C', 'mandatory_particular',
                    'mandatory_particulars', 'EU', '{"eq": ["colour", "red"]}', 'new_obligation')$$,
                 '22023', null, '[T-204] applicability outside the predicate language is refused');
select throws_ok($$select app.accept_candidate('70000000-0000-4000-8204-0000000000c3', 'first', 'C', 'mandatory_particular',
                    'mandatory_particulars', 'EU', '{"all": []}', null)$$,
                 '22023', null, '[T-204] a version without a typed effect is refused');
select is(app.accept_candidate('70000000-0000-4000-8204-0000000000a1', 'first', 'Synthetic A', 'mandatory_particular',
            'mandatory_particulars', 'EU', '{"all": [{"eq": ["species", "dog"]}]}', 'new_obligation'),
          '{"rule_key": "TEST.T204.A", "version": 1, "supersedes_version": null}'::jsonb,
          '[J02.main] staff accept a candidate: the first version of a new rule');
select lives_ok($$select app.accept_candidate('70000000-0000-4000-8204-0000000000b1', 'first', 'Synthetic B',
                    'mandatory_particular', 'mandatory_particulars', 'EU', '{"all": []}', 'new_obligation')$$,
                '[J02.main] a second rule is accepted');
select throws_ok($$select app.accept_candidate('70000000-0000-4000-8204-0000000000a1', 'first', 'Synthetic A',
                    'mandatory_particular', 'mandatory_particulars', 'EU', '{"all": []}', 'new_obligation')$$,
                 '22023', null, '[J02.must.1] an accepted candidate cannot be accepted again');
select throws_ok($$select app.accept_candidate('70000000-0000-4000-8204-0000000000a2', 'first', null, 'threshold',
                    null, null, '{"all": []}', 'tightened_threshold')$$,
                 '22023', null, '[J02.must.1] a rule keeps its shape across versions: a new shape needs a new key');
select throws_ok($$select app.accept_candidate('70000000-0000-4000-8204-0000000000d1', 'first', 'D', 'mandatory_particular',
                    'mandatory_particulars', 'EU', '{"all": []}', 'editorial')$$,
                 '22023', null, '[J02.must.2] a rule''s first version cannot be typed editorial, so it always reaches alerts');
select lives_ok($$select app.reject_candidate('70000000-0000-4000-8204-0000000000c3', 'synthetic: wrong article')$$,
                '[T-204] staff reject a candidate');
reset role;

select ok((select rv.status = 'accepted' and rv.params = '{"particular":"synthetic_a"}'
                  and rv.source_excerpt = 'Synthetic excerpt A one.' and rv.article_ref = 'Synthetic Act Art. 1(a)'
                  and rv.source_id = '60000000-0000-4000-8204-0000000000a1'
                  and rv.accepted_by = '10000000-0000-4000-8204-0000000000a1' and rv.extraction_a is not null
                  and rv.extraction_b is not null and rv.effect_type = 'new_obligation'
           from ref.rule_versions rv where rv.rule_key = 'TEST.T204.A' and rv.version = 1),
          '[J02.main] the version holds the extraction''s params, article and excerpt, both keys, and the accepting person');
select is((select decision || '/' || (decided_by = '10000000-0000-4000-8204-0000000000a1')::text
           from ref.rule_candidates where id = '70000000-0000-4000-8204-0000000000a1'), 'accepted/true',
          '[J02.main] the candidate records the decision and who made it');
select is((select decision from ref.rule_candidates where id = '70000000-0000-4000-8204-0000000000c3'), 'rejected',
          '[T-204] the rejected candidate is decided and writes no rule');
select is((select count(*)::int from app.audit_events where kind = 'rule_version.accepted'
           and actor_id = '10000000-0000-4000-8204-0000000000a1'), 2,
          '[T-204] each acceptance is audited with the staff actor');

-- ─── K05: a draft, coverage edits and the fixture gate ──────────────────────────────────────────
set local role authenticated;
select lives_ok($$select app.create_ruleset_draft('2026.90-a', 'synthetic first release')$$,
                '[K05.main] staff start a draft from the latest release');
select lives_ok($$select app.set_draft_member('2026.90-a', 'TEST.T204.A', 1)$$, '[K05.main] a member is added');
select lives_ok($$select app.set_draft_member('2026.90-a', 'TEST.T204.B', 1)$$, '[K05.main] a second member is added');
select throws_ok($$select app.set_draft_member('2026.90-a', 'TEST.T204.C', 1)$$, 'P0038', null,
                 '[K05.main] a version that does not exist cannot join');
select throws_ok($$select app.set_draft_coverage('2026.90-a', 'EU-SE', 'mandatory_particulars', 'complete')$$,
                 'P0010', null, '[T-204] BE-10: complete is refused while the domain''s rules have no fixtures');
select throws_ok($$select app.release_ruleset('2026.90-a')$$, 'P0039', null,
                 '[K05.must.1] no release while a member has no fixtures');
reset role;

insert into ref.rule_fixtures (rule_key, version, name, input, expected_outcome) values
  ('TEST.T204.A', 1, 'synthetic passed', '{"panel":"synthetic"}', 'passed'),
  ('TEST.T204.B', 1, 'synthetic passed', '{"panel":"synthetic"}', 'passed');
set local role authenticated;
select throws_ok($$select app.release_ruleset('2026.90-a')$$, 'P0039', null,
                 '[K05.must.1] no release while a member lacks failed and withheld fixtures');
reset role;
insert into ref.rule_fixtures (rule_key, version, name, input, expected_outcome)
select k, 1, 'synthetic ' || o, '{"panel":"synthetic"}', o
from unnest(array['TEST.T204.A','TEST.T204.B']) k cross join unnest(array['failed','withheld']) o;

set local role authenticated;
select throws_ok($$select app.release_ruleset('2026.90-a')$$, 'P0039', null,
                 '[K05.must.1] no release before a fixture run is recorded');
reset role;
insert into ref.fixture_runs (draft_id, digest, passed, rule_fixtures_ran, runner)
values ('2026.90-a', private.ruleset_draft_digest('2026.90-a'), false, private.ruleset_draft_fixture_count('2026.90-a'), 'test');
set local role authenticated;
select throws_ok($$select app.release_ruleset('2026.90-a')$$, 'P0039', null,
                 '[K05.must.1] no release when the latest fixture run failed');
reset role;
select throws_ok($$insert into ref.fixture_runs (draft_id, digest, passed, rule_fixtures_ran, runner)
                   values ('2026.90-a', private.ruleset_draft_digest('2026.90-a'), true, 0, 'test')$$,
                 '23514', null, '[K05.must.1] a run that judged no fixture can never be recorded as passed');
insert into ref.fixture_runs (draft_id, digest, passed, rule_fixtures_ran, runner)
values ('2026.90-a', private.ruleset_draft_digest('2026.90-a'), true, private.ruleset_draft_fixture_count('2026.90-a') - 1, 'test');
set local role authenticated;
select throws_ok($$select app.release_ruleset('2026.90-a')$$, 'P0039', null,
                 '[K05.must.1] a passing run that judged only some of the fixtures is not enough');
reset role;
insert into ref.fixture_runs (draft_id, digest, passed, rule_fixtures_ran, runner)
values ('2026.90-a', private.ruleset_draft_digest('2026.90-a'), true, private.ruleset_draft_fixture_count('2026.90-a'), 'test');
insert into ref.rule_fixtures (rule_key, version, name, input, expected_outcome)
values ('TEST.T204.A', 1, 'synthetic withheld, unreadable', '{"panel":"unreadable"}', 'withheld');
set local role authenticated;
select throws_ok($$select app.release_ruleset('2026.90-a')$$, 'P0039', null,
                 '[K05.must.1] a passing run is stale once a fixture changes after it');
reset role;
insert into ref.fixture_runs (draft_id, digest, passed, rule_fixtures_ran, runner)
values ('2026.90-a', private.ruleset_draft_digest('2026.90-a'), true, private.ruleset_draft_fixture_count('2026.90-a'), 'test');
insert into ref.fixture_runs (draft_id, digest, passed, rule_fixtures_ran, runner, ran_at)
values ('2026.90-a', private.ruleset_draft_digest('2026.90-a'), false, private.ruleset_draft_fixture_count('2026.90-a'), 'test',
        now() - interval '1 day');
set local role authenticated;
select throws_ok($$select app.release_ruleset('2026.90-a')$$, 'P0039', null,
                 '[K05.must.1] the latest run is the last recorded, whatever time it claims: a back-dated failure blocks');
reset role;
insert into ref.fixture_runs (draft_id, digest, passed, rule_fixtures_ran, runner)
values ('2026.90-a', private.ruleset_draft_digest('2026.90-a'), true, private.ruleset_draft_fixture_count('2026.90-a'), 'test');
select throws_ok($$update ref.fixture_runs set passed = true$$, 'P0005', null,
                 '[K05.must.1] fixture runs are insert-only');

set local role authenticated;
select lives_ok($$select app.set_draft_coverage('2026.90-a', 'EU-SE', 'mandatory_particulars', 'complete',
                    null, '2026-10-26')$$,
                '[K05.main] complete coverage once the domain''s members are accepted and tested');
select throws_ok($$select app.set_draft_coverage('2026.90-a', 'EU', 'mandatory_particulars', 'complete')$$, '22023', null,
                 '[T-204] BE-21: coverage rows are never added, so a region cannot be made complete on its own');
select throws_ok($$select app.set_draft_coverage('2026.90-a', 'EU-SE', 'composition', 'complete')$$, 'P0010', null,
                 '[T-204] BE-10: complete is refused where no member covers the domain');
select throws_ok($$select app.set_draft_coverage('2026.90-a', 'EU-SE', 'language', 'partial', null, null,
                    'GAP-EU-DE-LANGUAGE')$$, '22023', null,
                 '[T-204] a gap from another node cannot explain this node''s coverage');
select lives_ok($$select app.open_coverage_gap('GAP-TEST-T204-EU-SE-LANGUAGE', 'EU-SE', 'language', 'partially_encoded',
                    'Synthetic: the language layer is partly encoded.')$$, '[K05.main] staff open a typed gap');
select lives_ok($$select app.set_draft_coverage('2026.90-a', 'EU-SE', 'language', 'partial', null, null,
                    'GAP-TEST-T204-EU-SE-LANGUAGE')$$, '[K05.main] partial coverage carries the new gap');
select is(app.release_ruleset('2026.90-a') -> 'ruleset_version', '"2026.90-a"'::jsonb,
          '[K05.main] staff release the draft once every member is accepted and its fixtures pass');
select throws_ok($$select app.set_draft_member('2026.90-a', 'TEST.T204.B', null)$$, '22023', null,
                 '[K05.main] a released ruleset is immutable: its draft can no longer change');
select throws_ok($$select app.release_ruleset('2026.90-a')$$, '22023', null,
                 '[K05.main] a ruleset is released once');
reset role;

select ok((select released_by = '10000000-0000-4000-8204-0000000000a1' from ref.ruleset_versions where id = '2026.90-a')
          and (select array_agg(rule_key || ':' || version order by rule_key) from ref.ruleset_members
               where ruleset_version = '2026.90-a') = '{TEST.T204.A:1,TEST.T204.B:1}',
          '[K05.main] the release pins exactly one accepted version of each member');
select is((select count(*)::int from ref.coverage_nodes where ruleset_version = '2026.90-a'),
          (select count(*)::int from ref.coverage_nodes where ruleset_version = '0000.00-empty'),
          '[K05.main] the release carries coverage for every node and domain');
select is((select state || '/' || rules_encoded || '/' || coalesce(gap_id, '-') from ref.coverage_nodes
           where ruleset_version = '2026.90-a' and node_id = 'EU-SE' and domain = 'mandatory_particulars'),
          'complete/2/-', '[K05.main] complete coverage counts the rules held on the node''s region');
select is((select opened_in || '/' || coalesce(closed_in, '-') from ref.coverage_gaps
           where gap_id = 'GAP-TEST-T204-EU-SE-LANGUAGE'), '2026.90-a/-',
          '[K05.main] a newly referenced gap opens in the release');
select is((select string_agg(gap_id || '=' || coalesce(closed_in, '-'), ',' order by gap_id) from ref.coverage_gaps
           where gap_id in ('GAP-EU-SE-MANDATORY_PARTICULARS','GAP-EU-SE-LANGUAGE','GAP-EU-DE-LANGUAGE')),
          'GAP-EU-DE-LANGUAGE=-,GAP-EU-SE-LANGUAGE=2026.90-a,GAP-EU-SE-MANDATORY_PARTICULARS=2026.90-a',
          '[K05.main] gaps no longer referenced close in the release; the rest stay open');
select is(public.coverage_snapshot() ->> 'ruleset_version', '2026.90-a',
          '[K05.main] the public coverage snapshot reads the new release');
select ok((select after ->> 'fixture_run_id' is not null and ruleset_version = '2026.90-a'
                  and actor_id = '10000000-0000-4000-8204-0000000000a1'
           from app.audit_events where kind = 'ruleset.released' and object_id = '2026.90-a'),
          '[K05.main] the release is audited with the fixture run it relied on');

-- ─── J02: a change is a new version that supersedes the previous one; the release types the diff ───
set local role authenticated;
select is(app.accept_candidate('70000000-0000-4000-8204-0000000000a2', 'second', null, null, null, null,
            '{"all": [{"eq": ["species", "dog"]}]}', 'tightened_threshold', '2027-01-01', '2027-06-30'),
          '{"rule_key": "TEST.T204.A", "version": 2, "supersedes_version": 1}'::jsonb,
          '[J02.main] accepting a change writes version 2 superseding version 1');
select lives_ok($$select app.accept_candidate('70000000-0000-4000-8204-0000000000a3', 'first', null, null, null, null,
                    '{"all": [{"eq": ["species", "dog"]}]}', 'editorial')$$,
                '[J02.must.2] a later editorial version of the same rule is accepted as version 3');
select lives_ok($$select app.accept_candidate('70000000-0000-4000-8204-0000000000b2', 'first', null, null, null, null,
                    '{"all": []}', 'editorial')$$, '[J02.must.2] an editorial change is accepted as a new version');
reset role;
select throws_ok($$update ref.rule_versions set params = '{"particular":"changed"}'
                   where rule_key = 'TEST.T204.A' and version = 1$$, 'P0008', null,
                 '[J02.must.1] an accepted version cannot be edited');
select throws_ok($$delete from ref.rule_versions where rule_key = 'TEST.T204.A' and version = 1$$, 'P0008', null,
                 '[J02.must.1] an accepted version cannot be deleted');
select is((select params::text || ' ' || status from ref.rule_versions where rule_key = 'TEST.T204.A' and version = 1),
          '{"particular": "synthetic_a"} accepted', '[J02.must.1] version 1 is unchanged after the change was accepted');

set local role authenticated;
select app.create_ruleset_draft('2026.90-b');
select app.set_draft_member('2026.90-b', 'TEST.T204.A', 3);
select app.set_draft_member('2026.90-b', 'TEST.T204.B', 2);
reset role;
insert into ref.rule_fixtures (rule_key, version, name, input, expected_outcome)
select k, v, 'synthetic ' || o, '{"panel":"synthetic"}', o
from (values ('TEST.T204.A', 3), ('TEST.T204.B', 2)) as m(k, v) cross join unnest(array['passed','failed','withheld']) o;
insert into ref.fixture_runs (draft_id, digest, passed, rule_fixtures_ran, runner)
values ('2026.90-b', private.ruleset_draft_digest('2026.90-b'), true, private.ruleset_draft_fixture_count('2026.90-b'), 'test');
set local role authenticated;
select lives_ok($$select app.release_ruleset('2026.90-b')$$, '[J02.main] the second release passes its fixture gate');
reset role;

select is((select from_version || '>' || to_version || ' ' || effect_type || ' ' || effective_from || ' ' || sell_through_until
           from ref.rule_diffs where ruleset_version = '2026.90-b' and rule_key = 'TEST.T204.A' and to_version = 2),
          '1>2 tightened_threshold 2027-01-01 2027-06-30',
          '[J02.main] the release writes a diff typed by effect with effective_from and sell_through_until');
select is((select string_agg(from_version || '>' || to_version || ' ' || effect_type, ', ' order by to_version)
           from ref.rule_diffs where ruleset_version = '2026.90-b' and rule_key = 'TEST.T204.A'),
          '1>2 tightened_threshold, 2>3 editorial',
          '[J02.main] a version stepped over keeps its own typed diff, so a later editorial one cannot hide it');
select is((select coalesce(from_version::text, '-') || '>' || to_version || ' ' || effect_type
           from ref.rule_diffs where ruleset_version = '2026.90-a' and rule_key = 'TEST.T204.A'),
          '->1 new_obligation', '[J02.main] a rule''s first release is a diff from no version');
select is((select count(*)::int from app.jobs j join ref.rule_diffs d on d.id = (j.payload ->> 'rule_diff_id')::uuid
           where j.kind = 'diff_fanout' and d.ruleset_version = '2026.90-b' and d.effect_type <> 'editorial'), 1,
          '[J02.must.2] a non-editorial diff queues one diff_fanout job');
select is((select count(*)::int from app.jobs j join ref.rule_diffs d on d.id = (j.payload ->> 'rule_diff_id')::uuid
           where j.kind = 'diff_fanout' and d.effect_type = 'editorial')
          + (select count(*)::int from app.alerts a join ref.rule_diffs d on d.id = a.rule_diff_id
             where d.effect_type = 'editorial'), 0,
          '[J02.must.2] an editorial diff queues no fan-out and creates no alert');

-- ─── Dropping a member is not decided yet (#34): refused rather than typed by guess ───────────────
set local role authenticated;
select app.create_ruleset_draft('2026.90-c');
select throws_ok($$select app.set_draft_member('2026.90-c', 'TEST.T204.A', 1)$$, '22023', null,
                 '[T-204] going back to an earlier version is refused until its effect is decided');
select app.set_draft_member('2026.90-c', 'TEST.T204.B', null);
reset role;
insert into ref.fixture_runs (draft_id, digest, passed, rule_fixtures_ran, runner)
values ('2026.90-c', private.ruleset_draft_digest('2026.90-c'), true, private.ruleset_draft_fixture_count('2026.90-c'), 'test');
set local role authenticated;
select throws_ok($$select app.release_ruleset('2026.90-c')$$, '22023', null,
                 '[T-204] a release that drops a previous member is refused until its effect is decided');

-- ─── K03: term decisions, BE-11 ────────────────────────────────────────────────────────────────
select throws_ok($$select app.decide_term('80000000-0000-4000-8204-0000000000a2', 'accept')$$, '22023', null,
                 '[T-204] BE-11: a German term from an English text is never accepted');
select throws_ok($$select app.decide_term('80000000-0000-4000-8204-0000000000a3', 'amend')$$, '22023', null,
                 '[T-204] amend is not offered until it is defined');
select lives_ok($$select app.decide_term('80000000-0000-4000-8204-0000000000a1', 'accept', 'checked against the text')$$,
                '[T-204] staff accept a term from its own language''s stored text');
reset role;
select is((select t.status || '/' || d.decision || '/' || (d.decided_by = '10000000-0000-4000-8204-0000000000a1')::text
           from ref.term_entries t join ref.term_decisions d on d.term_entry_id = t.id
           where t.id = '80000000-0000-4000-8204-0000000000a1'), 'accepted/accept/true',
          '[T-204] the decision is recorded and the entry accepted');

select * from finish();
rollback;
