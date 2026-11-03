-- Incident #179 · the hardening migration 20261103130000: each exploit reproduced on #8 is refused, and the legitimate
-- path beside it still works. DB-1 and DB-2 (no rule, no verdict on checks and on the board), DB-6 (findings), DB-5
-- (Storage, reports and alerts follow the record and the scope), DB-7 (register_artwork paths), DB-9 (public
-- defaults), DB-17 (trigger search_path) and X2 (the write helpers). Synthetic rows only, rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(45);
set local client_min_messages = warning;

-- ─── A: Ed (editor, everything), Fay (viewer scoped to family A1), Max (viewer scoped to EU-DE). B: Bo (admin). ──
insert into auth.users (id, email) values
  ('00000000-0000-4000-8179-0000000000e1','ed@a.test'),  ('00000000-0000-4000-8179-0000000000f1','fay@a.test'),
  ('00000000-0000-4000-8179-0000000000d1','max@a.test'), ('00000000-0000-4000-8179-0000000000b1','bo@b.test');
insert into app.people (id, user_id, display_name, email)
select ('10000000' || substr(u.id::text, 9))::uuid, u.id, split_part(u.email, '@', 1), u.email
from auth.users u where u.id::text like '00000000-0000-4000-8179-%';
insert into app.workspaces (id, name) values
  ('20000000-0000-4000-8179-00000000000a','Workspace A'), ('20000000-0000-4000-8179-00000000000b','Workspace B');
insert into app.allowances (workspace_id) values
  ('20000000-0000-4000-8179-00000000000a'), ('20000000-0000-4000-8179-00000000000b');
insert into app.families (id, workspace_id, name) values
  ('30000000-0000-4000-8179-0000000000a1','20000000-0000-4000-8179-00000000000a','Cats'),
  ('30000000-0000-4000-8179-0000000000a2','20000000-0000-4000-8179-00000000000a','Dogs'),
  ('30000000-0000-4000-8179-0000000000b1','20000000-0000-4000-8179-00000000000b','Birds');
insert into app.memberships (workspace_id, person_id, role, scope_family_ids, scope_node_ids) values
  ('20000000-0000-4000-8179-00000000000a','10000000-0000-4000-8179-0000000000e1','editor', null, null),
  ('20000000-0000-4000-8179-00000000000a','10000000-0000-4000-8179-0000000000f1','viewer',
   '{30000000-0000-4000-8179-0000000000a1}', null),
  ('20000000-0000-4000-8179-00000000000a','10000000-0000-4000-8179-0000000000d1','viewer', null, '{EU-DE}'),
  ('20000000-0000-4000-8179-00000000000b','10000000-0000-4000-8179-0000000000b1','admin', null, null);
insert into app.products (id, workspace_id, family_id, name, stage) values
  ('40000000-0000-4000-8179-0000000000a1','20000000-0000-4000-8179-00000000000a','30000000-0000-4000-8179-0000000000a1','Cat adult','active'),
  ('40000000-0000-4000-8179-0000000000a2','20000000-0000-4000-8179-00000000000a','30000000-0000-4000-8179-0000000000a2','Dog adult','active'),
  ('40000000-0000-4000-8179-0000000000b1','20000000-0000-4000-8179-00000000000b','30000000-0000-4000-8179-0000000000b1','Bird seed','active');

-- Ruleset T179-V: EU-DK has all six domains complete; EU-SE one of six; EU-DE five of six (registration has no row).
insert into ref.ruleset_versions (id) values ('T179-V');
insert into ref.coverage_nodes (ruleset_version, node_id, domain, state, rules_encoded, gap_id)
select 'T179-V', 'EU-DK', d, 'complete', 1, null
from unnest(array['mandatory_particulars','composition','claims_wording','type_geometry','language','registration']) d
union all
select 'T179-V', 'EU-SE', d, case when d = 'mandatory_particulars' then 'complete' else 'not_encoded' end, 0,
       case when d = 'mandatory_particulars' then null else 'GAP-EU-SE-' || upper(d) end
