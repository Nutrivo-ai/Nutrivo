-- T-401 · C01, C02, C03, C04, B02: products, families, variants, stages and the free label allowance.
-- Writes go only through app.create_product, app.create_product_from_artwork, app.add_product_markets,
-- app.set_product_stage and app.register_artwork; reads stay under RLS.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(81);
set local client_min_messages = warning;

-- ─── A: free, Alice (admin), Carl (editor), Vera (viewer), Sid (editor scoped to EU-DE), Ezra (external editor).
-- B: basic with 2 recipes included, Bob (admin). D: new artworks stopped by dunning, Dora (admin). ─────────────
insert into auth.users (id, email) values
  ('00000000-0000-4000-8401-0000000000a1','alice@a.test'), ('00000000-0000-4000-8401-0000000000c1','carl@a.test'),
  ('00000000-0000-4000-8401-0000000000f1','vera@a.test'),  ('00000000-0000-4000-8401-0000000000e4','sid@a.test'),
  ('00000000-0000-4000-8401-0000000000e1','ezra@agency.test'), ('00000000-0000-4000-8401-0000000000b1','bob@b.test'),
  ('00000000-0000-4000-8401-0000000000d1','dora@d.test');
insert into app.people (id, user_id, display_name, email)
select ('10000000' || substr(u.id::text, 9))::uuid, u.id, split_part(u.email, '@', 1), u.email
from auth.users u where u.id::text like '00000000-0000-4000-8401-%';
insert into app.workspaces (id, name, plan, status, entitled_regions) values
  ('20000000-0000-4000-8401-00000000000a','Workspace A','free','active','{EU}'),
  ('20000000-0000-4000-8401-00000000000b','Workspace B','basic','active','{EU}'),
  ('20000000-0000-4000-8401-00000000000d','Workspace D','free','new_artwork_stopped','{EU}');
insert into app.allowances (workspace_id) values
  ('20000000-0000-4000-8401-00000000000a'), ('20000000-0000-4000-8401-00000000000b'),
  ('20000000-0000-4000-8401-00000000000d');
insert into app.subscriptions (workspace_id, plan, status, recipes_included, editor_seats) values
  ('20000000-0000-4000-8401-00000000000b','basic','active',2,3);
insert into app.memberships (workspace_id, person_id, role, is_external, scope_node_ids) values
  ('20000000-0000-4000-8401-00000000000a','10000000-0000-4000-8401-0000000000a1','admin',false,null),
  ('20000000-0000-4000-8401-00000000000a','10000000-0000-4000-8401-0000000000c1','editor',false,null),
  ('20000000-0000-4000-8401-00000000000a','10000000-0000-4000-8401-0000000000f1','viewer',false,null),
  ('20000000-0000-4000-8401-00000000000a','10000000-0000-4000-8401-0000000000e4','editor',false,'{EU-DE}'),
  ('20000000-0000-4000-8401-00000000000a','10000000-0000-4000-8401-0000000000e1','editor',true,null),
  ('20000000-0000-4000-8401-00000000000b','10000000-0000-4000-8401-0000000000b1','admin',false,null),
  ('20000000-0000-4000-8401-00000000000d','10000000-0000-4000-8401-0000000000d1','admin',false,null);

create temp table t_ids (name text primary key, id uuid);
grant all on t_ids to authenticated;
create function pg_temp.id(p text) returns uuid language sql as $$ select id from t_ids where name = p $$;
create function pg_temp.as_user(p text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true) $$;

select ok(not has_function_privilege('anon', 'app.create_product(uuid,text,uuid,text,text,text,text,text,jsonb,text[])', 'execute')
          and not has_function_privilege('anon', 'app.create_product_from_artwork(uuid,text,uuid)', 'execute')
          and not has_function_privilege('anon', 'app.add_product_markets(uuid,text[])', 'execute')
          and not has_function_privilege('anon', 'app.set_product_stage(uuid,text,text)', 'execute')
          and has_function_privilege('authenticated', 'app.create_product(uuid,text,uuid,text,text,text,text,text,jsonb,text[])', 'execute')
          and has_function_privilege('authenticated', 'app.set_product_stage(uuid,text,text)', 'execute'),
          '[T-401] the product RPCs are executable by authenticated users and never by anon');
