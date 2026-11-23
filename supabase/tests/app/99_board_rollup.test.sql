-- Incident #315: app.board_rollup (migration 20261123161905_board_rollup.sql, decided on #56 Q4/Q5) is
-- app.rollup_state for every product × region of a workspace's board, and each product's worst state, in one call
-- under the caller's RLS. Synthetic rows only, rolled back; never regulatory content.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(27);
set local client_min_messages = warning;

-- ─── A: Ed (editor, unrestricted), Fay (editor scoped to family A2), Sid (viewer scoped to EU-DE).
-- B: Bo (admin). Otto: signed in, no membership anywhere. Ned: A's membership ended. Xia: A's access expired. ──────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-4000-8311-0000000000e1','ed@a.test'), ('00000000-0000-4000-8311-0000000000e2','fay@a.test'),
  ('00000000-0000-4000-8311-0000000000e3','sid@a.test'), ('00000000-0000-4000-8311-0000000000b1','bo@b.test'),
  ('00000000-0000-4000-8311-0000000000c1','otto@c.test'), ('00000000-0000-4000-8311-0000000000d1','ned@a.test'),
  ('00000000-0000-4000-8311-0000000000d2','xia@a.test');
insert into app.people (id, user_id, display_name, email)
select ('10000000' || substr(u.id::text, 9))::uuid, u.id, split_part(u.email, '@', 1), u.email
from auth.users u where u.id::text like '00000000-0000-4000-8311-%';
insert into app.workspaces (id, name) values
  ('20000000-0000-4000-8311-00000000000a','Workspace A'), ('20000000-0000-4000-8311-00000000000b','Workspace B');
insert into app.families (id, workspace_id, name) values
  ('30000000-0000-4000-8311-00000000000a','20000000-0000-4000-8311-00000000000a','Family A'),
  ('30000000-0000-4000-8311-0000000000a2','20000000-0000-4000-8311-00000000000a','Family A2'),
  ('30000000-0000-4000-8311-00000000000b','20000000-0000-4000-8311-00000000000b','Family B');
insert into app.memberships (workspace_id, person_id, role, scope_family_ids, scope_node_ids) values
  ('20000000-0000-4000-8311-00000000000a','10000000-0000-4000-8311-0000000000e1','editor',null,null),
  ('20000000-0000-4000-8311-00000000000a','10000000-0000-4000-8311-0000000000e2','editor','{30000000-0000-4000-8311-0000000000a2}',null),
  ('20000000-0000-4000-8311-00000000000a','10000000-0000-4000-8311-0000000000e3','viewer',null,'{EU-DE}'),
  ('20000000-0000-4000-8311-00000000000b','10000000-0000-4000-8311-0000000000b1','admin',null,null);
insert into app.memberships (workspace_id, person_id, role, ended_at, access_ends_at) values
  ('20000000-0000-4000-8311-00000000000a','10000000-0000-4000-8311-0000000000d1','editor', now() - interval '1 day', null),
  ('20000000-0000-4000-8311-00000000000a','10000000-0000-4000-8311-0000000000d2','viewer', null, now() - interval '1 hour');

-- Products. P1: EU (DE action, FR clear) and US (TX not registered, FED clear): the Texas case. P2: EU all clear.
-- P3 (family A2): EU-DE clear label with unknown registration, UK-GB clear. P4: discontinued. P5: no markets.
-- P6: sold at the region node EU itself (action) and in EU-AT (clear). Q (workspace B): EU-DE clear.
insert into app.products (id, workspace_id, family_id, name, stage, species, life_stage, format, discontinued_at)
select v.id::uuid, v.ws::uuid, v.fam::uuid, v.name, v.stage, v.species, v.life, v.format,
       case when v.stage = 'discontinued' then now() end
