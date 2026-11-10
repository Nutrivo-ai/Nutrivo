-- DB-5 follow-up (#179): app.supplier_documents and app.document_requests follow product scope like the files they
-- name (private.can_read_object). A row with a product is read only by a member who sees that product; a row without
-- a product is workspace-wide; nothing is read across workspaces. app.suppliers stays membership-wide.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(16);
set local client_min_messages = warning;

-- ─── A: Vera (viewer, whole workspace), Fay (viewer scoped to family A2). B: Bob (admin). ───────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-4000-8898-0000000000f1','vera@a.test'), ('00000000-0000-4000-8898-0000000000f2','fay@a.test'),
  ('00000000-0000-4000-8898-0000000000b1','bob@b.test');
insert into app.people (id, user_id, display_name, email)
select ('10000000' || substr(u.id::text, 9))::uuid, u.id, split_part(u.email, '@', 1), u.email
from auth.users u where u.id::text like '00000000-0000-4000-8898-%';
insert into app.workspaces (id, name) values
  ('20000000-0000-4000-8898-00000000000a','Workspace A'), ('20000000-0000-4000-8898-00000000000b','Workspace B');
insert into app.families (id, workspace_id, name) values
  ('30000000-0000-4000-8898-0000000000a1','20000000-0000-4000-8898-00000000000a','Family A1'),
  ('30000000-0000-4000-8898-0000000000a2','20000000-0000-4000-8898-00000000000a','Family A2'),
  ('30000000-0000-4000-8898-00000000000b','20000000-0000-4000-8898-00000000000b','Family B');
insert into app.memberships (workspace_id, person_id, role, scope_family_ids) values
  ('20000000-0000-4000-8898-00000000000a','10000000-0000-4000-8898-0000000000f1','viewer',null),
  ('20000000-0000-4000-8898-00000000000a','10000000-0000-4000-8898-0000000000f2','viewer','{30000000-0000-4000-8898-0000000000a2}'),
  ('20000000-0000-4000-8898-00000000000b','10000000-0000-4000-8898-0000000000b1','admin',null);
insert into app.products (id, workspace_id, family_id, name) values
  ('40000000-0000-4000-8898-0000000000a1','20000000-0000-4000-8898-00000000000a','30000000-0000-4000-8898-0000000000a1','Out of scope'),
  ('40000000-0000-4000-8898-0000000000a2','20000000-0000-4000-8898-00000000000a','30000000-0000-4000-8898-0000000000a2','In scope'),
  ('40000000-0000-4000-8898-00000000000b','20000000-0000-4000-8898-00000000000b','30000000-0000-4000-8898-00000000000b','Product B');
insert into app.suppliers (id, workspace_id, name) values
  ('50000000-0000-4000-8898-00000000000a','20000000-0000-4000-8898-00000000000a','Premix Co'),
  ('50000000-0000-4000-8898-00000000000b','20000000-0000-4000-8898-00000000000b','Supplier B');

-- Requests and documents: one for the out-of-scope product (a1), one for the in-scope product (a2), one workspace-wide
-- (no product), in A; one in B. Ids end in the product they name ('00' = none).
insert into app.document_requests (id, workspace_id, supplier_id, product_id, doc_type, title) values
  ('60000000-0000-4000-8898-0000000000a1','20000000-0000-4000-8898-00000000000a','50000000-0000-4000-8898-00000000000a',
   '40000000-0000-4000-8898-0000000000a1','spec','Out-of-scope premix specification'),
  ('60000000-0000-4000-8898-0000000000a2','20000000-0000-4000-8898-00000000000a','50000000-0000-4000-8898-00000000000a',
   '40000000-0000-4000-8898-0000000000a2','spec','In-scope premix specification'),
  ('60000000-0000-4000-8898-0000000000a0','20000000-0000-4000-8898-00000000000a','50000000-0000-4000-8898-00000000000a',
   null,'iso_cert','Site certificate'),
  ('60000000-0000-4000-8898-0000000000b0','20000000-0000-4000-8898-00000000000b','50000000-0000-4000-8898-00000000000b',
   '40000000-0000-4000-8898-00000000000b','spec','B specification');
insert into app.supplier_documents (id, workspace_id, supplier_id, product_id, doc_type, storage_path, file_sha256, uploaded_via, scan_status)
values
  ('70000000-0000-4000-8898-0000000000a1','20000000-0000-4000-8898-00000000000a','50000000-0000-4000-8898-00000000000a',
   '40000000-0000-4000-8898-0000000000a1','spec','20000000-0000-4000-8898-00000000000a/a1.pdf',repeat('a',64),'member','clean'),
  ('70000000-0000-4000-8898-0000000000a2','20000000-0000-4000-8898-00000000000a','50000000-0000-4000-8898-00000000000a',
   '40000000-0000-4000-8898-0000000000a2','spec','20000000-0000-4000-8898-00000000000a/a2.pdf',repeat('b',64),'member','clean'),
  ('70000000-0000-4000-8898-0000000000a0','20000000-0000-4000-8898-00000000000a','50000000-0000-4000-8898-00000000000a',
   null,'iso_cert','20000000-0000-4000-8898-00000000000a/ws.pdf',repeat('c',64),'member','clean'),
  ('70000000-0000-4000-8898-0000000000b0','20000000-0000-4000-8898-00000000000b','50000000-0000-4000-8898-00000000000b',
   '40000000-0000-4000-8898-00000000000b','spec','20000000-0000-4000-8898-00000000000b/b.pdf',repeat('d',64),'member','clean');

create function pg_temp.as_user(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true)
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- ─── Policies ─────────────────────────────────────────────────────────────────────────────────────────────────────
select is((select count(*)::int from pg_policies where schemaname = 'app'
           and tablename in ('supplier_documents','document_requests') and policyname = 'read_member'),
          0, '[DB-5] supplier documents and document requests no longer carry the membership-only policy');
select ok((select bool_and(c.relrowsecurity) from pg_class c
           where c.oid in ('app.supplier_documents'::regclass, 'app.document_requests'::regclass))
          and not has_table_privilege('anon', 'app.supplier_documents', 'select')
          and not has_table_privilege('anon', 'app.document_requests', 'select')
          and not has_table_privilege('authenticated', 'app.supplier_documents', 'insert')
          and not has_table_privilege('authenticated', 'app.document_requests', 'update'),
          '[DB-5] RLS stays on, anon reads nothing and clients write nothing');

-- ─── Family-scoped viewer ─────────────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-4000-8898-0000000000f2');
set local role authenticated;
select ok(exists (select 1 from app.document_requests where id = '60000000-0000-4000-8898-0000000000a2'),
          '[DB-5] a family-scoped viewer reads a request for a product in their scope');
select ok(exists (select 1 from app.document_requests where id = '60000000-0000-4000-8898-0000000000a0'),
          '[DB-5] a family-scoped viewer reads a workspace request (no product)');
select ok(not exists (select 1 from app.document_requests where id = '60000000-0000-4000-8898-0000000000a1'),
          '[DB-5] a family-scoped viewer does not read a request (or its title) for another family''s product');
select ok(not exists (select 1 from app.document_requests where workspace_id = '20000000-0000-4000-8898-00000000000b'),
          '[DB-5] a family-scoped viewer reads no request of another workspace');
select ok(exists (select 1 from app.supplier_documents where id = '70000000-0000-4000-8898-0000000000a2'),
          '[DB-5] a family-scoped viewer reads a document for a product in their scope');
select ok(exists (select 1 from app.supplier_documents where id = '70000000-0000-4000-8898-0000000000a0'),
          '[DB-5] a family-scoped viewer reads a workspace document (no product)');
select ok(not exists (select 1 from app.supplier_documents where id = '70000000-0000-4000-8898-0000000000a1'),
          '[DB-5] a family-scoped viewer does not read a document for another family''s product');
select ok(not exists (select 1 from app.supplier_documents where workspace_id = '20000000-0000-4000-8898-00000000000b'),
          '[DB-5] a family-scoped viewer reads no document of another workspace');
select is((select count(*)::int from app.suppliers), 1,
          '[DB-5] suppliers carry no product and stay readable by every member of their workspace');
reset role;

-- ─── Unscoped viewer and the other workspace ──────────────────────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-4000-8898-0000000000f1');
set local role authenticated;
select is((select count(*)::int from app.document_requests), 3,
          '[DB-5] a viewer with no family scope reads every request of their workspace and none of another');
select is((select count(*)::int from app.supplier_documents), 3,
          '[DB-5] a viewer with no family scope reads every document of their workspace and none of another');
reset role;

select pg_temp.as_user('00000000-0000-4000-8898-0000000000b1');
set local role authenticated;
select is((select array_agg(id::text) from app.document_requests), array['60000000-0000-4000-8898-0000000000b0'],
          '[DB-5] another workspace''s admin reads only their own requests');
select is((select array_agg(id::text) from app.supplier_documents), array['70000000-0000-4000-8898-0000000000b0'],
          '[DB-5] another workspace''s admin reads only their own documents');
reset role;

-- ─── Anonymous ────────────────────────────────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$select 1 from app.document_requests$$, '42501', null,
                 '[DB-5] anon cannot read document requests');
reset role;

select * from finish();
rollback;