select ok(not has_table_privilege('authenticated', 'app.products', 'insert')
          and not has_table_privilege('authenticated', 'app.products', 'update')
          and not has_table_privilege('authenticated', 'app.families', 'insert')
          and not has_table_privilege('authenticated', 'app.product_nodes', 'insert'),
          '[T-401] clients have no write grant on products, families or product_nodes');

-- ─── C01.main: create a product and its family, with markets ────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-4000-8401-0000000000c1');
set local role authenticated;
insert into t_ids values ('salmon12', app.create_product('20000000-0000-4000-8401-00000000000a', '  Salmon & Rice Adult 12 kg ',
  null, 'Salmon & Rice Adult', 'in_development', 'dog', 'adult', 'dry',
  '{"name":"Halden Pet Nutrition AB","address":"Box 1, Göteborg","country":"SE"}'::jsonb, '{EU-DE,EU-FR,EU-DE}'));
reset role;
select ok((select name = 'Salmon & Rice Adult 12 kg' and stage = 'in_development' and species = 'dog' and life_stage = 'adult'
                  and format = 'dry' and operator ->> 'country' = 'SE' and discontinued_at is null
           from app.products where id = pg_temp.id('salmon12')), '[C01.main] the product is created with its stage, species, life stage, format and operator');
select is((select f.name from app.families f join app.products p on p.family_id = f.id where p.id = pg_temp.id('salmon12')),
          'Salmon & Rice Adult', '[C01.main] its family is created with the name given');
select is((select array_agg(node_id || ':' || label_state || ':' || registration_state || ':' || display_state order by node_id)
           from app.product_nodes where product_id = pg_temp.id('salmon12')),
          '{EU-DE:not_assessed:unknown:not_assessed,EU-FR:not_assessed:unknown:not_assessed}'::text[],
          '[C01.main] each market starts not_assessed / unknown, once');
select is((select array_agg(kind order by kind) from app.audit_events where object_id in
           (pg_temp.id('salmon12')::text, (select family_id::text from app.products where id = pg_temp.id('salmon12')))),
          '{family.created,product.created}'::text[], '[C01.main] the family and the product are audited');
select ok((select actor_id = '10000000-0000-4000-8401-0000000000c1' from app.audit_events
           where kind = 'product.created' and object_id = pg_temp.id('salmon12')::text),
          '[C01.main] with the editor who created it as the actor');
select pg_temp.as_user('00000000-0000-4000-8401-0000000000f1');
set local role authenticated;
select is((select count(*)::int from app.products where id = pg_temp.id('salmon12')), 1, '[C01.main] a viewer of the workspace reads it');
reset role;
select pg_temp.as_user('00000000-0000-4000-8401-0000000000b1');
set local role authenticated;
select is((select count(*)::int from app.products where workspace_id = '20000000-0000-4000-8401-00000000000a')
          + (select count(*)::int from app.families where workspace_id = '20000000-0000-4000-8401-00000000000a')
          + (select count(*)::int from app.product_nodes where workspace_id = '20000000-0000-4000-8401-00000000000a'),
          0, '[C01.main] another workspace reads none of its products, families or markets');
select throws_ok($$select app.create_product('20000000-0000-4000-8401-00000000000a', 'Intruder', null, 'X')$$,
                 '42501', null, '[C01.main] another workspace''s admin cannot create a product in it');
reset role;

-- Who may create, and what is refused
select pg_temp.as_user('00000000-0000-4000-8401-0000000000f1');
set local role authenticated;
select throws_ok($$select app.create_product('20000000-0000-4000-8401-00000000000a', 'By a viewer', null, 'X')$$,
                 '42501', null, '[C01.main] a viewer cannot create a product');
reset role;
select pg_temp.as_user('00000000-0000-4000-8401-0000000000e4');
set local role authenticated;
select throws_ok($$select app.create_product('20000000-0000-4000-8401-00000000000a', 'By a scoped editor', null, 'X')$$,
                 '42501', null, '[C01.main] a scoped editor cannot create a product or family (asked on #43, Q4)');
reset role;
select pg_temp.as_user('00000000-0000-4000-8401-0000000000e1');
set local role authenticated;
select throws_ok($$select app.create_product('20000000-0000-4000-8401-00000000000a', 'By an external', null, 'X')$$,
                 '42501', null, '[C01.main] an external editor cannot create a product or family');
