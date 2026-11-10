-- T-504 · D06, G01, G02, G03: registration state is derived in the database, separately from label state; a
-- registration is recorded only through app.record_registration; no obligation content ships; nothing submits to an
-- authority. Synthetic rows only, rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(24);
set local client_min_messages = warning;

-- A: Ed (editor, every market), Se (editor scoped to EU-SE), Vi (viewer). B: Bo (admin).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8504-0000000000e1','ed@a.test'), ('00000000-0000-4000-8504-0000000000e2','se@a.test'),
  ('00000000-0000-4000-8504-0000000000f1','vi@a.test'), ('00000000-0000-4000-8504-0000000000b1','bo@b.test');
insert into app.people (id, user_id, display_name, email)
select ('10000000' || substr(u.id::text, 9))::uuid, u.id, split_part(u.email, '@', 1), u.email
from auth.users u where u.id::text like '00000000-0000-4000-8504-%';
insert into app.workspaces (id, name) values
  ('20000000-0000-4000-8504-00000000000a','Workspace A'), ('20000000-0000-4000-8504-00000000000b','Workspace B');
insert into app.memberships (workspace_id, person_id, role, scope_node_ids) values
  ('20000000-0000-4000-8504-00000000000a','10000000-0000-4000-8504-0000000000e1','editor', null),
  ('20000000-0000-4000-8504-00000000000a','10000000-0000-4000-8504-0000000000e2','editor', '{EU-SE}'),
  ('20000000-0000-4000-8504-00000000000a','10000000-0000-4000-8504-0000000000f1','viewer', null),
  ('20000000-0000-4000-8504-00000000000b','10000000-0000-4000-8504-0000000000b1','admin', null);
insert into app.families (id, workspace_id, name) values
  ('30000000-0000-4000-8504-00000000000a','20000000-0000-4000-8504-00000000000a','Cats'),
  ('30000000-0000-4000-8504-00000000000b','20000000-0000-4000-8504-00000000000b','Dogs');
insert into app.products (id, workspace_id, family_id, name, stage) values
  ('40000000-0000-4000-8504-0000000000a1','20000000-0000-4000-8504-00000000000a','30000000-0000-4000-8504-00000000000a','Cat adult','active'),
  ('40000000-0000-4000-8504-0000000000b1','20000000-0000-4000-8504-00000000000b','30000000-0000-4000-8504-00000000000b','Dog adult','active');
insert into app.product_nodes (product_id, node_id, workspace_id) values
  ('40000000-0000-4000-8504-0000000000a1','EU-SE','20000000-0000-4000-8504-00000000000a'),
  ('40000000-0000-4000-8504-0000000000a1','EU-DE','20000000-0000-4000-8504-00000000000a'),
  ('40000000-0000-4000-8504-0000000000b1','EU-SE','20000000-0000-4000-8504-00000000000b');
-- clean: only a clean document can be a registration's evidence (20261110102854_require_clean_evidence.sql)
insert into app.supplier_documents (id, workspace_id, doc_type, storage_path, file_sha256, uploaded_via, scan_status) values
  ('60000000-0000-4000-8504-0000000000a1','20000000-0000-4000-8504-00000000000a','registration_certificate',
   'documents/a/x.pdf', repeat('a', 64), 'member', 'clean'),
  ('60000000-0000-4000-8504-0000000000b1','20000000-0000-4000-8504-00000000000b','registration_certificate',
   'documents/b/x.pdf', repeat('b', 64), 'member', 'clean');

create function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.reg(p text, n text) returns text language sql as $$
  select registration_state from app.product_nodes where product_id = p::uuid and node_id = n
$$;
create function pg_temp.disp(p text, n text) returns text language sql as $$
  select display_state from app.product_nodes where product_id = p::uuid and node_id = n
$$;

-- ─── G01.must.1: obligation data is researched, sourced and dated, never generated ─────────────────────────────
select is((select count(*)::int from ref.obligations), 0,
          '[G01.must.1] no migration or seed ships obligation rows: obligation content only comes through acceptance');

