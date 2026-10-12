---
name: new-migration
description: How to add a Supabase migration safely in Nutrivo (RLS, grants, insert-only, tests, types).
---
1. `supabase migration new <verb_object> < /dev/null`: without the redirect it waits on stdin, which in the Bash tool
   is an open socket, and hangs. Never edit an applied migration.
2. Tables in app: workspace_id not null (plus product_id / node_id where scope applies) and created_at; enable RLS;
   read policy with private helpers; grant select to authenticated and all to service_role; nothing to anon.
3. Insert-only? Revoke update, delete and truncate, and add both triggers using private.reject_mutation().
4. RPCs: copy app.register_artwork (security definer, search_path '', permission check, P-coded errors,
   private.write_audit, private.enqueue). Revoke execute from public and anon; grant to authenticated.
5. Tests: supabase/tests/app/<area>.test.sql with begin, plan, finish, rollback, including a cross-workspace read.
6. `make db-reset && make gates && make typegen`.
