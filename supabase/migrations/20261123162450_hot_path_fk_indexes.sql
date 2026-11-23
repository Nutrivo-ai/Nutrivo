-- Incident #314 (nightly load, performance.rpc_p95_ms): indexes for the foreign keys that the busiest RPCs filter on
-- (#81 Q5: "index the workspace_id and product_id foreign keys that RLS and joins use, measured under T-1105's load
-- test"). Without them each call scans the whole table, across every workspace, so its cost grows with the number of
-- tenants rather than with the caller's own data:
-- - app.set_formula_lines reads, deletes, re-reads and digests app.formula_lines by product_id (four scans, under the
--   product's FOR UPDATE lock, so concurrent briefs for one product queue behind them);
-- - app.set_intended_claims reads, deletes and re-reads app.intended_claims by (product_id, language);
-- - app.live_billable_counts counts app.families by workspace_id.
-- At 200 workspaces (60k products, 600k formula lines, 360k intended claims) on the local stack these took 122 ms,
-- 56 ms and 11 ms a call; with the indexes 3.1 ms, 2.7 ms and 8.9 ms (#314). Additive only (docs/18 expand): no RLS, grant, policy or
-- function changes, so the previous worker and web release work unchanged.
create index if not exists formula_lines_product on app.formula_lines (product_id, position);
create index if not exists intended_claims_product_language on app.intended_claims (product_id, language);
create index if not exists families_workspace on app.families (workspace_id);
