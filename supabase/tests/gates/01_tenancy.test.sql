-- GATES BE-01 BE-02 BE-03 BE-04 BE-06 BE-28 · tenancy, roles, signing grants, stamped actors, anonymous access.
-- Human-owned file. Do not edit to make a build pass.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(13);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1','alice@a.test'),
  ('00000000-0000-4000-8000-0000000000b1','bob@b.test'),
  ('00000000-0000-4000-8000-0000000000e1','ext@x.test');
insert into app.people (id, user_id, display_name, email) values
  ('10000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a1','Alice','alice@a.test'),
  ('10000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000b1','Bob','bob@b.test'),
  ('10000000-0000-4000-8000-0000000000e1','00000000-0000-4000-8000-0000000000e1','Ext','ext@x.test');
insert into app.workspaces (id, name) values
  ('20000000-0000-4000-8000-00000000000a','Workspace A'), ('20000000-0000-4000-8000-00000000000b','Workspace B');
insert into app.memberships (workspace_id, person_id, role, is_external) values
  ('20000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-0000000000a1','admin',false),
  ('20000000-0000-4000-8000-00000000000b','10000000-0000-4000-8000-0000000000b1','admin',false),
  ('20000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-0000000000e1','editor',true);
insert into app.families (id, workspace_id, name) values
  ('30000000-0000-4000-8000-00000000000a','20000000-0000-4000-8000-00000000000a','Family A'),
  ('30000000-0000-4000-8000-00000000000b','20000000-0000-4000-8000-00000000000b','Family B');
insert into app.products (id, workspace_id, family_id, name) values
  ('40000000-0000-4000-8000-00000000000a','20000000-0000-4000-8000-00000000000a','30000000-0000-4000-8000-00000000000a','Product A'),
  ('40000000-0000-4000-8000-00000000000b','20000000-0000-4000-8000-00000000000b','30000000-0000-4000-8000-00000000000b','Product B');
insert into app.model_calls (workspace_id, purpose, provider, model_id, prompt_version, input_hash)
values ('20000000-0000-4000-8000-00000000000a','gate','test','test','v0','x');

select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'app' and c.relkind = 'r' and not c.relrowsecurity), 0,
          'BE-02: every table in app has row-level security enabled');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*)::int from app.products), 1, 'BE-02: a member sees only their own workspace''s products');
select is((select count(*)::int from app.products where workspace_id = '20000000-0000-4000-8000-00000000000b'), 0,
          'BE-02: another workspace''s rows are invisible');
select is((select count(*)::int from app.model_calls), 0, 'BE-02: a table with no policy is unreadable, not public');
select is((select count(*)::int from ref.jurisdictions), 83, 'BE-01: authenticated users read ref freely');
reset role;

update app.memberships set access_ends_at = now() - interval '1 day'
 where person_id = '10000000-0000-4000-8000-0000000000e1';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*)::int from app.products), 0, 'BE-03: a membership past access_ends_at returns no rows');
reset role;
update app.memberships set access_ends_at = null where person_id = '10000000-0000-4000-8000-0000000000e1';

select throws_ok(
  $$insert into app.signing_grants (workspace_id, person_id, node_id, granted_by) values
    ('20000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-0000000000e1','EU-SE','10000000-0000-4000-8000-0000000000a1')$$,
  'P0004', null, 'BE-04: granting signing authority to an external person raises');
update app.memberships set role = 'admin' where person_id = '10000000-0000-4000-8000-0000000000e1';
select is((select count(*)::int from app.signing_grants where person_id = '10000000-0000-4000-8000-0000000000e1'), 0,
          'BE-04: promotion to admin implies no signing authority');
select lives_ok(
  $$insert into app.signing_grants (workspace_id, person_id, node_id, granted_by) values
    ('20000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-0000000000a1','EU-SE','10000000-0000-4000-8000-0000000000a1')$$,
  'BE-04: an internal member can hold an explicit grant');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e1","role":"authenticated","aal":"aal1"}', true);
select private.write_audit('20000000-0000-4000-8000-00000000000a', 'gate.be06', 'product', '40000000-0000-4000-8000-00000000000a');
update app.memberships set is_external = false where person_id = '10000000-0000-4000-8000-0000000000e1';
select is((select actor_is_external from app.audit_events where kind = 'gate.be06'), true,
          'BE-06: clearing the external flag does not rewrite how a past event reads');

select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'app' and c.relkind = 'r'
             and has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')), 0,
          'BE-28: the anon role holds no table privilege in app');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'app' and has_function_privilege('anon', p.oid, 'EXECUTE')), 0,
          'BE-28: the anon role can execute no function in app');
select is(public.verify_reference('nv-ref-that-does-not-exist-0000'), '{"status": "unknown"}'::jsonb,
          'BE-28: an unknown reference returns unknown and nothing else');

select * from finish();
rollback;
