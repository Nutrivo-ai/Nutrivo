-- T-209 · Rule-to-term links (D-31): the accepting person links a rule to accepted register terms; an extraction
-- never does; a re-link is a new editorial version; complete coverage needs every linked term in every node language
-- (P0048); the draft digest covers the linked terms.
-- Everything here is synthetic (TEST.T209.* rules, a synthetic act, test_t209_* terms): no regulatory content.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(28);
set local client_min_messages = warning;

-- ─── Staff (Sam) and a non-staff person (Nina) ──────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-4000-8209-0000000000a1','sam@staff.test'), ('00000000-0000-4000-8209-0000000000b1','nina@n.test');
insert into app.people (id, user_id, display_name, email) values
  ('10000000-0000-4000-8209-0000000000a1','00000000-0000-4000-8209-0000000000a1','sam','sam@staff.test'),
  ('10000000-0000-4000-8209-0000000000b1','00000000-0000-4000-8209-0000000000b1','nina','nina@n.test');
insert into ref.sources (id, kind, celex, title, url, language, licence, sha256, storage_path) values
  ('60000000-0000-4000-8209-0000000000a1','eurlex','TEST-T209','Synthetic act (Swedish)','https://example.test/sv','sv',
   'eu_reuse','aa','eurlex/TEST-T209/sv/aa.xhtml');
create function pg_temp.val(p_params jsonb) returns jsonb language sql as $$
  select jsonb_build_object('extraction', jsonb_build_object('found', true, 'params', p_params,
                              'article_ref', 'Synthetic Act Art. 9', 'excerpt', 'Synthetic excerpt.'),
                            'verified', true, 'prompt_version', 'test.v1')
$$;
insert into ref.rule_candidates (id, source_id, article, proposed_rule_key, first_value, second_value, agree, decision)
values
  ('70000000-0000-4000-8209-0000000000a1','60000000-0000-4000-8209-0000000000a1','Art. 9','TEST.T209.MP',
   pg_temp.val('{"particular":"synthetic batch","conditions":[]}'),
   pg_temp.val('{"particular":"synthetic batch","conditions":[]}'), true, 'pending'),
  ('70000000-0000-4000-8209-0000000000a2','60000000-0000-4000-8209-0000000000a1','Art. 9','TEST.T209.LINKED',
   pg_temp.val('{"particular":"synthetic","detect":{"term_keys":["test_t209_batch"]}}'),
   pg_temp.val('{"particular":"synthetic","detect":{"term_keys":["test_t209_batch"]}}'), true, 'pending'),
  ('70000000-0000-4000-8209-0000000000a3','60000000-0000-4000-8209-0000000000a1','Art. 9','TEST.T209.PW',
   pg_temp.val('{"wordings":["synthetic designation"],"alternatives":[]}'),
   pg_temp.val('{"wordings":["synthetic designation"],"alternatives":[]}'), true, 'pending');
insert into ref.term_entries (id, term_key, language, term, kind, article_ref, source_id, status) values
  ('80000000-0000-4000-8209-0000000000a1','test_t209_batch','sv','syntetiskt parti','heading','Synthetic Act Art. 9',
   '60000000-0000-4000-8209-0000000000a1','accepted'),
  ('80000000-0000-4000-8209-0000000000a2','test_t209_desig','sv','syntetisk benämning','prescribed_designation',
   'Synthetic Act Art. 9','60000000-0000-4000-8209-0000000000a1','accepted'),
  ('80000000-0000-4000-8209-0000000000a3','test_t209_pending','sv','väntande','heading','Synthetic Act Art. 9',
   '60000000-0000-4000-8209-0000000000a1','candidate');

-- ─── Grants ─────────────────────────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('anon', 'app.relink_rule(text,jsonb,text)', 'execute')
          and has_function_privilege('authenticated', 'app.relink_rule(text,jsonb,text)', 'execute')
          and not has_function_privilege('anon',
                'app.accept_candidate(uuid,text,text,text,text,text,jsonb,text,date,date,jsonb)', 'execute'),
          '[T-209] relink_rule and accept_candidate run for authenticated users (staff checked inside), never anon');
select ok(not has_function_privilege('authenticated', 'private.check_term_links(text,jsonb)', 'execute')
          and not has_function_privilege('authenticated', 'private.coverage_terms_missing(text,text,text)', 'execute')
          and not has_function_privilege('anon', 'private.linked_term_keys(jsonb)', 'execute'),
          '[T-209] the link helpers are never granted to clients');

