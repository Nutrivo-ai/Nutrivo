-- #197 (#8 DB-3) · A released ruleset's coverage, members and the rule metadata they depend on are sealed.
-- The seal is written when the releasing transaction commits. Inside this rolled-back test, `set constraints
-- ref.ruleset_seal immediate` fires the pending seal where a commit would, and `deferred` restores the default for
-- the next release. Everything is synthetic (TEST.T197.* rules, GAP-TEST-T197-* gaps): no regulatory content.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(40);
set local client_min_messages = warning;

create function pg_temp.seal_now() returns void language sql as $$
  set constraints ref.ruleset_seal immediate;
  set constraints ref.ruleset_seal deferred;
$$;

-- ─── Staff (Sam), one accepted and tested synthetic rule ────────────────────────────────────────────
insert into auth.users (id, email) values ('00000000-0000-4000-8197-0000000000a1','sam@staff.test');
insert into app.people (id, user_id, display_name, email) values
  ('10000000-0000-4000-8197-0000000000a1','00000000-0000-4000-8197-0000000000a1','sam','sam@staff.test');
insert into ref.rules (rule_key, shape, domain, node_id, title) values
  ('TEST.T197.A','mandatory_particular','mandatory_particulars','EU','Synthetic sealed rule'),
  ('TEST.T197.LOOSE','mandatory_particular','composition','EU','Synthetic rule in no release');
insert into ref.rule_versions (rule_key, version, status, params, article_ref, source_excerpt, effect_type,
                               accepted_by, accepted_at) values
  ('TEST.T197.A', 1, 'accepted', '{"particular":"synthetic"}', 'Synthetic Act Art. 1', 'Synthetic excerpt.',
   'new_obligation', '10000000-0000-4000-8197-0000000000a1', now());
insert into ref.rule_fixtures (rule_key, version, name, input, expected_outcome)
select 'TEST.T197.A', 1, 'synthetic ' || o, '{"panel":"synthetic"}', o from unnest(array['passed','failed','withheld']) o;

select ok(not has_table_privilege('authenticated', 'ref.ruleset_seals', 'select')
          and not has_table_privilege('service_role', 'ref.ruleset_seals', 'insert')
          and not has_table_privilege('anon', 'ref.ruleset_seals', 'select'),
          '[#197 DB-3] seals are written only by the release trigger: no client inserts or reads them');
select ok((select bool_and(private.ruleset_sealed(rv.id)) from ref.ruleset_versions rv),
          '[#197 DB-3] every ruleset released before the seal migration is sealed');

-- ─── K05: a draft still edits, and the release still works ─────────────────────────────────────────
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8197-0000000000a1","role":"authenticated","app_metadata":{"nutrivo_staff":true}}', true);
set local role authenticated;
select lives_ok($$select app.create_ruleset_draft('2026.97-a', 'synthetic sealed release')$$,
                '[#197 DB-3] staff start a draft from the sealed latest release');
select lives_ok($$select app.set_draft_member('2026.97-a', 'TEST.T197.A', 1)$$, '[#197 DB-3] a draft still takes members');
select lives_ok($$select app.set_draft_coverage('2026.97-a', 'EU-SE', 'mandatory_particulars', 'complete', null,
                    '2026-11-05')$$, '[#197 DB-3] a draft''s coverage still edits');
select lives_ok($$select app.open_coverage_gap('GAP-TEST-T197-A', 'EU-SE', 'language', 'partially_encoded',
                    'Synthetic: partly encoded.')$$, '[#197 DB-3] staff still open a gap');
select lives_ok($$select app.set_draft_coverage('2026.97-a', 'EU-SE', 'language', 'partial', null, null,
                    'GAP-TEST-T197-A')$$, '[#197 DB-3] a draft''s coverage still carries a new gap');
reset role;
insert into ref.fixture_runs (draft_id, digest, passed, rule_fixtures_ran, runner)
values ('2026.97-a', private.ruleset_draft_digest('2026.97-a'), true, private.ruleset_draft_fixture_count('2026.97-a'), 'test');
set local role authenticated;
select is(app.release_ruleset('2026.97-a') -> 'ruleset_version', '"2026.97-a"'::jsonb,
          '[#197 DB-3] the K05 release still works with the seal in place');
reset role;
select ok(not private.ruleset_sealed('2026.97-a'),
          '[#197 DB-3] the seal is written last: not before the releasing transaction ends');
select pg_temp.seal_now();
select ok(private.ruleset_sealed('2026.97-a'), '[#197 DB-3] the release is sealed when its transaction commits');