from unnest(array['mandatory_particulars','composition','claims_wording','type_geometry','language','registration']) d
union all
select 'T179-V', 'EU-DE', d, 'complete', 1, null
from unnest(array['mandatory_particulars','composition','claims_wording','type_geometry','language']) d;

create function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- ─── DB-1 · verdict_guard: Clear only where all six domains are complete ─────────────────────────────────────────
select throws_ok($$insert into app.checks (workspace_id, product_id, node_id, ruleset_version, label_state,
                                         applied_rule_keys, passed_rule_keys)
                   values ('20000000-0000-4000-8179-00000000000a','40000000-0000-4000-8179-0000000000a1',
                           'EU-SE','T179-V','clear','{T179.R}','{T179.R}')$$,
                 'P0021', null, '[#179 DB-1] a check is never clear when only one of the node''s six domains is encoded');
select throws_ok($$insert into app.checks (workspace_id, product_id, node_id, ruleset_version, label_state,
                                         applied_rule_keys, passed_rule_keys)
                   values ('20000000-0000-4000-8179-00000000000a','40000000-0000-4000-8179-0000000000a1',
                           'EU-DE','T179-V','clear','{T179.R}','{T179.R}')$$,
                 'P0021', null, '[#179 DB-1] five complete domains and one missing row is still not fully encoded');
select throws_like($$insert into app.checks (workspace_id, product_id, node_id, ruleset_version, label_state,
                                           applied_rule_keys, passed_rule_keys)
                     values ('20000000-0000-4000-8179-00000000000a','40000000-0000-4000-8179-0000000000a1',
                             'EU-SE','T179-V','clear','{T179.R}','{T179.R}')$$,
                   'BE-21: no rule, no verdict:%', '[#179 DB-1] the refusal keeps its BE-21 message');
select lives_ok($$insert into app.checks (id, workspace_id, product_id, node_id, ruleset_version, label_state,
                                        applied_rule_keys, passed_rule_keys)
                  values ('50000000-0000-4000-8179-0000000000c1','20000000-0000-4000-8179-00000000000a',
                          '40000000-0000-4000-8179-0000000000a1','EU-DK','T179-V','clear','{T179.R}','{T179.R}')$$,
                '[#179 DB-1] a fully encoded node can still be clear when every applied rule passed');
select ok(private.node_fully_encoded('T179-V', 'EU-DK') and not private.node_fully_encoded('T179-V', 'EU-SE')
          and not private.node_fully_encoded('T179-V', 'EU-DE') and not private.node_fully_encoded(null, 'EU-DK')
          and not private.node_fully_encoded('T179-V', 'EU-FI'),
          '[#179 DB-1] node_fully_encoded is true only for all six domains complete in a named ruleset');

-- ─── DB-2 · product_nodes: a Clear label is downgraded unless the market is fully encoded and pinned ─────────────
insert into app.product_nodes (product_id, node_id, workspace_id, label_state, ruleset_version, registration_state) values
  ('40000000-0000-4000-8179-0000000000a1','EU-SE','20000000-0000-4000-8179-00000000000a','clear','T179-V','registered'),
  ('40000000-0000-4000-8179-0000000000a1','EU-DK','20000000-0000-4000-8179-00000000000a','clear','T179-V','registered'),
  ('40000000-0000-4000-8179-0000000000a1','EU-FR','20000000-0000-4000-8179-00000000000a','clear',null,'registered');
select is((select label_state from app.product_nodes
           where product_id = '40000000-0000-4000-8179-0000000000a1' and node_id = 'EU-SE'), 'not_assessed',
          '[#179 DB-2] inserting clear for a market with one of six domains encoded stores not_assessed');
select is((select label_state from app.product_nodes
           where product_id = '40000000-0000-4000-8179-0000000000a1' and node_id = 'EU-FR'), 'not_assessed',
          '[#179 DB-2] clear without a pinned ruleset_version stores not_assessed');
select is((select display_state from app.product_nodes
           where product_id = '40000000-0000-4000-8179-0000000000a1' and node_id = 'EU-DK'), 'clear',
          '[#179 DB-2] a fully encoded, registered market still reads clear on the board');