reset role;
select pg_temp.as_user('00000000-0000-4000-8401-0000000000c1');
set local role authenticated;
select throws_ok($$select app.create_product('20000000-0000-4000-8401-00000000000a', 'Texas', null, 'X', 'brief', null, null, null, null, '{US-TX}')$$,
                 '22023', null, '[C01.main] a market outside the workspace''s regions is refused');
select throws_ok($$select app.create_product('20000000-0000-4000-8401-00000000000a', 'Nowhere', null, 'X', 'brief', null, null, null, null, '{XX-YY}')$$,
                 '22023', null, '[C01.main] an unknown market is refused');
select throws_ok($$select app.create_product('20000000-0000-4000-8401-00000000000a', 'A region', null, 'X', 'brief', null, null, null, null, '{EU}')$$,
                 '22023', null, '[C01.main] a region is not a market of its own');
select throws_ok($$select app.create_product('20000000-0000-4000-8401-00000000000a', '   ', null, 'X')$$,
                 '22023', null, '[C01.main] a product needs a name');
select throws_ok($$select app.create_product('20000000-0000-4000-8401-00000000000a', 'Born dead', null, 'X', 'discontinued')$$,
                 '22023', null, '[C01.main] a product is never created discontinued');
select throws_ok($$select app.create_product('20000000-0000-4000-8401-00000000000a', 'Bad operator', null, 'X', 'brief', null, null, null, '{"name":"No address"}'::jsonb)$$,
                 '22023', null, '[C01.main] an operator without address and country is refused');
select throws_ok($$select app.create_product('20000000-0000-4000-8401-00000000000a', 'Hamster', null, 'X', 'brief', 'hamster')$$,
                 '22023', null, '[C01.main] species is dog, cat or other');
reset role;
select is((select count(*)::int from app.products where workspace_id = '20000000-0000-4000-8401-00000000000a'), 1,
          '[C01.main] a refused product leaves no product row');
select is((select count(*)::int from app.families where workspace_id = '20000000-0000-4000-8401-00000000000a'), 1,
          '[C01.main] and no family row');

-- ─── C01.must.1: products are never deleted (BE-13) ─────────────────────────────────────────────────────────────
select throws_ok($$delete from app.products where id = (select id from t_ids where name = 'salmon12')$$,
                 null, null, '[C01.must.1] products are never deleted, not even by the table owner');
select ok(not has_table_privilege('service_role', 'app.products', 'delete')
          and not has_table_privilege('authenticated', 'app.products', 'delete'),
          '[C01.must.1] no role holds delete on products');

-- ─── C03.main + C03.must.1: a variant joins the existing family ─────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-4000-8401-0000000000c1');
set local role authenticated;
insert into t_ids values ('family', (select family_id from app.products where id = (select id from t_ids where name = 'salmon12')));
insert into t_ids values ('salmon3', app.create_product('20000000-0000-4000-8401-00000000000a', 'Salmon & Rice Adult 3 kg',
  pg_temp.id('family'), null, 'active', 'dog', 'adult', 'dry', null, '{EU-DE}'));
reset role;
select is((select family_id from app.products where id = pg_temp.id('salmon3')), pg_temp.id('family'),
          '[C03.main] the variant is a new product with the existing family_id');
select is((select count(*)::int from app.families where workspace_id = '20000000-0000-4000-8401-00000000000a'), 1,
          '[C03.must.1] a variant never creates a new family');
select is((select count(*)::int from app.audit_events where kind = 'family.created'
           and workspace_id = '20000000-0000-4000-8401-00000000000a'), 1, '[C03.must.1] and no family.created is audited');
select pg_temp.as_user('00000000-0000-4000-8401-0000000000a1');
set local role authenticated;
select is((app.live_billable_counts('20000000-0000-4000-8401-00000000000a') ->> 'recipes')::int, 1,
          '[C03.must.1] two products in one family are one billable recipe');
