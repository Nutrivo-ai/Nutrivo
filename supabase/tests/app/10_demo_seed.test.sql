-- T-013 · demo seed (fixtures/demo_halden.psql): present, honest, idempotent, and isolated like any tenant.
-- The seed is not loaded by `supabase db reset` (the gates assume no other tenant data): this file loads it inside its
-- own transaction, twice to prove it idempotent, and rolls it back with everything else.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(19);
set local client_min_messages = warning;   -- the seed reports what it did with a notice

\ir fixtures/demo_halden.psql
create temp table demo_counts on commit drop as
  select (select count(*) from app.products) || '/' || (select count(*) from app.checks) || '/'
         || (select count(*) from app.check_findings) || '/' || (select count(*) from auth.users) as n;
\ir fixtures/demo_halden.psql
select is((select count(*) from app.products) || '/' || (select count(*) from app.checks) || '/'
          || (select count(*) from app.check_findings) || '/' || (select count(*) from auth.users),
          (select n from demo_counts), '[T-013] loading the seed a second time changes nothing');

select is((select name from app.workspaces where id = 'da7a0000-0000-4000-8000-000000000001'), 'Halden Pet Nutrition',
          '[T-013] the demo workspace is loaded');
select is((select count(*)::int from app.memberships where workspace_id = 'da7a0000-0000-4000-8000-000000000001'
             and ended_at is null), 6, '[T-013] the six people of the design hold active memberships');
select is((select count(*)::int from app.products where workspace_id = 'da7a0000-0000-4000-8000-000000000001'), 9,
          '[T-013] the board''s products and the discontinued recipe are seeded');

-- No rule, no verdict: nothing in the demo reads Clear or Action, and every finding is withheld with its gap.
select is((select count(*)::int from app.product_nodes where workspace_id = 'da7a0000-0000-4000-8000-000000000001'
             and display_state <> 'not_assessed'), 0, '[T-013] every demo product node displays not assessed');
select is((select count(*)::int from app.checks where workspace_id = 'da7a0000-0000-4000-8000-000000000001'
             and (label_state <> 'not_assessed' or cardinality(applied_rule_keys) > 0)), 0,
          '[T-013] no demo check is clear or action, and none claims to have applied a rule');
select is((select count(*)::int from app.check_findings where workspace_id = 'da7a0000-0000-4000-8000-000000000001'
             and not (state = 'not_assessed' and provenance = 'not_assessed' and rule_key is null
                      and gap_id is not null and reason_code = 'not_encoded')), 0,
          '[T-013] every demo finding is withheld with a gap_id and reason code, never a verdict');
select is((select count(*)::int from app.checks c where c.workspace_id = 'da7a0000-0000-4000-8000-000000000001'
             and (select count(*) from app.check_findings f where f.check_id = c.id) <> 6), 0,
          '[T-013] each demo check carries one withheld finding per domain');
select is((select count(*)::int from app.checks c join app.artwork_versions av on av.id = c.artwork_version_id
           where c.workspace_id = 'da7a0000-0000-4000-8000-000000000001'
             and (c.artwork_sha <> av.file_sha256 or c.ruleset_version <> '0000.00-empty' or c.language is null
                  or c.panel_id is null)), 0,
          '[T-013] every demo check pins the baseline ruleset, its artwork hash and its language panel');
select ok((select count(*) from app.checks where workspace_id = 'da7a0000-0000-4000-8000-000000000001') > 0,
          '[T-013] the demo has checks to show');

-- The seed writes no regulatory content: no ref row is accepted, released or decided by a demo person.
select is((select count(*)::int from ref.rule_versions rv join app.people p on p.id = rv.accepted_by
           where p.id::text like 'da7a0001-%')
        + (select count(*)::int from ref.ruleset_versions rv join app.people p on p.id = rv.released_by
           where p.id::text like 'da7a0001-%')
        + (select count(*)::int from ref.term_decisions td join app.people p on p.id = td.decided_by
           where p.id::text like 'da7a0001-%')
        + (select count(*)::int from ref.rule_candidates rc join app.people p on p.id = rc.decided_by
           where p.id::text like 'da7a0001-%'), 0,
          '[T-013] no reference content is accepted, released or decided by a demo person');

select is((select count(*)::int from app.signing_grants g join app.memberships m
             on m.workspace_id = g.workspace_id and m.person_id = g.person_id
           where g.workspace_id = 'da7a0000-0000-4000-8000-000000000001' and (m.is_external or g.node_id = 'US-TX')), 0,
          '[T-013] no external person and nobody for Texas holds signing authority, as designed');
select is((select count(*)::int from auth.users where id::text like 'da7a0002-%'
             and email not like '%.example'), 0, '[T-013] demo addresses use reserved .example domains');
select is((select count(*)::int from app.jobs where workspace_id = 'da7a0000-0000-4000-8000-000000000001'
             and exists (select 1 from jsonb_object_keys(payload) k
                         where k not in ('product_id','artwork_version_id','ruleset_version','classification_id','node_ids'))),
          0, '[T-013] demo job payloads hold ids only');

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
select is((select count(*)::int from app.product_nodes where node_id = 'US-TX'), 0,
          '[T-013] the external editor scoped to the EU sees no Texas answers');
select is((select count(*)::int from app.products where stage = 'discontinued'), 0,
          '[T-013] the external editor sees only the recipes in their scope');
reset role;

-- someone from another workspace
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000013a1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*)::int from app.check_findings where workspace_id = 'da7a0000-0000-4000-8000-000000000001'), 0,
          '[T-013] another workspace''s member reads no demo findings');
reset role;

select * from finish();
rollback;