from (values
  ('40000000-0000-4000-8311-0000000000a1','20000000-0000-4000-8311-00000000000a','30000000-0000-4000-8311-00000000000a','P1','active','dog','adult','dry'),
  ('40000000-0000-4000-8311-0000000000a2','20000000-0000-4000-8311-00000000000a','30000000-0000-4000-8311-00000000000a','P2','active','dog','adult','dry'),
  ('40000000-0000-4000-8311-0000000000a3','20000000-0000-4000-8311-00000000000a','30000000-0000-4000-8311-0000000000a2','P3','active','cat','adult','wet'),
  ('40000000-0000-4000-8311-0000000000a4','20000000-0000-4000-8311-00000000000a','30000000-0000-4000-8311-00000000000a','P4','discontinued','dog','adult','dry'),
  ('40000000-0000-4000-8311-0000000000a5','20000000-0000-4000-8311-00000000000a','30000000-0000-4000-8311-00000000000a','P5','active','dog','adult','dry'),
  ('40000000-0000-4000-8311-0000000000a6','20000000-0000-4000-8311-00000000000a','30000000-0000-4000-8311-00000000000a','P6','active','dog','adult','dry'),
  ('40000000-0000-4000-8311-0000000000b1','20000000-0000-4000-8311-00000000000b','30000000-0000-4000-8311-00000000000b','Q','active','dog','adult','dry')
) v(id, ws, fam, name, stage, species, life, format);

-- A synthetic ruleset whose coverage is complete for the markets that read Clear below, so the label states are what
-- is under test and not the coverage (the pattern of 85_registrations).
insert into ref.ruleset_versions (id, notes) values ('TEST-INC-BOARD', 'synthetic pgTAP fixture (board_rollup), rolled back');
insert into ref.coverage_nodes (ruleset_version, node_id, domain, state)
select 'TEST-INC-BOARD', n, d, 'complete'
from unnest(array['EU-DE','EU-FR','EU-NL','EU-AT','US-FED','UK-GB']) n,
     unnest(array['mandatory_particulars','composition','claims_wording','type_geometry','language','registration']) d;

insert into app.product_nodes (product_id, node_id, workspace_id, label_state, registration_state, ruleset_version)
select p::uuid, n, w::uuid, l, r, 'TEST-INC-BOARD' from (values
  ('40000000-0000-4000-8311-0000000000a1','EU-DE','20000000-0000-4000-8311-00000000000a','action','not_required'),
  ('40000000-0000-4000-8311-0000000000a1','EU-FR','20000000-0000-4000-8311-00000000000a','clear','not_required'),
  ('40000000-0000-4000-8311-0000000000a1','US-TX','20000000-0000-4000-8311-00000000000a','clear','not_registered'),
  ('40000000-0000-4000-8311-0000000000a1','US-FED','20000000-0000-4000-8311-00000000000a','clear','not_required'),
  ('40000000-0000-4000-8311-0000000000a2','EU-DE','20000000-0000-4000-8311-00000000000a','clear','not_required'),
  ('40000000-0000-4000-8311-0000000000a2','EU-NL','20000000-0000-4000-8311-00000000000a','clear','not_required'),
  ('40000000-0000-4000-8311-0000000000a3','EU-DE','20000000-0000-4000-8311-00000000000a','clear','unknown'),
  ('40000000-0000-4000-8311-0000000000a3','UK-GB','20000000-0000-4000-8311-00000000000a','clear','not_required'),
  ('40000000-0000-4000-8311-0000000000a4','EU-DE','20000000-0000-4000-8311-00000000000a','action','not_required'),
  ('40000000-0000-4000-8311-0000000000a6','EU','20000000-0000-4000-8311-00000000000a','action','not_required'),
  ('40000000-0000-4000-8311-0000000000a6','EU-AT','20000000-0000-4000-8311-00000000000a','clear','not_required'),
  ('40000000-0000-4000-8311-0000000000b1','EU-DE','20000000-0000-4000-8311-00000000000b','clear','not_required')
) v(p, n, w, l, r);

create function pg_temp.as_user(p_sub text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8311-0000000000' || p_sub,
                                                            'role', 'authenticated')::text, true)
$$;
create function pg_temp.board(p_ws text) returns setof text language sql as $$
  select right(b.product_id::text, 2) || ':' || b.region_id || ':' || b.state || ':' || b.product_state
  from app.board_rollup(p_ws::uuid) b order by 1
$$;
-- Every row whose state is not what app.rollup_state answers for the same pair, read as the same person.
create function pg_temp.disagreements(p_ws text) returns bigint language sql as $$
  select count(*) from app.board_rollup(p_ws::uuid) b
  where b.state is distinct from app.rollup_state(b.product_id, b.region_id)