reset role;
-- B's family cannot be borrowed by A
select pg_temp.as_user('00000000-0000-4000-8401-0000000000b1');
set local role authenticated;
insert into t_ids values ('b1', app.create_product('20000000-0000-4000-8401-00000000000b', 'B one', null, 'B recipe one'));
reset role;
insert into t_ids values ('bfamily', (select family_id from app.products where id = pg_temp.id('b1')));
select pg_temp.as_user('00000000-0000-4000-8401-0000000000c1');
set local role authenticated;
select throws_ok(format($$select app.create_product('20000000-0000-4000-8401-00000000000a', 'Borrowed', %L::uuid)$$,
                        pg_temp.id('bfamily')),
                 '22023', null, '[C03.main] a family of another workspace is refused');
reset role;

-- ─── C01.must.2 + C01.fail.1: paid plans stop at the cap and offer the next plan; never a larger invoice ─────────
select pg_temp.as_user('00000000-0000-4000-8401-0000000000b1');
set local role authenticated;
insert into t_ids values ('b2', app.create_product('20000000-0000-4000-8401-00000000000b', 'B two', null, 'B recipe two'));
select throws_ok($$select app.create_product('20000000-0000-4000-8401-00000000000b', 'B three', null, 'B recipe three')$$,
                 'P0034', null, '[C01.must.2] a paid plan with every included recipe live refuses a new family (P0034)');
select throws_ok($$select app.create_product_from_artwork('20000000-0000-4000-8401-00000000000b', 'b-three.pdf')$$,
                 'P0034', null, '[C01.must.2] the same cap holds for a product created from an artwork');
reset role;
select is((select count(*)::int from app.families where workspace_id = '20000000-0000-4000-8401-00000000000b'), 2,
          '[C01.fail.1] over the cap no family is created');
select is((select count(*)::int from app.products where workspace_id = '20000000-0000-4000-8401-00000000000b'), 2,
          '[C01.fail.1] and no product');
select ok((select recipes_included = 2 and plan = 'basic' from app.subscriptions where workspace_id = '20000000-0000-4000-8401-00000000000b'),
          '[C01.fail.1] the subscription is unchanged: no overage quantity, never a larger invoice');
select pg_temp.as_user('00000000-0000-4000-8401-0000000000b1');
set local role authenticated;
insert into t_ids values ('b2v', app.create_product('20000000-0000-4000-8401-00000000000b', 'B two 3 kg',
  (select family_id from app.products where id = (select id from t_ids where name = 'b2'))));
reset role;
select ok(pg_temp.id('b2v') is not null, '[C01.must.2] at the cap a variant of a live recipe is still created (C03.must.1)');

-- ─── C04.main: change a product's stage ─────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-4000-8401-0000000000c1');
set local role authenticated;
select is(app.set_product_stage(pg_temp.id('salmon12'), 'active'), 'active', '[C04.main] in_development → active');
select is(app.set_product_stage(pg_temp.id('salmon12'), 'active'), 'active', '[C04.main] setting the same stage again is a no-op');
reset role;
select is((select count(*)::int from app.audit_events where kind = 'product.stage_changed' and object_id = pg_temp.id('salmon12')::text),
          1, '[C04.main] one stage change, one audit event');
select ok((select before = '{"stage":"in_development"}'::jsonb and after = '{"stage":"active"}'::jsonb
                  and actor_id = '10000000-0000-4000-8401-0000000000c1'
           from app.audit_events where kind = 'product.stage_changed' and object_id = pg_temp.id('salmon12')::text),
          '[C04.main] the audit records the stage before and after, and who changed it');
select pg_temp.as_user('00000000-0000-4000-8401-0000000000f1');
set local role authenticated;
select throws_ok(format($$select app.set_product_stage(%L, 'discontinued')$$, pg_temp.id('salmon12')),
                 '42501', null, '[C04.main] a viewer cannot change a stage');
reset role;
select pg_temp.as_user('00000000-0000-4000-8401-0000000000c1');
set local role authenticated;
select throws_ok(format($$select app.set_product_stage(%L, 'archived')$$, pg_temp.id('salmon12')),
                 '22023', null, '[C04.main] an unknown stage is refused');

