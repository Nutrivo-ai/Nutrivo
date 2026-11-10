-- DB-14 follow-up · G03: a registration's evidence document must be clean. Since T-802 a supplier upload is a
-- quarantine row, and its scan result is a new row: clean (promoted, in the documents bucket) or rejected (stays in
-- quarantine). app.record_registration refuses (22023) any evidence whose scan_status is not 'clean'.
-- Synthetic rows only, rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(6);
set local client_min_messages = warning;

insert into auth.users (id, email) values ('00000000-0000-4000-8598-0000000000e1','ed@a.test');
insert into app.people (id, user_id, display_name, email)
values ('10000000-0000-4000-8598-0000000000e1','00000000-0000-4000-8598-0000000000e1','ed','ed@a.test');
insert into app.workspaces (id, name) values ('20000000-0000-4000-8598-00000000000a','Workspace A');
insert into app.memberships (workspace_id, person_id, role, scope_node_ids)
values ('20000000-0000-4000-8598-00000000000a','10000000-0000-4000-8598-0000000000e1','editor', null);
insert into app.families (id, workspace_id, name)
values ('30000000-0000-4000-8598-00000000000a','20000000-0000-4000-8598-00000000000a','Cats');
insert into app.products (id, workspace_id, family_id, name, stage)
values ('40000000-0000-4000-8598-0000000000a1','20000000-0000-4000-8598-00000000000a',
        '30000000-0000-4000-8598-00000000000a','Cat adult','active');
insert into app.product_nodes (product_id, node_id, workspace_id)
values ('40000000-0000-4000-8598-0000000000a1','EU-SE','20000000-0000-4000-8598-00000000000a');

-- Two supplier uploads, as T-802 writes them: q1 scanned clean (promoted to c1), q2 scanned infected (r2).
insert into app.supplier_documents (id, workspace_id, doc_type, storage_path, file_sha256, uploaded_via, scan_status,
                                    promoted_from) values
  ('60000000-0000-4000-8598-0000000000a1','20000000-0000-4000-8598-00000000000a','registration_certificate',
   'quarantine/a/r1/cert.pdf', repeat('1', 64), 'supplier_link', 'quarantine', null),
  ('60000000-0000-4000-8598-0000000000a2','20000000-0000-4000-8598-00000000000a','registration_certificate',
   'quarantine/a/r2/cert.pdf', repeat('2', 64), 'supplier_link', 'quarantine', null),
  ('60000000-0000-4000-8598-0000000000c1','20000000-0000-4000-8598-00000000000a','registration_certificate',
   'a/r1/cert.pdf', repeat('1', 64), 'supplier_link', 'clean', '60000000-0000-4000-8598-0000000000a1'),
  ('60000000-0000-4000-8598-0000000000d2','20000000-0000-4000-8598-00000000000a','registration_certificate',
   'quarantine/a/r2/cert.pdf', repeat('2', 64), 'supplier_link', 'rejected', '60000000-0000-4000-8598-0000000000a2');

select set_config('request.jwt.claims',
                  json_build_object('sub', '00000000-0000-4000-8598-0000000000e1', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok($$ select app.record_registration('40000000-0000-4000-8598-0000000000a1', 'EU-SE', 'SE-1',
  current_date, null, '60000000-0000-4000-8598-0000000000a1') $$,
  '22023', null, '[G03] [DB-14] a quarantined document (not yet scanned) cannot be a registration''s evidence');
select throws_ok($$ select app.record_registration('40000000-0000-4000-8598-0000000000a1', 'EU-SE', 'SE-1',
  current_date, null, '60000000-0000-4000-8598-0000000000d2') $$,
  '22023', null, '[G03] [DB-14] a rejected (infected) document cannot be a registration''s evidence');
select throws_ok($$ select app.record_registration('40000000-0000-4000-8598-0000000000a1', 'EU-SE', 'SE-1',
  current_date, null, '60000000-0000-4000-8598-0000000000a2') $$,
  '22023', null, '[G03] [DB-14] the quarantine row behind a rejected scan cannot be the evidence either');
select is((select count(*)::int from app.registrations
           where product_id = '40000000-0000-4000-8598-0000000000a1'), 0,
          '[G03] [DB-14] a refused evidence document records nothing');

select lives_ok($$ select app.record_registration('40000000-0000-4000-8598-0000000000a1', 'EU-SE', 'SE-1',
  current_date, null, '60000000-0000-4000-8598-0000000000c1') $$,
  '[G03] [DB-14] the clean promoted document is accepted as the evidence');
select is((select evidence_doc_id from app.registrations
           where product_id = '40000000-0000-4000-8598-0000000000a1' and node_id = 'EU-SE'),
          '60000000-0000-4000-8598-0000000000c1'::uuid,
          '[G03] [DB-14] the registration cites the clean document');

select * from finish();
rollback;