update app.product_nodes set label_state = 'clear'
where product_id = '40000000-0000-4000-8179-0000000000a1' and node_id = 'EU-SE';
select is((select label_state from app.product_nodes
           where product_id = '40000000-0000-4000-8179-0000000000a1' and node_id = 'EU-SE'), 'not_assessed',
          '[#179 DB-2] updating an unencoded market to clear stores not_assessed');
update app.product_nodes set ruleset_version = null
where product_id = '40000000-0000-4000-8179-0000000000a1' and node_id = 'EU-DK';
select is((select label_state from app.product_nodes
           where product_id = '40000000-0000-4000-8179-0000000000a1' and node_id = 'EU-DK'), 'not_assessed',
          '[#179 DB-2] a clear market that loses its pinned ruleset is not clear any more');

-- ─── DB-6 · findings: rule_key on verdicts, nothing open under a clear check, the parent check's scope ───────────
insert into app.checks (id, workspace_id, product_id, node_id, ruleset_version, label_state, applied_rule_keys,
                        passed_rule_keys)
values ('50000000-0000-4000-8179-0000000000c2','20000000-0000-4000-8179-00000000000a',
        '40000000-0000-4000-8179-0000000000a1','EU-DK','T179-V','action','{T179.R}','{}');
select throws_ok($$insert into app.check_findings (workspace_id, check_id, product_id, node_id, gap_id, state,
                                                 provenance, message)
                   values ('20000000-0000-4000-8179-00000000000a','50000000-0000-4000-8179-0000000000c2',
                           '40000000-0000-4000-8179-0000000000a1','EU-DK','GAP-EU-DK-COMPOSITION','action',
                           'deterministic_rule','No rule behind this')$$,
                 '23514', null, '[#179 DB-6] a deterministic action without a rule_key is refused');
select throws_ok($$insert into app.check_findings (workspace_id, check_id, product_id, node_id, gap_id, state,
                                                 provenance, message, confidence, model_call_id)
                   values ('20000000-0000-4000-8179-00000000000a','50000000-0000-4000-8179-0000000000c2',
                           '40000000-0000-4000-8179-0000000000a1','EU-DK','GAP-EU-DK-CLAIMS_WORDING','action',
                           'model_judgement','The model says so',0.9,gen_random_uuid())$$,
                 '23514', null, '[#179 DB-6] a model action without a rule_key is refused');
select lives_ok($$insert into app.check_findings (workspace_id, check_id, product_id, node_id, rule_key, rule_version,
                                                state, provenance, message)
                  values ('20000000-0000-4000-8179-00000000000a','50000000-0000-4000-8179-0000000000c2',
                          '40000000-0000-4000-8179-0000000000a1','EU-DK','T179.R',1,'action','deterministic_rule',
                          'Batch reference missing')$$,
                '[#179 DB-6] a proper action finding with its rule_key still inserts');
select throws_ok($$insert into app.check_findings (workspace_id, check_id, product_id, node_id, rule_key, state,
                                                 provenance, message, reason_code)
                   values ('20000000-0000-4000-8179-00000000000a','50000000-0000-4000-8179-0000000000c1',
                           '40000000-0000-4000-8179-0000000000a1','EU-DK','T179.R','not_assessed','not_assessed',
                           'Withheld','data_missing')$$,
                 'P0021', null, '[#179 DB-6] a withheld finding under a clear check is refused');
select throws_ok($$insert into app.check_findings (workspace_id, check_id, product_id, node_id, rule_key, state,
                                                 provenance, message)
                   values ('20000000-0000-4000-8179-00000000000a','50000000-0000-4000-8179-0000000000c1',
                           '40000000-0000-4000-8179-0000000000a1','EU-DK','T179.R','action','deterministic_rule',
                           'Contradicts the check')$$,
                 'P0021', null, '[#179 DB-6] an action finding under a clear check is refused');
select lives_ok($$insert into app.check_findings (workspace_id, check_id, product_id, node_id, rule_key, state,
                                                provenance, message)
                  values ('20000000-0000-4000-8179-00000000000a','50000000-0000-4000-8179-0000000000c1',
                          '40000000-0000-4000-8179-0000000000a1','EU-DK','T179.R','info','deterministic_rule',
                          'Measured for the record')$$,
                '[#179 DB-6] an info finding under a clear check still inserts');