-- ─── C04.must.1: discontinued products leave counts, freshness and monitoring; documents stay resolvable ────────
reset role;
insert into app.jobs (id, kind, workspace_id, idempotency_key, payload)
values ('30000000-0000-4000-8401-000000000001', 'check', '20000000-0000-4000-8401-00000000000a', 't401-check', '{}');
insert into app.reports (workspace_id, product_id, node_id, ref, check_ids, ruleset_version, artwork_sha, has_not_assessed)
values ('20000000-0000-4000-8401-00000000000a', pg_temp.id('salmon3'), 'EU-DE', 't401abcdefghijklmnopqrstuv', '{}',
        '0000.00-empty', repeat('a', 64), true);
select pg_temp.as_user('00000000-0000-4000-8401-0000000000c1');
set local role authenticated;
select is(app.set_product_stage(pg_temp.id('salmon3'), 'discontinued', 'Pack size withdrawn from retail'), 'discontinued',
          '[C04.must.1] active → discontinued');
reset role;
select ok((select stage = 'discontinued' and discontinued_at is not null from app.products where id = pg_temp.id('salmon3')),
          '[C04.must.1] the product stays, marked discontinued with its date');
select is((select after ->> 'reason' from app.audit_events where kind = 'product.stage_changed'
           and object_id = pg_temp.id('salmon3')::text), 'Pack size withdrawn from retail',
          '[C04.must.1] the reason is recorded with the change (asked on #43, Q2)');
select is(public.verify_reference('t401abcdefghijklmnopqrstuv') ->> 'status', 'current',
          '[C04.must.1] its documents stay resolvable');
select pg_temp.as_user('00000000-0000-4000-8401-0000000000c1');
set local role authenticated;
select is(app.set_product_stage(pg_temp.id('salmon12'), 'discontinued'), 'discontinued', '[C04.must.1] the last live product of the family is discontinued');
select is((app.live_billable_counts('20000000-0000-4000-8401-00000000000a') ->> 'recipes')::int, 0,
          '[C04.must.1] a family with only discontinued products leaves the billable counts');
select is((app.live_billable_counts('20000000-0000-4000-8401-00000000000a') -> 'regions'), '[]'::jsonb,
          '[C04.must.1] and its markets leave the region counts');
reset role;
-- A synthetic fixture rule (rolled back with the test), never regulatory content.
insert into ref.rules (rule_key, shape, domain, node_id, title)
values ('TEST.T401.FIXTURE', 'mandatory_particular', 'mandatory_particulars', 'EU', 'T-401 test fixture');
insert into ref.rule_diffs (id, ruleset_version, rule_key, effect_type)
values ('40000000-0000-4000-8401-000000000001', '0000.00-empty', 'TEST.T401.FIXTURE', 'new_obligation');
insert into app.checks (workspace_id, product_id, node_id, job_id, ruleset_version, artwork_sha, language, label_state,
                        withheld_rule_keys)
values ('20000000-0000-4000-8401-00000000000a', pg_temp.id('salmon3'), 'EU-DE', '30000000-0000-4000-8401-000000000001',
        '0000.00-empty', repeat('a', 64), 'de', 'not_assessed', '{TEST.T401.FIXTURE}');
select is((select count(*)::int from app.affected_objects('40000000-0000-4000-8401-000000000001')), 0,
          '[C04.must.1] a rule change never reaches a discontinued product (monitoring)');
select pg_temp.as_user('00000000-0000-4000-8401-0000000000c1');
set local role authenticated;
select is((select count(*)::int from app.products where id = pg_temp.id('salmon3')), 1,
          '[C04.must.1] a discontinued product stays readable');
select is(app.set_product_stage(pg_temp.id('salmon3'), 'active'), 'active', '[C04.must.1] and can be made active again');
reset role;
select is((select count(*)::int from app.audit_events where kind = 'product.stage_changed' and object_id = pg_temp.id('salmon3')::text),
          2, '[C04.must.1] reversing is recorded like any other change');
select ok((select discontinued_at is null from app.products where id = pg_temp.id('salmon3')),
          '[C04.must.1] and clears the discontinued date');
select is((select count(*)::int from app.affected_objects('40000000-0000-4000-8401-000000000001')), 1,
          '[C04.must.1] once active again, a rule change reaches it again');
