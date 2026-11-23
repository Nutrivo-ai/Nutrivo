-- Incident #314 (nightly load, performance.rpc_p95_ms) · The foreign keys the busiest RPCs filter on are indexed (migration
-- 20261123162450, #81 Q5), so app.set_formula_lines, app.set_intended_claims and app.live_billable_counts cost what the
-- caller's own rows cost, not a scan of every workspace's. With many other workspaces' rows present, the per-product
-- and per-workspace lookups those RPCs make use the indexes. Synthetic rows only, rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(9);
set local client_min_messages = warning;

select has_index('app', 'formula_lines', 'formula_lines_product', array['product_id', '"position"'],
                 'formula_lines is indexed by product_id (set_formula_lines, formula_digest)');
select has_index('app', 'intended_claims', 'intended_claims_product_language', array['product_id', 'language'],
                 'intended_claims is indexed by (product_id, language) (set_intended_claims)');
select has_index('app', 'families', 'families_workspace', array['workspace_id'],
                 'families is indexed by workspace_id (live_billable_counts)');

-- Fifty other workspaces' worth of rows, so a whole-table scan is never the cheaper plan.
create temp table bulk_ws as
  select ('20000000-0000-4000-8999-' || lpad(g::text, 12, '0'))::uuid as id from generate_series(1, 50) g;
insert into app.workspaces (id, name) select id, 'Workspace ' || id from bulk_ws;
create temp table bulk_pr as
  select gen_random_uuid() as id, gen_random_uuid() as fam, w.id as ws, g from bulk_ws w, generate_series(1, 40) g;
insert into app.families (id, workspace_id, name) select fam, ws, 'Recipe ' || g from bulk_pr;
insert into app.products (id, workspace_id, family_id, name) select id, ws, fam, 'Recipe ' || g from bulk_pr;
insert into app.formula_lines (workspace_id, product_id, position, ingredient)
  select ws, id, k, 'Ingredient ' || k from bulk_pr, generate_series(1, 10) k;
insert into app.intended_claims (workspace_id, product_id, language, claim_text)
  select ws, id, l, 'Claim' from bulk_pr, unnest(array['de', 'fr']) l;
analyze app.families;
analyze app.formula_lines;
analyze app.intended_claims;

create function pg_temp.plan_of(q text) returns text language plpgsql as $$
declare r text; out text := '';
begin
  for r in execute 'explain (costs off) ' || q loop out := out || r || E'\n'; end loop;
  return out;
end $$;

select ok(pg_temp.plan_of(format('select * from app.formula_lines f where f.product_id = %L',
                                 (select id from bulk_pr limit 1))) ~ 'formula_lines_product',
          'reading one product''s formula uses formula_lines_product');
select ok(pg_temp.plan_of(format('delete from app.formula_lines f where f.product_id = %L',
                                 (select id from bulk_pr limit 1))) ~ 'formula_lines_product',
          'replacing one product''s formula finds its lines through formula_lines_product');
select ok(pg_temp.plan_of(format('select * from app.intended_claims c where c.product_id = %L and c.language = %L',
                                 (select id from bulk_pr limit 1), 'de')) ~ 'intended_claims_product_language',
          'reading one product''s claims in a language uses intended_claims_product_language');
select ok(pg_temp.plan_of(format('delete from app.intended_claims c where c.product_id = %L and c.language = %L',
                                 (select id from bulk_pr limit 1), 'de')) ~ 'intended_claims_product_language',
          'replacing one product''s claims in a language uses intended_claims_product_language');
select ok(pg_temp.plan_of(format('select count(*) from app.families f where f.workspace_id = %L',
                                 (select id from bulk_ws limit 1))) ~ 'families_workspace',
          'counting one workspace''s recipes uses families_workspace');
select isnt(private.formula_digest((select id from bulk_pr limit 1)), '-',
          'formula_digest still digests the product''s own lines');

select * from finish();
rollback;