$$;
-- private.can_see_product against the composition it replaces, for one person over every fixture product.
create function pg_temp.helper_disagreements(p_sub text) returns bigint language sql as $$
  select pg_temp.as_user(p_sub);
  select count(*) from app.products pr
  where pr.id::text like '40000000-0000-4000-8311-%'
    and private.can_see_product(pr.id) is distinct from private.family_in_scope(pr.workspace_id, pr.family_id)
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- ─── Grants and shape ──────────────────────────────────────────────────────────────────────────────────────────
select ok(has_function_privilege('authenticated', 'app.board_rollup(uuid)', 'execute')
          and not has_function_privilege('anon', 'app.board_rollup(uuid)', 'execute')
          and not has_function_privilege('public', 'app.board_rollup(uuid)', 'execute'),
          '[F01.must.1] board_rollup: authenticated may execute it, anon and public may not');
select ok((select not p.prosecdef and p.proconfig @> array['search_path=""'] and p.provolatile = 's'
           from pg_proc p where p.oid = 'app.board_rollup(uuid)'::regprocedure),
          '[F01.must.1] board_rollup is security invoker (RLS decides), stable, with an empty search_path');

-- ─── Ed, unrestricted: every region of every product on the board, BE-15's order ──────────────────────────────
select pg_temp.as_user('e1');
set local role authenticated;
select results_eq($$select * from pg_temp.board('20000000-0000-4000-8311-00000000000a')$$,
  $$values ('a1:EU:action:blocked'), ('a1:US:blocked:blocked'), ('a2:EU:clear:clear'),
           ('a3:EU:not_assessed:not_assessed'), ('a3:UK:clear:not_assessed'), ('a6:EU:action:action')$$,
  '[F01.must.1] board_rollup: each region cell and each product''s worst state, in the order blocked > action > not_assessed > clear');
select is(pg_temp.disagreements('20000000-0000-4000-8311-00000000000a'), 0::bigint,
          '[F01.must.1] board_rollup answers exactly what app.rollup_state answers for every pair (unrestricted member)');
select is((select state from app.board_rollup('20000000-0000-4000-8311-00000000000a')
           where product_id = '40000000-0000-4000-8311-0000000000a1' and region_id = 'US'), 'blocked',
          '[F01.must.1] the Texas case: a not-registered state market makes its region Blocked');
select is((select state from app.board_rollup('20000000-0000-4000-8311-00000000000a')
           where product_id = '40000000-0000-4000-8311-0000000000a3' and region_id = 'EU'), 'not_assessed',
          '[D06.must.1] a clear label with unknown registration rolls up Not assessed, never Clear');
select is((select state from app.board_rollup('20000000-0000-4000-8311-00000000000a')
           where product_id = '40000000-0000-4000-8311-0000000000a6' and region_id = 'EU'), 'action',
          '[F01.must.1] a product''s row on the region node itself counts in that region''s roll-up, as in rollup_state');
select is_empty($$select 1 from app.board_rollup('20000000-0000-4000-8311-00000000000a')
                  where product_id = '40000000-0000-4000-8311-0000000000a4'$$,
                '[F01] a discontinued product is not on the board, so it has no roll-up');
select is_empty($$select 1 from app.board_rollup('20000000-0000-4000-8311-00000000000a')
                  where product_id = '40000000-0000-4000-8311-0000000000a5'$$,
                '[F01] a product with no markets has no region cell (the board reads it as no state)');
select is_empty($$select 1 from app.board_rollup('20000000-0000-4000-8311-00000000000a')
                  where product_id = '40000000-0000-4000-8311-0000000000b1'$$,
                '[F01.must.1] a workspace''s roll-up never includes another workspace''s product');
select is_empty($$select 1 from app.board_rollup('20000000-0000-4000-8311-00000000000b')$$,
                '[F01.must.1] a member of A reads nothing of workspace B''s roll-up');
reset role;

-- ─── Bo (workspace B) and Otto (no membership) read nothing of A ────────────────────────────────────────────────
select pg_temp.as_user('b1');
set local role authenticated;
select is_empty($$select 1 from app.board_rollup('20000000-0000-4000-8311-00000000000a')$$,
                '[F01.must.1] another workspace''s admin reads nothing of A''s roll-up');