-- ─── Refused: coverage of a sealed release ───────────────────────────────────────────────────────
select throws_ok($$update ref.coverage_nodes set state = 'complete', gap_id = null
                   where ruleset_version = '2026.97-a' and node_id = 'EU-SE' and domain = 'language'$$,
                 'P0047', null, '[#197 DB-3] a released coverage row cannot be updated');
select throws_ok($$update ref.coverage_nodes set rules_encoded = 9 where ruleset_version = '0000.00-empty'$$,
                 'P0047', null, '[#197 DB-3] the baseline release''s coverage cannot be updated');
select throws_ok($$delete from ref.coverage_nodes where ruleset_version = '2026.97-a' and node_id = 'EU-SE'
                   and domain = 'language'$$,
                 'P0047', null, '[#197 DB-3] a released coverage row cannot be deleted');
select throws_ok($$insert into ref.coverage_nodes (ruleset_version, node_id, domain, state, rules_encoded)
                   values ('2026.97-a', 'EU', 'composition', 'complete', 1)$$,
                 'P0047', null, '[#197 DB-3] no coverage row can be added to a released ruleset afterwards');
select throws_ok($$truncate ref.coverage_nodes$$, 'P0047', null, '[#197 DB-3] released coverage cannot be truncated');

-- ─── Refused: memberships and the rule metadata members depend on ────────────────────────────────────
select throws_ok($$insert into ref.ruleset_members (ruleset_version, rule_key, version)
                   values ('0000.00-empty', 'TEST.T197.A', 1)$$,
                 'P0047', null, '[#197 DB-3] no member can be added to a released ruleset afterwards');
select throws_ok($$delete from ref.ruleset_members where ruleset_version = '2026.97-a'$$,
                 'P0005', null, '[#197 DB-3] a released membership still cannot be deleted');
select throws_ok($$update ref.rules set domain = 'composition' where rule_key = 'TEST.T197.A'$$,
                 'P0047', null, '[#197 DB-3] a released member''s domain cannot change');
select throws_ok($$update ref.rules set node_id = 'EU-SE' where rule_key = 'TEST.T197.A'$$,
                 'P0047', null, '[#197 DB-3] a released member''s node cannot change');
select throws_ok($$update ref.rules set title = 'Retitled' where rule_key = 'TEST.T197.A'$$,
                 'P0047', null, '[#197 DB-3] a released member''s title cannot change');
select throws_ok($$delete from ref.rules where rule_key = 'TEST.T197.A'$$,
                 'P0047', null, '[#197 DB-3] a released member''s rule cannot be deleted');
select throws_ok($$update ref.rule_versions set params = '{"particular":"changed"}'
                   where rule_key = 'TEST.T197.A' and version = 1$$,
                 'P0008', null, '[#197 DB-3] a released member''s version stays permanent');
select throws_ok($$truncate ref.rule_versions cascade$$, 'P0047', null,
                 '[#197 DB-3] versions that a released ruleset pins cannot be truncated');
-- Prove the other TRUNCATE guards: switch off (in this rolled-back transaction only) the insert-only guards the
-- cascade would hit first.
alter table ref.ruleset_members disable trigger insert_only_truncate;
alter table app.supersessions disable trigger insert_only_truncate;
alter table ref.rule_versions disable trigger ruleset_seal_truncate;
select throws_ok($$truncate ref.rules cascade$$, 'P0047', null,
                 '[#197 DB-3] rules that a released ruleset pins cannot be truncated');
alter table ref.rule_versions enable trigger ruleset_seal_truncate;
alter table app.supersessions enable trigger insert_only_truncate;
alter table ref.ruleset_members enable trigger insert_only_truncate;
alter table ref.coverage_nodes disable trigger ruleset_seal_truncate;
select throws_ok($$truncate ref.coverage_gaps cascade$$, 'P0047', null,
                 '[#197 DB-3] gaps that released coverage names cannot be truncated');
alter table ref.coverage_nodes enable trigger ruleset_seal_truncate;
select lives_ok($$update ref.rules set title = 'Retitled, unreleased' where rule_key = 'TEST.T197.LOOSE'$$,
                '[#197 DB-3] a rule no release pins can still be edited');

-- ─── Gaps named by sealed coverage: fixed meaning, bookkeeping only by the release in progress ──────────
select throws_ok($$update ref.coverage_gaps set reason_code = 'out_of_scope' where gap_id = 'GAP-TEST-T197-A'$$,
                 'P0047', null, '[#197 DB-3] a released gap''s reason cannot change');
select throws_ok($$delete from ref.coverage_gaps where gap_id = 'GAP-TEST-T197-A'$$,
                 'P0047', null, '[#197 DB-3] a released gap cannot be deleted');
select throws_ok($$update ref.coverage_gaps set closed_in = '2026.97-a' where gap_id = 'GAP-TEST-T197-A'$$,
                 'P0047', null, '[#197 DB-3] a released gap cannot be closed in a release that is already sealed');