-- ─── D06.must.1: unknown never displays as Clear; not registered renders Blocked (BE-14) ──────────────────────
select is(private.compute_registration_state('40000000-0000-4000-8504-0000000000a1', 'EU-SE'), 'unknown',
          '[D06.must.1] no registration and no obligation held leaves the state unknown, never not_required');
-- A label may be Clear only when its node is fully encoded under its pinned ruleset (non-negotiable 3; incident #179
-- makes the database downgrade anything else). A synthetic ruleset, rolled back with this test, has all six domains
-- complete for EU-SE, so the label states below are what is under test and not the coverage.
insert into ref.ruleset_versions (id, notes) values ('TEST-T504-ENCODED', 'synthetic pgTAP fixture (T-504), rolled back');
insert into ref.coverage_nodes (ruleset_version, node_id, domain, state)
select 'TEST-T504-ENCODED', 'EU-SE', d, 'complete'
from unnest(array['mandatory_particulars','composition','claims_wording','type_geometry','language','registration']) d;
update app.product_nodes set ruleset_version = 'TEST-T504-ENCODED', label_state = 'clear'
where product_id = '40000000-0000-4000-8504-0000000000a1' and node_id = 'EU-SE';
select is(pg_temp.disp('40000000-0000-4000-8504-0000000000a1', 'EU-SE'), 'not_assessed',
          '[D06.must.1] label clear with registration unknown displays not_assessed, never clear');
update app.product_nodes set registration_state = 'not_registered'
where product_id = '40000000-0000-4000-8504-0000000000a1' and node_id = 'EU-SE';
select is(pg_temp.disp('40000000-0000-4000-8504-0000000000a1', 'EU-SE'), 'blocked',
          '[D06.must.1] label clear with registration not_registered renders blocked');
update app.product_nodes set registration_state = 'expired'
where product_id = '40000000-0000-4000-8504-0000000000a1' and node_id = 'EU-SE';
select is(pg_temp.disp('40000000-0000-4000-8504-0000000000a1', 'EU-SE'), 'blocked',
          '[D06.must.1] label clear with registration expired renders blocked');
select is(private.refresh_registration_state('40000000-0000-4000-8504-0000000000a1', 'EU-SE'), 'unknown',
          '[D06.must.1] a refresh with nothing recorded and nothing sourced goes back to unknown, never clear');

