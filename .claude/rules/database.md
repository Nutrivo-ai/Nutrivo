---
paths:
  - "supabase/**"
---
# Database rules
- A new table in `app` carries workspace_id (and product_id / node_id where scope applies), has RLS enabled, a read
  policy built from the `private` helpers (`can_see_product`, `node_in_scope`, `is_member`, `has_role`),
  `grant select` to authenticated, all privileges to service_role, nothing to anon, and a pgTAP test in
  `supabase/tests/app/` proving another workspace cannot read it.
- Denormalise workspace_id, product_id and node_id onto child tables so every policy stays single-table.
- Insert-only tables are only ever added to the list (revoke update/delete/truncate + both triggers), never removed.
- RPCs: security definer, `set search_path = ''`, fully qualified names, permission check first, P-coded errors from
  docs/03-data-model.md, `private.write_audit`, `private.enqueue`. Revoke from public and anon; grant to authenticated.
- Never edit an applied migration. After any schema change: `make db-reset && make gates && make typegen`.
