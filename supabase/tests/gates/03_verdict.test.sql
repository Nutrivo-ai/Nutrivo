-- GATES BE-07 BE-10 BE-14 BE-21 (+ BE-15) · jurisdiction shape, no rule no verdict, registration as its own state.
-- Human-owned file. Do not edit to make a build pass.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(10);

insert into app.workspaces (id, name) values ('20000000-0000-4000-8000-00000000000a','Workspace A');
insert into app.families (id, workspace_id, name) values
  ('30000000-0000-4000-8000-00000000000a','20000000-0000-4000-8000-00000000000a','Family A');
insert into app.products (id, workspace_id, family_id, name) values
  ('40000000-0000-4000-8000-00000000000a','20000000-0000-4000-8000-00000000000a','30000000-0000-4000-8000-00000000000a','Product A');

select is((select count(*)::int from ref.jurisdictions where parent_id = 'US'), 51,
          'BE-07: selecting the US region returns 51 descendants');
select is((select count(*)::int from ref.jurisdictions r where r.node_type = 'region'
           and not exists (select 1 from ref.jurisdictions c where c.parent_id = r.id)), 0,
          'BE-07: a region is never a leaf');
select throws_ok($$insert into ref.jurisdictions (id, parent_id, node_type, name) values ('US-TXX','US-TX','state','Inner Texas')$$,
                 'P0007', null, 'BE-07: a state never has children');

insert into ref.ruleset_versions (id) values ('GATE-V');
insert into ref.coverage_nodes (ruleset_version, node_id, domain, state, gap_id)
select 'GATE-V', 'EU-SE', d, 'not_encoded', 'GAP-EU-SE-' || upper(d)
from unnest(array['mandatory_particulars','composition','claims_wording','type_geometry','language','registration']) d;
insert into ref.coverage_nodes (ruleset_version, node_id, domain, state, rules_encoded)
select 'GATE-V', 'EU-DK', d, 'complete', 1
from unnest(array['mandatory_particulars','composition','claims_wording','type_geometry','language','registration']) d;

select throws_ok($$insert into app.checks (workspace_id, product_id, node_id, ruleset_version, label_state,
                                         applied_rule_keys, passed_rule_keys)
                   values ('20000000-0000-4000-8000-00000000000a','40000000-0000-4000-8000-00000000000a',
                           'EU-SE','GATE-V','clear','{R}','{R}')$$,
                 'P0021', null, 'BE-21: a market with no rules cannot return clear by any code path');
select throws_ok($$insert into app.checks (workspace_id, product_id, node_id, ruleset_version, label_state,
                                         applied_rule_keys, passed_rule_keys)
                   values ('20000000-0000-4000-8000-00000000000a','40000000-0000-4000-8000-00000000000a',
                           'EU-FI','GATE-V','clear','{R}','{R}')$$,
                 'P0021', null, 'BE-21: a market with no coverage rows is treated as not encoded');
select lives_ok($$insert into app.checks (id, workspace_id, product_id, node_id, ruleset_version, label_state,
                                        applied_rule_keys, passed_rule_keys)
                  values ('50000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-00000000000a',
                          '40000000-0000-4000-8000-00000000000a','EU-DK','GATE-V','clear','{R}','{R}')$$,
                'BE-21: a fully encoded market can return clear when every applied rule passed');
select throws_ok($$insert into app.check_findings (workspace_id, check_id, product_id, node_id, rule_key, state,
                                                 provenance, message, reason_code)
                   values ('20000000-0000-4000-8000-00000000000a','50000000-0000-4000-8000-000000000002',
                           '40000000-0000-4000-8000-00000000000a','EU-DK','R','not_assessed','not_assessed',
                           'Not encoded','not_encoded')$$,
                 '23514', null, 'BE-10: a withheld finding with a coverage reason must resolve to a gap_id');

insert into app.product_nodes (product_id, node_id, workspace_id, label_state, registration_state) values
  ('40000000-0000-4000-8000-00000000000a','US-TX','20000000-0000-4000-8000-00000000000a','clear','not_registered'),
  ('40000000-0000-4000-8000-00000000000a','US-CA','20000000-0000-4000-8000-00000000000a','clear','registered'),
  ('40000000-0000-4000-8000-00000000000a','EU-DE','20000000-0000-4000-8000-00000000000a','clear','unknown');
select is((select display_state from app.product_nodes where node_id = 'US-TX'), 'blocked',
          'BE-14: label clear and registration not_registered renders Blocked (the Texas case)');
select is((select display_state from app.product_nodes where node_id = 'EU-DE'), 'not_assessed',
          'BE-14: an unknown registration state never reads as clear');
select is(app.rollup_state('40000000-0000-4000-8000-00000000000a', 'US'), 'blocked',
          'BE-15: one blocked state makes the US region read blocked');

select * from finish();
rollback;
