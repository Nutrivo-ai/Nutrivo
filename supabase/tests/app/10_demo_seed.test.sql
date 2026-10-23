-- T-013 · demo seed (fixtures/demo_halden.psql): present, honest, idempotent, and isolated like any tenant.
-- The seed is not loaded by `supabase db reset` (the gates assume no other tenant data): this file loads it inside its
-- own transaction, twice to prove it idempotent, and rolls it back with everything else.
-- The include works however psql is fed: `\i` from the repository root (make db-tap pipes the file on stdin, CI uses
-- -f), `\ir` next to this file otherwise (pg_prove's container mounts only supabase/tests).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(25);
set local client_min_messages = warning;   -- the seed reports what it did with a notice

create temp table ref_before on commit drop as
  select (select count(*) from ref.rules) + (select count(*) from ref.rule_versions) + (select count(*) from ref.ruleset_versions)
       + (select count(*) from ref.ruleset_members) + (select count(*) from ref.coverage_gaps)
       + (select count(*) from ref.coverage_nodes) + (select count(*) from ref.term_entries)
       + (select count(*) from ref.term_decisions) + (select count(*) from ref.glossary_entries)
       + (select count(*) from ref.obligations) + (select count(*) from ref.rule_candidates)
       + (select count(*) from ref.rule_diffs) + (select count(*) from ref.sources) as n;

\set seed_from_root `[ -f supabase/tests/app/fixtures/demo_halden.psql ] && echo true || echo false`
\if :seed_from_root
\i supabase/tests/app/fixtures/demo_halden.psql
\else
\ir fixtures/demo_halden.psql
\endif
create temp table demo_counts on commit drop as
  select (select count(*) from app.products) || '/' || (select count(*) from app.checks) || '/'
         || (select count(*) from app.check_findings) || '/' || (select count(*) from auth.users) || '/'
         || (select count(*) from app.audit_events) || '/' || (select count(*) from app.jobs) as n;
\if :seed_from_root
\i supabase/tests/app/fixtures/demo_halden.psql
\else
\ir fixtures/demo_halden.psql
\endif
select is((select count(*) from app.products) || '/' || (select count(*) from app.checks) || '/'
          || (select count(*) from app.check_findings) || '/' || (select count(*) from auth.users) || '/'
          || (select count(*) from app.audit_events) || '/' || (select count(*) from app.jobs),
          (select n from demo_counts), '[T-013] loading the seed a second time changes nothing');

select is((select name from app.workspaces where id = 'da7a0000-0000-4000-8000-000000000001'), 'Halden Pet Nutrition',
          '[T-013] the demo workspace is loaded');
select is((select count(*)::int from app.memberships where workspace_id = 'da7a0000-0000-4000-8000-000000000001'
             and ended_at is null), 6, '[T-013] the six people of the design hold active memberships');
select is((select count(*)::int from app.products where workspace_id = 'da7a0000-0000-4000-8000-000000000001'), 9,
          '[T-013] the board''s products and the discontinued recipe are seeded');
select is((select count(*)::int from app.product_nodes where workspace_id = 'da7a0000-0000-4000-8000-000000000001'), 48,
          '[T-013] eight live products sit on the board''s six nodes');
select is((select count(*)::int from app.checks where workspace_id = 'da7a0000-0000-4000-8000-000000000001'), 42,
          '[T-013] six checked products carry one check per node and language panel');

-- No rule, no verdict: nothing in the demo reads Clear or Action, and every finding is withheld with its gap.
select is((select count(*)::int from app.product_nodes where workspace_id = 'da7a0000-0000-4000-8000-000000000001'
             and display_state <> 'not_assessed'), 0, '[T-013] every demo product node displays not assessed');
select is((select count(*)::int from app.checks where workspace_id = 'da7a0000-0000-4000-8000-000000000001'
             and (label_state <> 'not_assessed' or cardinality(applied_rule_keys) > 0)), 0,
          '[T-013] no demo check is clear or action, and none claims to have applied a rule');
select is((select count(*)::int from app.check_findings where workspace_id = 'da7a0000-0000-4000-8000-000000000001'
             and state = 'not_assessed' and provenance = 'not_assessed' and rule_key is null
             and gap_id is not null and reason_code = 'not_encoded'),
          (select count(*)::int from app.check_findings where workspace_id = 'da7a0000-0000-4000-8000-000000000001'),
          '[T-013] every demo finding is withheld with a gap_id and reason code, never a verdict');
select is((select count(*)::int from app.checks c where c.workspace_id = 'da7a0000-0000-4000-8000-000000000001'
             and (select count(distinct g.domain) from app.check_findings f join ref.coverage_gaps g on g.gap_id = f.gap_id
                  where f.check_id = c.id and g.node_id = c.node_id) = 6
             and (select count(*) from app.check_findings f where f.check_id = c.id) = 6), 42,
          '[T-013] each demo check carries one withheld finding for each of the six domains of its node');
select is((select count(*)::int from app.checks c
           join app.artwork_versions av on av.id = c.artwork_version_id
           join app.artwork_panels ap on ap.id = c.panel_id and ap.artwork_version_id = av.id
           where c.workspace_id = 'da7a0000-0000-4000-8000-000000000001'
             and c.artwork_sha is not distinct from av.file_sha256 and c.ruleset_version = '0000.00-empty'
             and c.language = ap.language), 42,
          '[T-013] every demo check pins the baseline ruleset, its artwork hash and a panel of that artwork in its language');

-- The seed writes no regulatory content: every ref table holds what it held before the load.
select is((select (select count(*) from ref.rules) + (select count(*) from ref.rule_versions) + (select count(*) from ref.ruleset_versions)
                + (select count(*) from ref.ruleset_members) + (select count(*) from ref.coverage_gaps)
                + (select count(*) from ref.coverage_nodes) + (select count(*) from ref.term_entries)
                + (select count(*) from ref.term_decisions) + (select count(*) from ref.glossary_entries)
                + (select count(*) from ref.obligations) + (select count(*) from ref.rule_candidates)
                + (select count(*) from ref.rule_diffs) + (select count(*) from ref.sources)),
          (select n from ref_before), '[T-013] the seed writes no reference content');

select is((select count(*)::int from app.signing_grants where workspace_id = 'da7a0000-0000-4000-8000-000000000001'), 6,
          '[T-013] six signing grants are seeded');
select is((select count(*)::int from app.signing_grants g join app.memberships m
             on m.workspace_id = g.workspace_id and m.person_id = g.person_id
           where g.workspace_id = 'da7a0000-0000-4000-8000-000000000001' and (m.is_external or g.node_id = 'US-TX')), 0,
          '[T-013] no external person and nobody for Texas holds signing authority, as designed');
select is((select count(*)::int from auth.users where id::text like 'da7a0002-%' and email like '%.example'), 6,
          '[T-013] the six demo addresses use reserved .example domains');
select is((select count(*)::int from app.jobs where workspace_id = 'da7a0000-0000-4000-8000-000000000001'
             and not exists (select 1 from jsonb_object_keys(payload) k
                             where k not in ('product_id','artwork_version_id','ruleset_version','classification_id','node_ids'))),
          6, '[T-013] the six demo job payloads hold ids only');
select is((select count(*)::int from app.jobs where workspace_id = 'da7a0000-0000-4000-8000-000000000001'
             and idempotency_key like 'demo-seed:%'), 6,
          '[T-013] demo jobs are keyed apart from app.request_check, so a real re-check runs');

-- Isolated like any tenant: a second workspace and the demo cannot read each other.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000013a1', 'other@other.test');
insert into app.people (id, user_id, display_name, email)
values ('10000000-0000-4000-8000-0000000013a1', '00000000-0000-4000-8000-0000000013a1', 'Other', 'other@other.test');
insert into app.workspaces (id, name) values ('20000000-0000-4000-8000-0000000013a0', 'Other workspace');
insert into app.memberships (workspace_id, person_id, role)
values ('20000000-0000-4000-8000-0000000013a0', '10000000-0000-4000-8000-0000000013a1', 'admin');
insert into app.families (id, workspace_id, name)
values ('30000000-0000-4000-8000-0000000013a0', '20000000-0000-4000-8000-0000000013a0', 'Other family');
insert into app.products (workspace_id, family_id, name)
values ('20000000-0000-4000-8000-0000000013a0', '30000000-0000-4000-8000-0000000013a0', 'Other product');

-- Johanna Holm, admin
select set_config('request.jwt.claims', '{"sub":"da7a0002-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*)::int from app.products), 9, '[T-013] the demo admin reads every demo product');
select is((select count(*)::int from app.products where workspace_id = '20000000-0000-4000-8000-0000000013a0'), 0,
          '[T-013] the demo admin cannot read another workspace');
reset role;

-- Katrin Reuter, external editor scoped to seven recipes and EU markets
select set_config('request.jwt.claims', '{"sub":"da7a0002-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*)::int from app.products), 8, '[T-013] the external editor reads the eight products in scope');
select is((select count(*)::int from app.product_nodes), 40, '[T-013] the external editor reads their five EU nodes per product');
select is((select count(*)::int from app.product_nodes where node_id = 'US-TX'), 0,
          '[T-013] the external editor scoped to the EU sees no Texas answers');
select is((select count(*)::int from app.products where stage = 'discontinued'), 0,
          '[T-013] the external editor sees no recipe outside their scope');
reset role;

-- someone from another workspace
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000013a1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*)::int from app.products), 1, '[T-013] another workspace''s member reads their own product');
select is((select count(*)::int from app.check_findings where workspace_id = 'da7a0000-0000-4000-8000-000000000001'), 0,
          '[T-013] another workspace''s member reads no demo findings');
reset role;

select * from finish();
rollback;