-- reviving a recipe on a paid plan respects the cap
select pg_temp.as_user('00000000-0000-4000-8401-0000000000b1');
set local role authenticated;
select is(app.set_product_stage(pg_temp.id('b1'), 'discontinued'), 'discontinued', '[C01.must.2] discontinuing frees a recipe');
insert into t_ids values ('b3', app.create_product('20000000-0000-4000-8401-00000000000b', 'B three', null, 'B recipe three'));
select throws_ok(format($$select app.set_product_stage(%L, 'active')$$, pg_temp.id('b1')),
                 'P0034', null, '[C01.must.2] making a discontinued recipe active again over the cap is refused');
reset role;

-- ─── C02.main + C02.must.1: a product created from an artwork, then register_artwork as D01 and B02 ─────────────
select pg_temp.as_user('00000000-0000-4000-8401-0000000000c1');
set local role authenticated;
insert into t_ids values ('fromart', app.create_product_from_artwork('20000000-0000-4000-8401-00000000000a', 'Puppy_Wet  Chicken.pdf'));
reset role;
select ok((select name = 'Puppy Wet Chicken' and stage = 'in_development' from app.products where id = pg_temp.id('fromart')),
          '[C02.main] the product is created with a provisional name from the file');
select ok((select f.name = 'Puppy Wet Chicken' from app.families f join app.products p on p.family_id = f.id where p.id = pg_temp.id('fromart')),
          '[C02.main] in a new family');
select is((select after ->> 'source' from app.audit_events where kind = 'product.created' and object_id = pg_temp.id('fromart')::text),
          'artwork', '[C02.main] audited as created from an artwork');
select pg_temp.as_user('00000000-0000-4000-8401-0000000000c1');
set local role authenticated;
insert into t_ids values ('av1', app.register_artwork(pg_temp.id('fromart'),
  '20000000-0000-4000-8401-00000000000a/' || pg_temp.id('fromart') || '/' || repeat('1', 64) || '.pdf', repeat('1', 64), 'Puppy_Wet  Chicken.pdf', 'application/pdf'));
select is(app.register_artwork(pg_temp.id('fromart'),
  '20000000-0000-4000-8401-00000000000a/' || pg_temp.id('fromart') || '/' || repeat('1', 64) || '.pdf', repeat('1', 64)),
  pg_temp.id('av1'), '[C02.must.1] registering the same file again returns the same artwork version (D01)');
reset role;
select ok((select is_new_artwork and version = 1 from app.artwork_versions where id = pg_temp.id('av1')),
          '[C02.main] its first artwork version is a new artwork');
select is((select count(*)::int from app.jobs where kind = 'extract' and idempotency_key = 'extract:' || pg_temp.id('av1')), 1,
          '[C02.main] and extraction is enqueued once');

-- ─── B02.main: the free allowance counts new artworks; the last one sends one email ─────────────────────────────
select is((select labels_used from app.allowances where workspace_id = '20000000-0000-4000-8401-00000000000a'), 1,
          '[B02.main] the first new artwork uses one free label');
select ok((select after = '{"labels_used":1,"labels_allowed":3}'::jsonb from app.audit_events
           where kind = 'allowance.consumed' and object_id = pg_temp.id('av1')::text),
          '[B02.main] audited allowance.consumed with the count');
select pg_temp.as_user('00000000-0000-4000-8401-0000000000c1');
set local role authenticated;
-- B02.must.1: a revised version of the same product never counts
insert into t_ids values ('av1r', app.register_artwork(pg_temp.id('fromart'),
  '20000000-0000-4000-8401-00000000000a/' || pg_temp.id('fromart') || '/' || repeat('2', 64) || '.pdf', repeat('2', 64)));
-- B02.must.1: further markets never count
select is(app.add_product_markets(pg_temp.id('fromart'), '{EU-DE,EU-NL}'), 2, '[B02.must.1] markets are added to the product');
select is(app.add_product_markets(pg_temp.id('fromart'), '{EU-DE}'), 0, '[B02.must.1] adding a market twice adds nothing');
reset role;
select is((select labels_used from app.allowances where workspace_id = '20000000-0000-4000-8401-00000000000a'), 1,
          '[B02.must.1] a revised version and further markets never count');
select ok((select not is_new_artwork from app.artwork_versions where id = pg_temp.id('av1r')),
          '[B02.must.1] the revision is recorded as not new');
select pg_temp.as_user('00000000-0000-4000-8401-0000000000e4');
set local role authenticated;
select throws_ok(format($$select app.add_product_markets(%L, '{EU-FR}')$$, pg_temp.id('fromart')),
                 '42501', null, '[B02.must.1] a member scoped to EU-DE cannot add another market');
