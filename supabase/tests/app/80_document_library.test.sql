-- T-801 · H01: the document library reads app.supplier_documents, app.suppliers and ref.document_requirements under
-- the member's session. No migration: the tables and the insert-only guard exist since 20261008000003/4 (the read
-- policy is read_scoped since 20261110102830; see 98_supplier_scope.test.sql). This file proves the read paths the screen relies on and that nothing about them is writable.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(14);
set local client_min_messages = warning;

-- ─── A: Ana (viewer), B: Ben (admin); Zed is a member of neither ────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-4000-8801-0000000000a1','ana@a.test'), ('00000000-0000-4000-8801-0000000000b1','ben@b.test'),
  ('00000000-0000-4000-8801-0000000000c1','zed@z.test');
insert into app.people (id, user_id, display_name, email)
select ('10000000' || substr(u.id::text, 9))::uuid, u.id, split_part(u.email, '@', 1), u.email
from auth.users u where u.id::text like '00000000-0000-4000-8801-%';
insert into app.workspaces (id, name, plan, status) values
  ('20000000-0000-4000-8801-00000000000a','Workspace A','free','active'),
  ('20000000-0000-4000-8801-00000000000b','Workspace B','free','active');
insert into app.memberships (workspace_id, person_id, role) values
  ('20000000-0000-4000-8801-00000000000a','10000000-0000-4000-8801-0000000000a1','viewer'),
  ('20000000-0000-4000-8801-00000000000b','10000000-0000-4000-8801-0000000000b1','admin');
insert into app.suppliers (id, workspace_id, name) values
  ('30000000-0000-4000-8801-00000000000a','20000000-0000-4000-8801-00000000000a','Aldrich Nutrition'),
  ('30000000-0000-4000-8801-00000000000b','20000000-0000-4000-8801-00000000000b','Other supplier');
insert into app.supplier_documents (workspace_id, supplier_id, doc_type, storage_path, file_sha256, valid_from, valid_to,
                                    uploaded_via, scan_status) values
  ('20000000-0000-4000-8801-00000000000a','30000000-0000-4000-8801-00000000000a','specification',
   '20000000-0000-4000-8801-00000000000a/documents/SPEC-0442.pdf', repeat('a', 64), '2025-06-03', '2026-06-03', 'member', 'clean'),
  ('20000000-0000-4000-8801-00000000000a', null, 'test_protocol',
   '20000000-0000-4000-8801-00000000000a/documents/QA-2024-07.pdf', repeat('b', 64), null, null, 'member', 'quarantine'),
  ('20000000-0000-4000-8801-00000000000b','30000000-0000-4000-8801-00000000000b','specification',
   '20000000-0000-4000-8801-00000000000b/documents/B.pdf', repeat('c', 64), null, null, 'member', 'clean');

-- ─── Grants: authenticated reads, never writes; anon reaches nothing ────────────────────────────────────────────────
select ok(has_table_privilege('authenticated', 'app.supplier_documents', 'select')
          and not has_table_privilege('authenticated', 'app.supplier_documents', 'insert')
          and not has_table_privilege('authenticated', 'app.supplier_documents', 'update')
          and not has_table_privilege('authenticated', 'app.supplier_documents', 'delete'),
          '[H01.main] authenticated may read app.supplier_documents and has no write grant');
select ok(has_table_privilege('authenticated', 'app.suppliers', 'select')
          and not has_table_privilege('authenticated', 'app.suppliers', 'insert')
          and not has_table_privilege('authenticated', 'app.suppliers', 'update')
          and not has_table_privilege('authenticated', 'app.suppliers', 'delete'),
          '[H01.main] authenticated may read app.suppliers and has no write grant');
select ok(has_table_privilege('authenticated', 'ref.document_requirements', 'select')
          and not has_table_privilege('authenticated', 'ref.document_requirements', 'insert')
          and not has_table_privilege('authenticated', 'ref.document_requirements', 'update'),
          '[H01.main] authenticated may read ref.document_requirements and never write it');
select ok(not has_table_privilege('anon', 'app.supplier_documents', 'select')
          and not has_table_privilege('anon', 'app.suppliers', 'select')
          and not has_table_privilege('anon', 'ref.document_requirements', 'select'),
          '[H01.main] anon reads no documents, suppliers or document requirements');
select ok((select relrowsecurity from pg_class where oid = 'app.supplier_documents'::regclass)
          and (select relrowsecurity from pg_class where oid = 'app.suppliers'::regclass),
          '[H01.main] RLS is on for app.supplier_documents and app.suppliers');

-- ─── Ana reads A's documents and suppliers, never B's ───────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8801-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from app.supplier_documents), 2,
          '[H01.main] a viewer reads every document of their workspace, whatever its scan state');
select is((select count(*)::int from app.supplier_documents where workspace_id = '20000000-0000-4000-8801-00000000000b'), 0,
          '[H01.main] and none of another workspace');
select is((select array_agg(name order by name) from app.suppliers), array['Aldrich Nutrition'],
          '[H01.main] a viewer reads their workspace''s suppliers only');
select is((select d.valid_to from app.supplier_documents d join app.suppliers s on s.id = d.supplier_id
           where s.name = 'Aldrich Nutrition'), date '2026-06-03',
          '[H01.main] the expiry date reads with its supplier');
select lives_ok($$select count(*) from ref.document_requirements$$,
                '[H01.main] a member reads ref.document_requirements');
select throws_ok($$insert into app.supplier_documents (workspace_id, doc_type, storage_path, file_sha256, uploaded_via)
                   values ('20000000-0000-4000-8801-00000000000a','specification','x','x','member')$$,
                 '42501', null, '[H01.main] a member cannot insert a document directly');
select throws_ok($$update app.supplier_documents set valid_to = '2030-01-01'$$,
                 '42501', null, '[H01.main] nor extend a document''s validity');
reset role;

-- ─── Zed, a member of neither workspace, reads nothing ──────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8801-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from app.supplier_documents), 0, '[H01.main] a non-member reads no documents');
select is((select count(*)::int from app.suppliers), 0, '[H01.main] a non-member reads no suppliers');
reset role;

select * from finish();
rollback;