select throws_ok($$insert into app.check_findings (workspace_id, check_id, product_id, node_id, rule_key, state,
                                                 provenance, message)
                   values ('20000000-0000-4000-8179-00000000000b','50000000-0000-4000-8179-0000000000c2',
                           '40000000-0000-4000-8179-0000000000a1','EU-DK','T179.R','action','deterministic_rule',
                           'Planted in B')$$,
                 'P0046', null, '[#179 DB-6] a finding carrying another workspace''s id than its check''s is refused');
select throws_ok($$insert into app.check_findings (workspace_id, check_id, product_id, node_id, rule_key, state,
                                                 provenance, message)
                   values ('20000000-0000-4000-8179-00000000000a','50000000-0000-4000-8179-0000000000c2',
                           '40000000-0000-4000-8179-0000000000a2','EU-DK','T179.R','action','deterministic_rule',
                           'Wrong product')$$,
                 'P0046', null, '[#179 DB-6] a finding carrying another product than its check''s is refused');
select throws_ok($$insert into app.check_findings (workspace_id, check_id, product_id, node_id, rule_key, state,
                                                 provenance, message)
                   values ('20000000-0000-4000-8179-00000000000a','50000000-0000-4000-8179-0000000000c2',
                           '40000000-0000-4000-8179-0000000000a1','EU-SE','T179.R','action','deterministic_rule',
                           'Wrong market')$$,
                 'P0046', null, '[#179 DB-6] a finding carrying another market than its check''s is refused');
select ok((select convalidated from pg_constraint
           where conrelid = 'app.check_findings'::regclass and conname = 'check_findings_verdict_needs_rule'),
          '[#179 DB-6] the rule_key constraint is validated over the existing rows');
select pg_temp.as_user('00000000-0000-4000-8179-0000000000b1');
set local role authenticated;
select is((select count(*)::int from app.check_findings), 0,
          '[#179 DB-6] the other workspace''s admin reads none of A''s findings');
reset role;

-- ─── DB-5 · Storage objects are read through the row that names them; reports and alerts follow market scope ─────
insert into app.artwork_versions (id, workspace_id, product_id, version, file_sha256, storage_path, is_new_artwork) values
  ('60000000-0000-4000-8179-0000000000a1','20000000-0000-4000-8179-00000000000a','40000000-0000-4000-8179-0000000000a1',
   1, repeat('a', 64), '20000000-0000-4000-8179-00000000000a/40000000-0000-4000-8179-0000000000a1/' || repeat('a', 64) || '.pdf', true),
  ('60000000-0000-4000-8179-0000000000a2','20000000-0000-4000-8179-00000000000a','40000000-0000-4000-8179-0000000000a2',
   1, repeat('b', 64), '20000000-0000-4000-8179-00000000000a/40000000-0000-4000-8179-0000000000a2/' || repeat('b', 64) || '.pdf', true),
  -- written before DB-7: A's row naming B's object
  ('60000000-0000-4000-8179-0000000000a3','20000000-0000-4000-8179-00000000000a','40000000-0000-4000-8179-0000000000a1',
   2, repeat('c', 64), '20000000-0000-4000-8179-00000000000b/40000000-0000-4000-8179-0000000000b1/' || repeat('c', 64) || '.pdf', false);
-- Reports: product a1 in EU-DE and in EU-SE, product a2 with no market.
insert into app.reports (workspace_id, product_id, node_id, ref, check_ids, ruleset_version, artwork_sha,
                         has_not_assessed, pdf_path) values
  ('20000000-0000-4000-8179-00000000000a','40000000-0000-4000-8179-0000000000a1','EU-DE','T179REFAAAAAAAAAAAAAAAAAA1',
   '{}','T179-V','sha',true,'20000000-0000-4000-8179-00000000000a/40000000-0000-4000-8179-0000000000a1/T179REF1.pdf'),
  ('20000000-0000-4000-8179-00000000000a','40000000-0000-4000-8179-0000000000a1','EU-SE','T179REFAAAAAAAAAAAAAAAAAA2',
   '{}','T179-V','sha',true,'20000000-0000-4000-8179-00000000000a/40000000-0000-4000-8179-0000000000a1/T179REF2.pdf'),
  ('20000000-0000-4000-8179-00000000000a','40000000-0000-4000-8179-0000000000a2',null,'T179REFAAAAAAAAAAAAAAAAAA3',
   '{}','T179-V','sha',true,'20000000-0000-4000-8179-00000000000a/40000000-0000-4000-8179-0000000000a2/T179REF3.pdf');