-- A synthetic obligation that is sourced and dated but not accepted: it never sets the state (G01.must.1, #54 Q4).
insert into ref.obligations (node_id, kind, authority, source_url, last_verified_at)
values ('EU-DE', 'registration', 'SYNTHETIC TEST AUTHORITY', 'https://example.invalid/obligation', current_date);
select is(private.compute_registration_state('40000000-0000-4000-8504-0000000000a1', 'EU-DE'), 'unknown',
          '[G01.must.1] an obligation that is not accepted never sets registration_state');

-- ─── G03.main / D06.main: an editor records a registration; the state is recomputed in the same transaction ────
select pg_temp.as_user('00000000-0000-4000-8504-0000000000e1');
set local role authenticated;
select lives_ok($$ select app.record_registration('40000000-0000-4000-8504-0000000000a1', 'EU-SE', ' SE-123 ',
  current_date - 30, current_date + 335, '60000000-0000-4000-8504-0000000000a1') $$,
  '[G03.main] an editor records a registration with its number, dates and evidence document');
reset role;
select ok((select number = 'SE-123' and recorded_by = '10000000-0000-4000-8504-0000000000e1'
                  and evidence_doc_id = '60000000-0000-4000-8504-0000000000a1'
             from app.registrations where product_id = '40000000-0000-4000-8504-0000000000a1' and node_id = 'EU-SE'),
          '[G03.main] the row carries the number, the evidence document and who recorded it');
select is(pg_temp.reg('40000000-0000-4000-8504-0000000000a1', 'EU-SE'), 'registered',
          '[D06.main] a current recorded registration makes the state registered');
select is(pg_temp.disp('40000000-0000-4000-8504-0000000000a1', 'EU-SE'), 'clear',
          '[D06.main] label clear and registered displays clear');
select is((select count(*)::int from app.audit_events where kind = 'registration.recorded'
            and actor_id = '10000000-0000-4000-8504-0000000000e1'
            and before ->> 'registration_state' = 'unknown' and after ->> 'registration_state' = 'registered'),
          1, '[G03.main] the recording is audited with the state before and after');

-- A correction is a new row, and the latest wins: an expiry already passed makes it expired, and Blocked.
select pg_temp.as_user('00000000-0000-4000-8504-0000000000e1');
set local role authenticated;
select lives_ok($$ select app.record_registration('40000000-0000-4000-8504-0000000000a1', 'EU-SE', 'SE-123',
  current_date - 400, current_date - 1) $$, '[G03.main] a correction is recorded as a new row');
reset role;
select is(pg_temp.reg('40000000-0000-4000-8504-0000000000a1', 'EU-SE'), 'expired',
          '[D06.main] a registration whose expiry date has passed makes the state expired');
select is(pg_temp.disp('40000000-0000-4000-8504-0000000000a1', 'EU-SE'), 'blocked',
          '[D06.must.1] an expired registration renders blocked even with the label clear');

-- ─── Refusals ───────────────────────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-4000-8504-0000000000f1');
set local role authenticated;
select throws_ok($$ select app.record_registration('40000000-0000-4000-8504-0000000000a1', 'EU-DE', 'X', current_date) $$,
  '42501', null, '[G03.main] a viewer cannot record a registration');
reset role;
select pg_temp.as_user('00000000-0000-4000-8504-0000000000e2');
set local role authenticated;
select throws_ok($$ select app.record_registration('40000000-0000-4000-8504-0000000000a1', 'EU-DE', 'X', current_date) $$,
  '42501', null, '[G03.main] an editor scoped to EU-SE cannot record a registration for EU-DE');
select is((select count(*)::int from app.registrations where product_id = '40000000-0000-4000-8504-0000000000a1'
            and node_id = 'EU-DE'), 0, 'nothing was recorded for EU-DE');
reset role;
select pg_temp.as_user('00000000-0000-4000-8504-0000000000e1');
set local role authenticated;
select throws_ok($$ select app.record_registration('40000000-0000-4000-8504-0000000000a1', 'EU-DE', 'X', current_date,
  null, '60000000-0000-4000-8504-0000000000b1') $$,
  '22023', null, 'another workspace''s document cannot be the evidence');
select throws_ok($$ select app.record_registration('40000000-0000-4000-8504-0000000000a1', 'EU-DE', 'X', current_date,
  current_date - 1) $$, '22023', null, 'an expiry before the registration date is refused');
select throws_ok($$ select app.record_registration('40000000-0000-4000-8504-0000000000b1', 'EU-SE', 'X', current_date) $$,
  '42501', null, 'another workspace''s product is refused');
reset role;

-- ─── Market scope reads (#54 Q10): an editor scoped to EU-SE never reads EU-DE's registrations ────────────────
select pg_temp.as_user('00000000-0000-4000-8504-0000000000e1');
set local role authenticated;
select app.record_registration('40000000-0000-4000-8504-0000000000a1', 'EU-DE', 'DE-9', current_date);
reset role;
select pg_temp.as_user('00000000-0000-4000-8504-0000000000e2');
set local role authenticated;
select is((select array_agg(distinct node_id) from app.registrations), array['EU-SE']::text[],
          'a member scoped to EU-SE reads only EU-SE registrations');
reset role;
select pg_temp.as_user('00000000-0000-4000-8504-0000000000b1');
set local role authenticated;
select is((select count(*)::int from app.registrations), 0, 'another workspace reads none of these registrations');
reset role;

-- ─── G02.must.1: never build an endpoint that submits to an authority ───────────────────────────────────────────
-- Every function a client can call that writes registration data is exactly record_registration, which only stores
-- what the operator tells us. A new one must be added here on purpose, after asking whether it submits anywhere.
select is((select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('app', 'public')
              and (p.proname ~ '(registration|obligation|pack|submit|authority|filing)')
              and has_function_privilege('authenticated', p.oid, 'execute')),
          array['record_registration'],
          '[G02.must.1] no client-callable function submits, files or pays: only record_registration touches registrations');

select * from finish();
rollback;