select results_eq($$select * from pg_temp.board('20000000-0000-4000-8311-00000000000b')$$,
                  $$values ('b1:EU:clear:clear')$$, '[F01.must.1] B''s admin reads B''s own roll-up');
reset role;
select pg_temp.as_user('c1');
set local role authenticated;
select is_empty($$select 1 from app.board_rollup('20000000-0000-4000-8311-00000000000a')$$,
                '[F01.must.1] a signed-in person with no membership reads nothing');
reset role;

-- ─── Fay (family A2) rolls up only her family's products ────────────────────────────────────────────────────────
select pg_temp.as_user('e2');
set local role authenticated;
select results_eq($$select * from pg_temp.board('20000000-0000-4000-8311-00000000000a')$$,
  $$values ('a3:EU:not_assessed:not_assessed'), ('a3:UK:clear:not_assessed')$$,
  '[F01.must.1] a family-scoped member rolls up only the products of her family');
select is(pg_temp.disagreements('20000000-0000-4000-8311-00000000000a'), 0::bigint,
          '[F01.must.1] board_rollup agrees with app.rollup_state for a family-scoped member');
reset role;

-- ─── Sid (EU-DE only) rolls up only his market: another market never worsens or clears his region cell ─────────
select pg_temp.as_user('e3');
set local role authenticated;
select results_eq($$select * from pg_temp.board('20000000-0000-4000-8311-00000000000a')$$,
  $$values ('a1:EU:action:action'), ('a2:EU:clear:clear'), ('a3:EU:not_assessed:not_assessed')$$,
  '[F01.must.1] a market-scoped member rolls up only the markets in scope (no US, UK or region-node rows)');
select is(pg_temp.disagreements('20000000-0000-4000-8311-00000000000a'), 0::bigint,
          '[F01.must.1] board_rollup agrees with app.rollup_state for a market-scoped member');
reset role;

-- ─── anon cannot call it at all ─────────────────────────────────────────────────────────────────────────────────
set local role anon;
select throws_ok($$select * from app.board_rollup('20000000-0000-4000-8311-00000000000a')$$, '42501', null,
                 '[F01.must.1] anon cannot execute board_rollup');
reset role;

-- ─── Product state is the worst of the product's region cells ──────────────────────────────────────────────────
select is_empty($$select 1 from app.board_rollup('20000000-0000-4000-8311-00000000000a') b
                  group by b.product_id having count(distinct b.product_state) <> 1$$,
                '[F01.must.1] each product carries one worst state across its rows');
select is((select distinct product_state from app.board_rollup('20000000-0000-4000-8311-00000000000a')
           where product_id = '40000000-0000-4000-8311-0000000000a1'), 'blocked',
          '[F01.must.1] a product Blocked in one region is Blocked overall, whatever its other regions');
select is((select distinct product_state from app.board_rollup('20000000-0000-4000-8311-00000000000a')
           where product_id = '40000000-0000-4000-8311-0000000000a3'), 'not_assessed',
          '[F01.must.1] a product is never Clear overall while any of its regions is Not assessed');
select is((select distinct product_state from app.board_rollup('20000000-0000-4000-8311-00000000000a')
           where product_id = '40000000-0000-4000-8311-0000000000a2'), 'clear',
          '[F01.must.1] a product is Clear overall only when every region is Clear');
select is((select count(*) from app.board_rollup('20000000-0000-4000-8311-00000000000a')), 6::bigint,
          '[F01.must.1] as the table owner (no RLS), A''s board has six region cells');

-- ─── private.can_see_product, rewritten in this migration, answers as the composition it replaces ───────────────
select is((select sum(pg_temp.helper_disagreements(u)) from unnest(array['e1','e2','e3','b1','c1','d1','d2']) u),
          0::numeric,
          '[F01.must.1] can_see_product equals family_in_scope(product''s workspace, family) for every person and product');
select pg_temp.as_user('d1');
select ok(not private.can_see_product('40000000-0000-4000-8311-0000000000a1'),
          '[F01.must.1] can_see_product: an ended membership sees no product');
select pg_temp.as_user('d2');
select ok(not private.can_see_product('40000000-0000-4000-8311-0000000000a1'),
          '[F01.must.1] can_see_product: a membership whose access has ended sees no product');

select * from finish();
rollback;