-- Documents: one for the whole workspace, one for product a2 (a leading bucket name is tolerated).
insert into app.supplier_documents (workspace_id, product_id, doc_type, storage_path, file_sha256, uploaded_via) values
  ('20000000-0000-4000-8179-00000000000a', null, 'specification',
   '20000000-0000-4000-8179-00000000000a/documents/workspace-spec.pdf', repeat('d', 64), 'member'),
  ('20000000-0000-4000-8179-00000000000a','40000000-0000-4000-8179-0000000000a2','specification',
   'documents/20000000-0000-4000-8179-00000000000a/documents/dog-spec.pdf', repeat('e', 64), 'member');
insert into storage.objects (bucket_id, name) values
  ('artwork', '20000000-0000-4000-8179-00000000000a/40000000-0000-4000-8179-0000000000a1/' || repeat('a', 64) || '.pdf'),
  ('artwork', '20000000-0000-4000-8179-00000000000a/40000000-0000-4000-8179-0000000000a2/' || repeat('b', 64) || '.pdf'),
  ('artwork', '20000000-0000-4000-8179-00000000000a/stray.pdf'),
  ('artwork', '20000000-0000-4000-8179-00000000000b/40000000-0000-4000-8179-0000000000b1/' || repeat('c', 64) || '.pdf'),
  ('reports', '20000000-0000-4000-8179-00000000000a/40000000-0000-4000-8179-0000000000a1/T179REF1.pdf'),
  ('reports', '20000000-0000-4000-8179-00000000000a/40000000-0000-4000-8179-0000000000a1/T179REF2.pdf'),
  ('reports', '20000000-0000-4000-8179-00000000000a/40000000-0000-4000-8179-0000000000a2/T179REF3.pdf'),
  ('documents', '20000000-0000-4000-8179-00000000000a/documents/workspace-spec.pdf'),
  ('documents', '20000000-0000-4000-8179-00000000000a/documents/dog-spec.pdf');
-- Alerts: product a1 in EU-DE and in EU-SE.
insert into ref.rules (rule_key, shape, domain, node_id, title)
values ('T179.R', 'mandatory_particular', 'mandatory_particulars', 'EU', 'Synthetic #179 rule');
insert into ref.rule_diffs (id, ruleset_version, rule_key, to_version, effect_type)
values ('80000000-0000-4000-8179-0000000000d1', 'T179-V', 'T179.R', 1, 'new_obligation');
insert into app.alerts (workspace_id, rule_diff_id, product_id, node_id, phase, effect_type) values
  ('20000000-0000-4000-8179-00000000000a','80000000-0000-4000-8179-0000000000d1','40000000-0000-4000-8179-0000000000a1',
   'EU-DE','coming','new_obligation'),
  ('20000000-0000-4000-8179-00000000000a','80000000-0000-4000-8179-0000000000d1','40000000-0000-4000-8179-0000000000a1',
   'EU-SE','coming','new_obligation');

select pg_temp.as_user('00000000-0000-4000-8179-0000000000e1');
set local role authenticated;
select is((select count(*)::int from storage.objects where bucket_id = 'artwork'
           and name like '20000000-0000-4000-8179-00000000000a/%'), 2,
          '[#179 DB-5] an unscoped member reads the workspace''s artwork that a row names, and no stray object');
select is((select count(*)::int from storage.objects where bucket_id = 'artwork'
           and name like '20000000-0000-4000-8179-00000000000b/%'), 0,
          '[#179 DB-5] a row naming another workspace''s object never opens that object');
select is((select count(*)::int from app.reports) + (select count(*)::int from app.alerts), 5,
          '[#179 DB-5] an unscoped member still reads every report and alert of the workspace');