select throws_ok($$update ref.coverage_gaps set opened_in = '0000.00-empty' where gap_id = 'GAP-TEST-T197-A'$$,
                 'P0047', null, '[#197 DB-3] a released gap''s opened_in cannot be rewritten');

set local role service_role;
insert into ref.ruleset_versions (id, notes) values ('T197-FORGED', 'synthetic: not a K05 release');
select throws_ok($$update ref.coverage_gaps set closed_in = 'T197-FORGED' where gap_id = 'GAP-TEST-T197-A'$$,
                 '42501', null, '[#197 DB-3] the service role cannot pass its own ruleset off as the release in progress');
select lives_ok($$update ref.coverage_gaps set description = 'Synthetic: reworded.' where gap_id = 'GAP-TEST-T197-A'$$,
                '[#197 DB-3] the service role can still reword a gap''s description');
reset role;

-- ─── A second release after the seal: draft edits, and it closes the sealed release's gap ────────────
set local role authenticated;
select lives_ok($$select app.create_ruleset_draft('2026.97-b', 'synthetic next release')$$,
                '[#197 DB-3] changes go into the next draft');
select lives_ok($$select app.open_coverage_gap('GAP-TEST-T197-B', 'EU-SE', 'language', 'not_encoded',
                    'Synthetic: not encoded after all.')$$, '[#197 DB-3] the next draft opens its own gap');
select lives_ok($$select app.set_draft_coverage('2026.97-b', 'EU-SE', 'language', 'not_encoded', null, null,
                    'GAP-TEST-T197-B')$$, '[#197 DB-3] the next draft changes what the sealed release said');
reset role;
insert into ref.fixture_runs (draft_id, digest, passed, rule_fixtures_ran, runner)
values ('2026.97-b', private.ruleset_draft_digest('2026.97-b'), true, private.ruleset_draft_fixture_count('2026.97-b'), 'test');
set local role authenticated;
select lives_ok($$select app.release_ruleset('2026.97-b')$$,
                '[#197 DB-3] a release after a sealed one still works, gap bookkeeping included');
reset role;
select is((select opened_in || '/' || coalesce(closed_in, '-') from ref.coverage_gaps where gap_id = 'GAP-TEST-T197-A'),
          '2026.97-a/2026.97-b', '[#197 DB-3] the release in progress closes the gap the sealed release named');
select ok((select state = 'partial' and gap_id = 'GAP-TEST-T197-A' from ref.coverage_nodes
           where ruleset_version = '2026.97-a' and node_id = 'EU-SE' and domain = 'language'),
          '[#197 DB-3] the sealed release still says what it said when it was released');

-- ─── A check pinned to a sealed ruleset still evaluates ───────────────────────────────────────────
insert into app.workspaces (id, name) values ('20000000-0000-4000-8197-00000000000a','Workspace T197');
insert into app.families (id, workspace_id, name) values
  ('30000000-0000-4000-8197-00000000000a','20000000-0000-4000-8197-00000000000a','Family T197');
insert into app.products (id, workspace_id, family_id, name) values
  ('40000000-0000-4000-8197-00000000000a','20000000-0000-4000-8197-00000000000a','30000000-0000-4000-8197-00000000000a','Product T197');
insert into ref.ruleset_versions (id, notes) values ('T197-PINNED', 'synthetic pgTAP fixture (#197), rolled back');
insert into ref.coverage_nodes (ruleset_version, node_id, domain, state, rules_encoded)
select 'T197-PINNED', 'EU-DK', d, 'complete', 1
from unnest(array['mandatory_particulars','composition','claims_wording','type_geometry','language','registration']) d;
select pg_temp.seal_now();
select lives_ok($$insert into app.checks (workspace_id, product_id, node_id, ruleset_version, label_state,
                                        applied_rule_keys, passed_rule_keys)
                  values ('20000000-0000-4000-8197-00000000000a','40000000-0000-4000-8197-00000000000a',
                          'EU-DK','T197-PINNED','clear','{R}','{R}')$$,
                '[#197 DB-3] a check pinned to a sealed, fully encoded ruleset still evaluates to clear');
select throws_ok($$insert into app.checks (workspace_id, product_id, node_id, ruleset_version, label_state,
                                         applied_rule_keys, passed_rule_keys)
                   values ('20000000-0000-4000-8197-00000000000a','40000000-0000-4000-8197-00000000000a',
                           'EU-SE','T197-PINNED','clear','{R}','{R}')$$,
                 'P0021', null, '[#197 DB-3] a check pinned to a sealed ruleset is still no rule, no verdict elsewhere');

select * from finish();
rollback;