reset role;

select pg_temp.as_user('00000000-0000-4000-8401-0000000000c1');
set local role authenticated;
insert into t_ids values ('p2', app.create_product_from_artwork('20000000-0000-4000-8401-00000000000a', 'second.pdf'));
select app.register_artwork(pg_temp.id('p2'), 'x/' || repeat('3', 64) || '.pdf', repeat('3', 64));
insert into t_ids values ('p3', app.create_product_from_artwork('20000000-0000-4000-8401-00000000000a', 'third.pdf'));
reset role;
select is((select count(*)::int from app.jobs where kind = 'notify' and workspace_id = '20000000-0000-4000-8401-00000000000a'), 0,
          '[B02.main] no email before the third free label is used');
select pg_temp.as_user('00000000-0000-4000-8401-0000000000c1');
set local role authenticated;
insert into t_ids values ('av3', app.register_artwork(pg_temp.id('p3'), 'x/' || repeat('4', 64) || '.pdf', repeat('4', 64)));
reset role;
select ok((select labels_used = 3 from app.allowances where workspace_id = '20000000-0000-4000-8401-00000000000a'),
          '[B02.main] three new artworks use the three free labels');
select ok((select count(*) = 1 and bool_and(idempotency_key = 'allowance:20000000-0000-4000-8401-00000000000a'
                                            and payload = '{"template":"allowance_used"}'::jsonb)
           from app.jobs where kind = 'notify' and workspace_id = '20000000-0000-4000-8401-00000000000a'),
          '[B02.main] the third queues one allowance_used email, ids only');

-- ─── B02.fail.1: allowance used: P0032 and the upsell; everything checked stays readable, re-checks stay free ───
select pg_temp.as_user('00000000-0000-4000-8401-0000000000c1');
set local role authenticated;
select throws_ok($$select app.create_product_from_artwork('20000000-0000-4000-8401-00000000000a', 'fourth.pdf')$$,
                 'P0032', null, '[B02.fail.1] a fourth label is refused with P0032 before any product is made');
select throws_ok(format($$select app.register_artwork(%L, 'x/' || repeat('5', 64) || '.pdf', repeat('5', 64))$$,
                        (select id from t_ids where name = 'salmon12')),
                 'P0032', null, '[B02.fail.1] a first artwork for an existing product is refused with P0032');
select is(app.register_artwork(pg_temp.id('p3'), 'x/' || repeat('6', 64) || '.pdf', repeat('6', 64)) is not null, true,
          '[B02.fail.1] a revised version of a checked label is still accepted, free');
select is((select count(*)::int from app.artwork_versions where workspace_id = '20000000-0000-4000-8401-00000000000a'), 5,
          '[B02.fail.1] every artwork already checked stays readable');
reset role;
select is((select count(*)::int from app.products where workspace_id = '20000000-0000-4000-8401-00000000000a' and name = 'fourth'), 0,
          '[B02.fail.1] no product was created for the refused label');
select is((select count(*)::int from app.jobs where kind = 'notify' and workspace_id = '20000000-0000-4000-8401-00000000000a'), 1,
          '[B02.fail.1] still one email: the refusal sends nothing more');
select pg_temp.as_user('00000000-0000-4000-8401-0000000000d1');
set local role authenticated;
select throws_ok($$select app.create_product_from_artwork('20000000-0000-4000-8401-00000000000d', 'paused.pdf')$$,
                 'P0036', null, '[C02.must.1] with new artworks paused by dunning, no product is created from an artwork (P0036)');
reset role;

-- ─── B02.must.2: enforced per workspace ─────────────────────────────────────────────────────────────────────────
select is((select labels_used from app.allowances where workspace_id = '20000000-0000-4000-8401-00000000000d'), 0,
          '[B02.must.2] another workspace''s allowance is untouched');
select pg_temp.as_user('00000000-0000-4000-8401-0000000000b1');
set local role authenticated;
select is((select count(*)::int from app.allowances where workspace_id = '20000000-0000-4000-8401-00000000000a'), 0,
          '[B02.must.2] and another workspace cannot read it');
reset role;

select * from finish();
rollback;