reset role;

select pg_temp.as_user('00000000-0000-4000-8179-0000000000f1');
set local role authenticated;
select is((select array_agg(name) from storage.objects where bucket_id = 'artwork'),
          array['20000000-0000-4000-8179-00000000000a/40000000-0000-4000-8179-0000000000a1/' || repeat('a', 64) || '.pdf'],
          '[#179 DB-5] a family-scoped member reads only their family''s artwork');
select is((select count(*)::int from storage.objects where bucket_id = 'reports'), 2,
          '[#179 DB-5] a family-scoped member reads only their family''s report PDFs');
select is((select array_agg(name) from storage.objects where bucket_id = 'documents'),
          array['20000000-0000-4000-8179-00000000000a/documents/workspace-spec.pdf'],
          '[#179 DB-5] a family-scoped member reads workspace documents but not another family''s product document');
reset role;

select pg_temp.as_user('00000000-0000-4000-8179-0000000000d1');
set local role authenticated;
select is((select array_agg(name order by name) from storage.objects where bucket_id = 'reports'),
          array['20000000-0000-4000-8179-00000000000a/40000000-0000-4000-8179-0000000000a1/T179REF1.pdf',
                '20000000-0000-4000-8179-00000000000a/40000000-0000-4000-8179-0000000000a2/T179REF3.pdf'],
          '[#179 DB-5] a market-scoped member reads report PDFs of their market and of no market, not of another');
select is((select array_agg(ref order by ref) from app.reports),
          array['T179REFAAAAAAAAAAAAAAAAAA1','T179REFAAAAAAAAAAAAAAAAAA3'],
          '[#179 DB-5] app.reports follows market scope');
select is((select array_agg(node_id) from app.alerts), array['EU-DE'],
          '[#179 DB-5] app.alerts follows market scope');
reset role;

select pg_temp.as_user('00000000-0000-4000-8179-0000000000b1');
set local role authenticated;
select is((select count(*)::int from storage.objects where name like '20000000-0000-4000-8179-00000000000a/%'), 0,
          '[#179 DB-5] another workspace''s admin reads none of A''s objects');
reset role;
select ok(exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                  and policyname = 'admin_read_exports' and qual like '%can_export%')
          and not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                          and policyname = 'member_read_own_workspace'),
          '[#179 DB-5] the exports policy is unchanged and the membership-only read policy is gone');

-- ─── DB-7 · register_artwork accepts only a path in the caller's workspace and product folder ───────────────────
select pg_temp.as_user('00000000-0000-4000-8179-0000000000e1');
set local role authenticated;
select throws_ok($$select app.register_artwork('40000000-0000-4000-8179-0000000000a1',
                   '20000000-0000-4000-8179-00000000000b/40000000-0000-4000-8179-0000000000b1/x.pdf', 'sha-x')$$,
                 '42501', null, '[#179 DB-7] another workspace''s folder is refused');
select throws_ok($$select app.register_artwork('40000000-0000-4000-8179-0000000000a1',
                   '20000000-0000-4000-8179-00000000000a/40000000-0000-4000-8179-0000000000a2/x.pdf', 'sha-x')$$,
                 '42501', null, '[#179 DB-7] another product''s folder in the same workspace is refused');
select throws_ok($$select app.register_artwork('40000000-0000-4000-8179-0000000000a1',
                   '20000000-0000-4000-8179-00000000000a/40000000-0000-4000-8179-0000000000a1/../../20000000-0000-4000-8179-00000000000b/x.pdf', 'sha-x')$$,
                 '22023', null, '[#179 DB-7] a path with .. is refused');
select throws_ok($$select app.register_artwork('40000000-0000-4000-8179-0000000000a1',
                   '/20000000-0000-4000-8179-00000000000a/40000000-0000-4000-8179-0000000000a1/x.pdf', 'sha-x')$$,
                 '22023', null, '[#179 DB-7] a path with a leading / is refused');
select throws_ok($$select app.register_artwork('40000000-0000-4000-8179-0000000000a1',
                   '20000000-0000-4000-8179-00000000000a//40000000-0000-4000-8179-0000000000a1/x.pdf', 'sha-x')$$,
                 '22023', null, '[#179 DB-7] a path with // is refused');