-- ─── Not staff ──────────────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8209-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select app.relink_rule('TEST.T209.MP', '{"detect":{"term_keys":["test_t209_batch"]}}')$$,
                 '42501', null, '[T-209] a person who is not staff cannot re-link a rule');
reset role;

-- ─── Accepting with links ───────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8209-0000000000a1","role":"authenticated","app_metadata":{"nutrivo_staff":true}}', true);
set local role authenticated;
select throws_ok($$select app.accept_candidate('70000000-0000-4000-8209-0000000000a2', 'first', 'Linked', 'mandatory_particular',
                    'mandatory_particulars', 'EU', '{"all": []}', 'new_obligation')$$,
                 '22023', 'D-31: an extraction never holds term links; the accepting person adds them',
                 '[D-31] an extraction that already holds a link field is refused');
select throws_ok($$select app.accept_candidate('70000000-0000-4000-8209-0000000000a1', 'first', 'MP', 'mandatory_particular',
                    'mandatory_particulars', 'EU', '{"all": []}', 'new_obligation', null, null,
                    '{"detect":{"term_keys":["test_t209_batch"]},"term_key":"test_t209_desig"}')$$,
                 '22023', null, '[D-31] a link field the shape does not take is refused');
select throws_ok($$select app.accept_candidate('70000000-0000-4000-8209-0000000000a1', 'first', 'MP', 'mandatory_particular',
                    'mandatory_particulars', 'EU', '{"all": []}', 'new_obligation', null, null,
                    '{"detect":{"term_keys":["test_t209_batch"]},"scope":"everywhere"}')$$,
                 '22023', 'scope is each_panel_in_node_language or any_panel', '[D-31] an unknown scope is refused');
select throws_ok($$select app.accept_candidate('70000000-0000-4000-8209-0000000000a1', 'first', 'MP', 'mandatory_particular',
                    'mandatory_particulars', 'EU', '{"all": []}', 'new_obligation', null, null,
                    '{"detect":{"term_keys":[]}}')$$,
                 '22023', null, '[D-31] detect needs at least one term key');
select throws_ok($$select app.accept_candidate('70000000-0000-4000-8209-0000000000a1', 'first', 'MP', 'mandatory_particular',
                    'mandatory_particulars', 'EU', '{"all": []}', 'new_obligation', null, null,
                    '{"detect":{"term_keys":["test_t209_pending"]}}')$$,
                 '22023', 'term test_t209_pending has no accepted entry in the register (K03)',
                 '[D-31] a key with only a candidate entry is refused: links name accepted terms');
select throws_ok($$select app.accept_candidate('70000000-0000-4000-8209-0000000000a1', 'first', 'MP', 'mandatory_particular',
                    'mandatory_particulars', 'EU', '{"all": []}', 'new_obligation', null, null,
                    '{"scope":"any_panel"}')$$,
                 '22023', 'a mandatory_particular rule links detect.term_keys', '[D-31] a mode without its key is refused');
select lives_ok($$select app.accept_candidate('70000000-0000-4000-8209-0000000000a1', 'first', 'MP', 'mandatory_particular',
                    'mandatory_particulars', 'EU', '{"all": []}', 'new_obligation', null, null,
                    '{"detect":{"term_keys":["test_t209_batch"]},"scope":"each_panel_in_node_language"}')$$,
                '[D-31] a person accepts a rule with its links');
reset role;
select is((select params from ref.rule_versions where rule_key = 'TEST.T209.MP' and version = 1),
          '{"particular":"synthetic batch","conditions":[],"detect":{"term_keys":["test_t209_batch"]},
            "scope":"each_panel_in_node_language"}'::jsonb,
          '[D-31] the version holds the extraction''s params unchanged plus the person''s links');
select is((select after -> 'links' from app.audit_events where kind = 'rule_version.accepted'
           and object_id = 'TEST.T209.MP:1'),
          '{"detect":{"term_keys":["test_t209_batch"]},"scope":"each_panel_in_node_language"}'::jsonb,
          '[D-31] the links are in the acceptance''s audit event');

set local role authenticated;
select lives_ok($$select app.accept_candidate('70000000-0000-4000-8209-0000000000a3', 'first', 'PW', 'prescribed_wording',
                    'mandatory_particulars', 'EU', '{"all": []}', 'prescribed_wording')$$,
                '[D-31] a rule may be accepted without links: it stays withheld data_missing until re-linked');
