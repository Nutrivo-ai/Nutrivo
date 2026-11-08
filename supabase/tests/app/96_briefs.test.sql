-- T-1001 · E01 Create a brief: app.set_formula_lines, app.set_intended_claims, and the formula in app.request_check's
-- idempotency key (#76). app.formula_lines and app.intended_claims keep read_scoped RLS and no client writes.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(35);
set local client_min_messages = warning;

-- ─── A: Alice (editor), Vera (viewer). B: Bob (admin). ─────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-4000-8101-0000000000a1','alice@a.test'), ('00000000-0000-4000-8101-0000000000f1','vera@a.test'),
  ('00000000-0000-4000-8101-0000000000b1','bob@b.test');
insert into app.people (id, user_id, display_name, email)
select ('10000000' || substr(u.id::text, 9))::uuid, u.id, split_part(u.email, '@', 1), u.email
from auth.users u where u.id::text like '00000000-0000-4000-8101-%';
insert into app.workspaces (id, name, plan, status) values
  ('20000000-0000-4000-8101-00000000000a','Workspace A','basic','active'),
  ('20000000-0000-4000-8101-00000000000b','Workspace B','basic','active');
insert into app.families (id, workspace_id, name) values
  ('30000000-0000-4000-8101-00000000000a','20000000-0000-4000-8101-00000000000a','Family A');
insert into app.memberships (workspace_id, person_id, role) values
  ('20000000-0000-4000-8101-00000000000a','10000000-0000-4000-8101-0000000000a1','editor'),
  ('20000000-0000-4000-8101-00000000000a','10000000-0000-4000-8101-0000000000f1','viewer'),
  ('20000000-0000-4000-8101-00000000000b','10000000-0000-4000-8101-0000000000b1','admin');
insert into app.products (id, workspace_id, family_id, name, stage) values
  ('40000000-0000-4000-8101-00000000000a','20000000-0000-4000-8101-00000000000a','30000000-0000-4000-8101-00000000000a',
   'Senior brief','brief');
insert into app.product_nodes (product_id, node_id, workspace_id) values
  ('40000000-0000-4000-8101-00000000000a','EU-DE','20000000-0000-4000-8101-00000000000a');
insert into app.artwork_versions (workspace_id, product_id, version, file_sha256, storage_path, is_new_artwork) values
  ('20000000-0000-4000-8101-00000000000a','40000000-0000-4000-8101-00000000000a', 1, repeat('c', 64), 'x.pdf', false);
-- Synthetic register rows for this test only (rolled back): never regulatory content.
insert into ref.feed_materials (number, names) values ('TEST.1.1.1', '{"en": "Test chicken"}');
insert into ref.feed_additives (id, name) values ('TEST-3b001', 'Test additive');

create temp table t_ids (name text primary key, id uuid);
grant all on t_ids to authenticated;
create function pg_temp.as_user(p_sub text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true)
$$;
create function pg_temp.lines(p_lines text) returns int language sql as $$
  select app.set_formula_lines('40000000-0000-4000-8101-00000000000a', p_lines::jsonb)
$$;

-- ─── Tables: RLS on, read for product scope only, no client writes ─────────────────────────────────────────────
select ok((select relrowsecurity from pg_class where oid = 'app.formula_lines'::regclass)
          and (select relrowsecurity from pg_class where oid = 'app.intended_claims'::regclass),
          '[T-1001] RLS is enabled on app.formula_lines and app.intended_claims');
select ok(not has_table_privilege('authenticated', 'app.formula_lines', 'insert, update, delete')
          and not has_table_privilege('authenticated', 'app.intended_claims', 'insert, update, delete')
          and not has_table_privilege('anon', 'app.formula_lines', 'select')
          and not has_table_privilege('anon', 'app.intended_claims', 'select'),
          '[T-1001] no client write grants on either table, and nothing for anon');
select ok(not has_function_privilege('anon', 'app.set_formula_lines(uuid, jsonb)', 'execute')
          and not has_function_privilege('anon', 'app.set_intended_claims(uuid, text, text[])', 'execute')
          and not has_function_privilege('authenticated', 'private.formula_digest(uuid)', 'execute'),
          '[T-1001] anon cannot call the brief RPCs, and authenticated cannot call private.formula_digest');

-- ─── E01.main: Alice enters the formula and the intended claims ────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-4000-8101-0000000000a1');
set local role authenticated;
insert into t_ids select 'job0', app.request_check('40000000-0000-4000-8101-00000000000a');
select is(pg_temp.lines('[{"ingredient": "  Test chicken ", "percent": 60, "feed_material_ref": "TEST.1.1.1"},
                          {"ingredient": "Test additive", "additive_ref": "TEST-3b001", "amount": 150, "unit": "mg/kg"},
                          {"ingredient": "Botanical blend 4B", "percent": 0.6}]'), 3,
          '[E01.main] an editor enters a formula of three lines through app.set_formula_lines');
select is(app.set_intended_claims('40000000-0000-4000-8101-00000000000a', 'de',
                                  array['Unterstützt die Gelenkbeweglichkeit', ' Für ältere Hunde ']), 2,
          '[E01.main] an editor enters the intended claims in German, as typed');
select is(app.set_intended_claims('40000000-0000-4000-8101-00000000000a', 'fr', array['Mobilité articulaire']), 1,
          '[E01.main] and in French, per language');
select results_eq($$select position, ingredient, percent, feed_material_ref, additive_ref, amount, unit
                    from app.formula_lines where product_id = '40000000-0000-4000-8101-00000000000a' order by position$$,
                  $$values (1, 'Test chicken'::text, 60.000::numeric(7,3), 'TEST.1.1.1'::text, null::text, null::numeric, null::text),
                           (2, 'Test additive', null, null, 'TEST-3b001', 150, 'mg/kg'),
                           (3, 'Botanical blend 4B', 0.600, null, null, null, null)$$,
                  '[E01.main] the editor reads the lines back in order, trimmed, with the register rows they picked');
select results_eq($$select language, claim_text from app.intended_claims
                    where product_id = '40000000-0000-4000-8101-00000000000a' order by language, created_at$$,
                  $$values ('de'::text, 'Unterstützt die Gelenkbeweglichkeit'::text), ('de', 'Für ältere Hunde'),
                           ('fr', 'Mobilité articulaire')$$,
                  '[E01.main] the intended claims are stored per language, exactly as typed (trimmed), in order');
insert into t_ids select 'job1', app.request_check('40000000-0000-4000-8101-00000000000a');
reset role;

select ok((select bool_and(applied_by = '10000000-0000-4000-8101-0000000000a1') from app.formula_lines
           where product_id = '40000000-0000-4000-8101-00000000000a'),
          '[E01.main] applied_by is the person who entered the formula, never the model (E03)');
select ok((select id from t_ids where name = 'job1') <> (select id from t_ids where name = 'job0'),
          '[E01.main] entering a formula makes the next request_check a new check job, so additive rules run on it');
select is((select payload ->> 'formula_digest' from app.jobs where id = (select id from t_ids where name = 'job1')),
          private.formula_digest('40000000-0000-4000-8101-00000000000a'),
          '[T-1001] the check job carries the digest of the formula it was requested for');
select is((select payload ->> 'formula_digest' from app.jobs where id = (select id from t_ids where name = 'job0')), '-',
          '[T-1001] a check requested with no formula records "-": no formula entered');
select is((select count(*)::int from app.audit_events where object_id = '40000000-0000-4000-8101-00000000000a'
             and kind = 'formula.set' and actor_id = '10000000-0000-4000-8101-0000000000a1'), 1,
          '[E01.main] the formula write is audited formula.set');
select ok((select before = '{"lines": []}'::jsonb and jsonb_array_length(after -> 'lines') = 3 from app.audit_events
           where object_id = '40000000-0000-4000-8101-00000000000a' and kind = 'formula.set'),
          '[T-1001] the audit row holds the formula before (none) and after (three lines)');
select is((select count(*)::int from app.audit_events where object_id = '40000000-0000-4000-8101-00000000000a'
             and kind = 'intended_claims.set'), 2,
          '[E01.main] each language''s intended claims write is audited intended_claims.set');

-- The same formula again is the same check; a change to one line is a new one; removing the formula is "none".
select pg_temp.as_user('00000000-0000-4000-8101-0000000000a1');
set local role authenticated;
select is(app.request_check('40000000-0000-4000-8101-00000000000a'), (select id from t_ids where name = 'job1'),
          '[T-1001] with nothing changed, request_check returns the same job');
select pg_temp.lines('[{"ingredient": "Test chicken", "percent": 60, "feed_material_ref": "TEST.1.1.1"},
                       {"ingredient": "Test additive", "additive_ref": "TEST-3b001", "amount": 140, "unit": "mg/kg"},
                       {"ingredient": "Botanical blend 4B", "percent": 0.6}]');
insert into t_ids select 'job2', app.request_check('40000000-0000-4000-8101-00000000000a');
select ok((select id from t_ids where name = 'job2') not in (select id from t_ids where name in ('job0','job1')),
          '[T-1001] changing one amount makes a new check job');
select is(pg_temp.lines('[]'), 0, '[T-1001] an empty list removes the formula');
select is(app.request_check('40000000-0000-4000-8101-00000000000a'), (select id from t_ids where name = 'job0'),
          '[T-1001] with the formula removed the product is back to "no formula entered" (the first job''s key)');
select is(app.set_intended_claims('40000000-0000-4000-8101-00000000000a', 'fr', '{}'), 0,
          '[T-1001] an empty list removes that language''s claims only');
select is((select count(*)::int from app.intended_claims where product_id = '40000000-0000-4000-8101-00000000000a'), 2,
          '[T-1001] the German claims stay');

-- ─── Refusals ──────────────────────────────────────────────────────────────────────────────────────────────────
select throws_ok($$select pg_temp.lines('{"ingredient": "x"}')$$, '22023', null, '[T-1001] the formula must be a list');
select throws_ok($$select pg_temp.lines('[{"ingredient": "  "}]')$$, '22023', null,
                 '[T-1001] a line needs its ingredient as entered');
select throws_ok($$select pg_temp.lines('[{"ingredient": "x", "percent": 120}]')$$, '22023', null,
                 '[T-1001] percent is between 0 and 100');
select throws_ok($$select pg_temp.lines('[{"ingredient": "x", "percent": "ten"}]')$$, '22023', null,
                 '[T-1001] percent is a number');
select throws_ok($$select pg_temp.lines('[{"ingredient": "x", "amount": 5}]')$$, '22023', null,
                 '[T-1001] an amount needs its unit');
select throws_ok($$select pg_temp.lines('[{"ingredient": "x", "additive_ref": "NOT-IN-REGISTER"}]')$$, '22023', null,
                 '[T-1001] a register row the register does not hold is refused');
select throws_ok($$select pg_temp.lines('[{"ingredient": "x", "additive_ref": "TEST-3b001", "feed_material_ref": "TEST.1.1.1"}]')$$,
                 '22023', null, '[T-1001] a line is a feed material or an additive, not both');
select throws_ok($$select app.set_intended_claims('40000000-0000-4000-8101-00000000000a', 'xx', array['Claim'])$$,
                 '22023', null, '[T-1001] a claim language is one a market prints in');
select throws_ok($$select app.set_intended_claims('40000000-0000-4000-8101-00000000000a', 'de', array[' '])$$,
                 '22023', null, '[T-1001] an intended claim is not empty');
reset role;

-- Vera (viewer) reads but cannot write; Bob (another workspace) can do neither.
select pg_temp.as_user('00000000-0000-4000-8101-0000000000f1');
set local role authenticated;
select throws_ok($$select pg_temp.lines('[{"ingredient": "x"}]')$$, '42501', null,
                 '[T-1001] a viewer cannot set the formula');
select throws_ok($$select app.set_intended_claims('40000000-0000-4000-8101-00000000000a', 'de', array['x'])$$,
                 '42501', null, '[T-1001] a viewer cannot set intended claims');
select is((select count(*)::int from app.intended_claims), 2, '[T-1001] a viewer of the workspace reads the claims');
reset role;
select pg_temp.as_user('00000000-0000-4000-8101-0000000000b1');
set local role authenticated;
select throws_ok($$select pg_temp.lines('[{"ingredient": "x"}]')$$, '42501', null,
                 '[T-1001] another workspace cannot set the formula');
select is((select count(*)::int from app.intended_claims) + (select count(*)::int from app.formula_lines), 0,
          '[T-1001] another workspace reads no formula lines or claims');
reset role;

select * from finish();
rollback;
