-- GATES BE-05 BE-08 BE-23 (+ BE-24) · the record cannot be mutated; stable rule identity; applied-rule record.
-- Human-owned file. Do not edit to make a build pass.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(12);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a1','alice@a.test');
insert into app.people (id, user_id, display_name) values
  ('10000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a1','Alice');
insert into app.workspaces (id, name) values ('20000000-0000-4000-8000-00000000000a','Workspace A');
insert into app.memberships (workspace_id, person_id, role) values
  ('20000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-0000000000a1','admin');
insert into app.families (id, workspace_id, name) values
  ('30000000-0000-4000-8000-00000000000a','20000000-0000-4000-8000-00000000000a','Family A');
insert into app.products (id, workspace_id, family_id, name) values
  ('40000000-0000-4000-8000-00000000000a','20000000-0000-4000-8000-00000000000a','30000000-0000-4000-8000-00000000000a','Product A');

insert into ref.rules (rule_key, shape, domain, node_id, title)
values ('GATE.R1','mandatory_particular','mandatory_particulars','EU','Gate rule');
insert into ref.rule_versions (rule_key, version, status, article_ref, source_excerpt, accepted_by, accepted_at) values
  ('GATE.R1',1,'accepted','Gate Art. 1','v1 text','10000000-0000-4000-8000-0000000000a1',now()),
  ('GATE.R1',2,'accepted','Gate Art. 1','v2 text','10000000-0000-4000-8000-0000000000a1',now()),
  ('GATE.R1',3,'accepted','Gate Art. 1','v3 text','10000000-0000-4000-8000-0000000000a1',now());
insert into ref.ruleset_versions (id, notes) values ('GATE-1','pinned to v1'), ('GATE-3','pinned to v3');
insert into ref.ruleset_members (ruleset_version, rule_key, version) values ('GATE-1','GATE.R1',1), ('GATE-3','GATE.R1',3);

select is((select count(*)::int from ref.rule_versions where rule_key = 'GATE.R1'), 3,
          'BE-08: a rule amended twice has three rows and one rule_key');
select is((select rv.source_excerpt from ref.ruleset_members m join ref.rule_versions rv using (rule_key, version)
           where m.ruleset_version = 'GATE-1'), 'v1 text',
          'BE-08: a ruleset pinned to the first version still resolves against it');
select throws_ok($$update ref.rule_versions set params = '{"x":1}' where rule_key = 'GATE.R1' and version = 1$$,
                 'P0008', null, 'BE-08: an accepted rule version cannot be edited');

insert into app.checks (id, workspace_id, product_id, node_id, ruleset_version, label_state, applied_rule_keys, passed_rule_keys)
values ('50000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-00000000000a',
        '40000000-0000-4000-8000-00000000000a','EU-SE','GATE-1','action','{GATE.R1}','{}');
insert into app.check_findings (workspace_id, check_id, product_id, node_id, rule_key, rule_version, state, provenance, message)
values ('20000000-0000-4000-8000-00000000000a','50000000-0000-4000-8000-000000000001',
        '40000000-0000-4000-8000-00000000000a','EU-SE','GATE.R1',1,'action','deterministic_rule','Batch reference missing');
select private.write_audit('20000000-0000-4000-8000-00000000000a', 'gate.be05', 'check', '50000000-0000-4000-8000-000000000001');

set local role service_role;
select throws_ok($$update app.checks set label_state = 'clear'$$, '42501', null,
                 'BE-05: an UPDATE issued with the service key is refused');
select throws_ok($$delete from app.check_findings$$, '42501', null,
                 'BE-05: a DELETE issued with the service key is refused');
reset role;
select throws_ok($$update app.checks set label_state = 'not_assessed'$$, 'P0005', null,
                 'BE-05: even the table owner cannot update a check event');
select throws_ok($$delete from app.audit_events$$, 'P0005', null,
                 'BE-05: nothing can be deleted from the audit log');
select throws_ok($$truncate app.check_findings$$, 'P0005', null,
                 'BE-05: insert-only tables cannot be truncated');

select has_column('app', 'checks', 'applied_rule_keys', 'BE-23: applied rule ids are a first-class column');
select has_column('app', 'checks', 'withheld_rule_keys', 'BE-23: withheld rule ids are a first-class column');
select throws_ok($$insert into app.checks (workspace_id, product_id, node_id, ruleset_version, label_state,
                                         applied_rule_keys, passed_rule_keys)
                   values ('20000000-0000-4000-8000-00000000000a','40000000-0000-4000-8000-00000000000a',
                           'EU-DK','GATE-1','action','{}','{GATE.R1}')$$,
                 '23514', null, 'BE-23: a rule cannot have passed without having been applied');

insert into ref.rule_diffs (id, ruleset_version, rule_key, from_version, to_version, effect_type)
values ('60000000-0000-4000-8000-000000000001','GATE-3','GATE.R1',1,3,'tightened_threshold');
select is((select count(*)::int from app.affected_objects('60000000-0000-4000-8000-000000000001')), 1,
          'BE-24: the affected-object query finds the product through the applied-rule record');

select * from finish();
rollback;