select lives_ok($$select app.register_artwork('40000000-0000-4000-8179-0000000000a1',
                  '20000000-0000-4000-8179-00000000000a/40000000-0000-4000-8179-0000000000a1/' || repeat('f', 64) || '.pdf',
                  repeat('f', 64), 'label.pdf', 'application/pdf')$$,
                '[#179 DB-7] an editor still registers artwork at its canonical path');
reset role;
select ok((select count(*) = 1 from app.artwork_versions av
           join app.jobs j on j.idempotency_key = 'extract:' || av.id::text
           join app.audit_events e on e.kind = 'artwork.registered' and e.object_id = av.id::text
           where av.file_sha256 = repeat('f', 64)),
          '[#179 DB-7] the registration still enqueues its extraction and audits it');

-- ─── DB-9 · new public objects carry no anon or authenticated grant by default ─────────────────────────────────
create table public.t179_probe (id int generated always as identity primary key);
create view public.t179_probe_view as select id from public.t179_probe;
select ok(not has_table_privilege('anon', 'public.t179_probe', 'select,insert,update,delete')
          and not has_table_privilege('authenticated', 'public.t179_probe', 'select,insert,update,delete')
          and not has_table_privilege('anon', 'public.t179_probe_view', 'select')
          and not has_table_privilege('authenticated', 'public.t179_probe_view', 'select')
          and not has_sequence_privilege('anon', 'public.t179_probe_id_seq', 'usage,select,update'),
          '[#179 DB-9] a new public table, view or sequence is granted to neither anon nor authenticated');
select ok(has_function_privilege('anon', 'public.verify_reference(text)', 'execute')
          and has_function_privilege('authenticated', 'public.verify_reference(text)', 'execute')
          and has_function_privilege('anon', 'public.coverage_snapshot()', 'execute')
          and has_function_privilege('authenticated', 'public.coverage_snapshot()', 'execute'),
          '[#179 DB-9] verify_reference and coverage_snapshot stay executable by anon and authenticated');

-- ─── DB-17 · every trigger function has a fixed search_path ─────────────────────────────────────────────────────
select is((select coalesce(array_agg(p.proname::text order by p.proname), '{}') from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('app','private','ref') and p.prorettype = 'trigger'::regtype
             and not coalesce(array_to_string(p.proconfig, ',') like '%search_path=%', false)),
          '{}'::text[], '[#179 DB-17] no trigger function in app, private or ref runs without a fixed search_path');

-- ─── X2 · enqueue, write_audit and consume_allowance are not callable by clients ────────────────────────────────
select ok(not has_function_privilege('authenticated', 'private.enqueue(text,uuid,text,jsonb)', 'execute')
          and not has_function_privilege('authenticated', 'private.write_audit(uuid,text,text,text,jsonb,jsonb,text)', 'execute')
          and not has_function_privilege('authenticated', 'private.consume_allowance(uuid)', 'execute')
          and not has_function_privilege('anon', 'private.enqueue(text,uuid,text,jsonb)', 'execute')
          and has_function_privilege('service_role', 'private.enqueue(text,uuid,text,jsonb)', 'execute')
          and has_function_privilege('service_role', 'private.write_audit(uuid,text,text,text,jsonb,jsonb,text)', 'execute')
          and has_function_privilege('service_role', 'private.consume_allowance(uuid)', 'execute'),
          '[#179 X2] only the service role (and the owner) execute the write helpers');
select pg_temp.as_user('00000000-0000-4000-8179-0000000000e1');
set local role authenticated;
select throws_ok($$select private.write_audit('20000000-0000-4000-8179-00000000000a', 'forged', 'product', 'x')$$,
                 '42501', null, '[#179 X2] a member cannot forge an audit event by calling write_audit');
select throws_ok($$select private.enqueue('extract', '20000000-0000-4000-8179-00000000000a', 't179:forged', '{}')$$,
                 '42501', null, '[#179 X2] a member cannot queue a service-role job by calling enqueue');
reset role;

select * from finish();
rollback;