reset role;
select is((select private.linked_term_keys(params) from ref.rule_versions where rule_key = 'TEST.T209.PW'),
          array[]::text[], '[D-31] an unlinked rule links no term');

-- ─── Re-linking ─────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
select throws_ok($$select app.relink_rule('TEST.T209.NONE', '{"term_key":"test_t209_desig"}')$$,
                 '22023', null, '[D-31] an unknown rule cannot be re-linked');
select lives_ok($$select app.relink_rule('TEST.T209.PW', '{"term_key":"test_t209_desig","match":"exact"}', 'synthetic')$$,
                '[D-31] staff re-link an accepted rule');
reset role;
select results_eq(
  $$select version, effect_type, supersedes_version, status, params from ref.rule_versions
    where rule_key = 'TEST.T209.PW' order by version$$,
  $$values (1, 'prescribed_wording'::text, null::int, 'accepted'::text,
            '{"wordings":["synthetic designation"],"alternatives":[]}'::jsonb),
           (2, 'editorial', 1, 'accepted',
            '{"wordings":["synthetic designation"],"alternatives":[],"term_key":"test_t209_desig","match":"exact"}')$$,
  '[D-31] a re-link is a new accepted editorial version superseding the last; the extraction''s params are kept');
select is((select count(*)::int from ref.rule_fixtures where rule_key = 'TEST.T209.PW' and version = 2), 0,
          '[D-31] fixtures are not copied: the re-linked version is tested anew');
select is((select count(*)::int from app.audit_events where kind = 'rule_version.relinked'
           and object_id = 'TEST.T209.PW:2' and actor_id = '10000000-0000-4000-8209-0000000000a1'), 1,
          '[D-31] the re-link is audited with the staff actor');
set local role authenticated;
select throws_ok($$select app.relink_rule('TEST.T209.PW', '{"term_key":"test_t209_desig","match":"exact"}')$$,
                 '22023', null, '[D-31] re-linking with the same links is refused');
select throws_ok($$select app.relink_rule('TEST.T209.PW', '{"detect":{"term_keys":["test_t209_batch"]}}')$$,
                 '22023', null, '[D-31] a re-link is held to the shape''s link fields too');

-- ─── P0048: complete coverage needs every linked term in every node language ─────────────────────
select lives_ok($$select app.create_ruleset_draft('2026.92-t209', 'synthetic')$$, '[T-209] a draft is started');
select lives_ok($$select app.set_draft_member('2026.92-t209', 'TEST.T209.MP', 1)$$, '[T-209] the linked rule is a member');
reset role;
insert into ref.rule_fixtures (rule_key, version, name, input, expected_outcome) values
  ('TEST.T209.MP', 1, 'synthetic passed', '{"panel":"synthetic"}', 'passed'),
  ('TEST.T209.MP', 1, 'synthetic failed', '{"panel":"synthetic"}', 'failed'),
  ('TEST.T209.MP', 1, 'synthetic withheld', '{"panel":"synthetic"}', 'withheld');
create temp table digests as select private.ruleset_draft_digest('2026.92-t209') as before;
set local role authenticated;
select throws_ok($$select app.set_draft_coverage('2026.92-t209', 'EU-FI', 'mandatory_particulars', 'complete')$$,
                 'P0048', null,
                 '[D-31] EU-FI (fi, sv) cannot be complete while the linked term has no accepted Finnish entry');
select lives_ok($$select app.set_draft_coverage('2026.92-t209', 'EU-SE', 'mandatory_particulars', 'complete')$$,
                '[D-31] EU-SE (sv) can be complete: the linked term has its Swedish entry');
reset role;
insert into ref.term_entries (term_key, language, term, kind, article_ref, source_id, status) values
  ('test_t209_batch', 'fi', 'synteettinen erä', 'heading', 'Synthetic Act Art. 9',
   '60000000-0000-4000-8209-0000000000a1', 'accepted');
select isnt(private.ruleset_draft_digest('2026.92-t209'), (select before from digests),
            '[D-31] an accepted entry of a linked term changes the digest, so an earlier fixture run goes stale');
set local role authenticated;
select lives_ok($$select app.set_draft_coverage('2026.92-t209', 'EU-FI', 'mandatory_particulars', 'complete')$$,
                '[D-31] with its Finnish entry accepted, EU-FI can be complete');
select throws_ok($$select app.set_draft_member('2026.92-t209', 'TEST.T209.PW', 2)$$, 'P0048', null,
                 '[D-31] a member whose linked term lacks a language of complete coverage is refused there too');
reset role;

select * from finish();
rollback;
