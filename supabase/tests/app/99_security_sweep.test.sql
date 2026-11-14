-- T-1103 · security sweep (#81), migration 20261114125818: certificates are issued only inside the signer's scope,
-- for the report's own market, and only for a market that displays Clear; certificates are read with market scope;
-- artwork uploads follow family scope. Synthetic rows only, rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(19);
set local client_min_messages = warning;

-- ─── A: Sam (admin, everything), Fay (editor scoped to family A1), Max (editor scoped to EU-DK). B: Bo (admin). ───
insert into auth.users (id, email) values
  ('00000000-0000-4000-8110-0000000000a1','sam@a.test'), ('00000000-0000-4000-8110-0000000000f1','fay@a.test'),
  ('00000000-0000-4000-8110-0000000000d1','max@a.test'), ('00000000-0000-4000-8110-0000000000b1','bo@b.test');
insert into app.people (id, user_id, display_name, email)
select ('10000000' || substr(u.id::text, 9))::uuid, u.id, split_part(u.email, '@', 1), u.email
from auth.users u where u.id::text like '00000000-0000-4000-8110-%';
insert into app.workspaces (id, name) values
  ('20000000-0000-4000-8110-00000000000a','Workspace A'), ('20000000-0000-4000-8110-00000000000b','Workspace B');
insert into app.allowances (workspace_id) values
  ('20000000-0000-4000-8110-00000000000a'), ('20000000-0000-4000-8110-00000000000b');
insert into app.families (id, workspace_id, name) values
  ('30000000-0000-4000-8110-0000000000a1','20000000-0000-4000-8110-00000000000a','Cats'),
  ('30000000-0000-4000-8110-0000000000a2','20000000-0000-4000-8110-00000000000a','Dogs'),
  ('30000000-0000-4000-8110-0000000000b1','20000000-0000-4000-8110-00000000000b','Birds');
insert into app.memberships (workspace_id, person_id, role, scope_family_ids, scope_node_ids) values
  ('20000000-0000-4000-8110-00000000000a','10000000-0000-4000-8110-0000000000a1','admin', null, null),
  ('20000000-0000-4000-8110-00000000000a','10000000-0000-4000-8110-0000000000f1','editor',
   '{30000000-0000-4000-8110-0000000000a1}', null),
  ('20000000-0000-4000-8110-00000000000a','10000000-0000-4000-8110-0000000000d1','editor', null, '{EU-DK}'),
  ('20000000-0000-4000-8110-00000000000b','10000000-0000-4000-8110-0000000000b1','admin', null, null);
insert into app.products (id, workspace_id, family_id, name, stage) values
  ('40000000-0000-4000-8110-0000000000a1','20000000-0000-4000-8110-00000000000a','30000000-0000-4000-8110-0000000000a1','Cat adult','active'),
  ('40000000-0000-4000-8110-0000000000a2','20000000-0000-4000-8110-00000000000a','30000000-0000-4000-8110-0000000000a2','Dog adult','active'),
  ('40000000-0000-4000-8110-0000000000b1','20000000-0000-4000-8110-00000000000b','30000000-0000-4000-8110-0000000000b1','Bird seed','active');
insert into app.signing_grants (id, workspace_id, person_id, node_id, granted_by) values
  ('50000000-0000-4000-8110-0000000000a1','20000000-0000-4000-8110-00000000000a','10000000-0000-4000-8110-0000000000a1','EU-DK','10000000-0000-4000-8110-0000000000a1'),
  ('50000000-0000-4000-8110-0000000000a2','20000000-0000-4000-8110-00000000000a','10000000-0000-4000-8110-0000000000a1','EU-SE','10000000-0000-4000-8110-0000000000a1'),
  ('50000000-0000-4000-8110-0000000000a3','20000000-0000-4000-8110-00000000000a','10000000-0000-4000-8110-0000000000a1','EU-FR','10000000-0000-4000-8110-0000000000a1'),
  ('50000000-0000-4000-8110-0000000000f1','20000000-0000-4000-8110-00000000000a','10000000-0000-4000-8110-0000000000f1','EU-DK','10000000-0000-4000-8110-0000000000a1'),
  ('50000000-0000-4000-8110-0000000000d1','20000000-0000-4000-8110-00000000000a','10000000-0000-4000-8110-0000000000d1','EU-SE','10000000-0000-4000-8110-0000000000a1');

-- Ruleset T1103-V: EU-DK and EU-SE have all six domains complete, so a clear label state survives verdict_guard.
insert into ref.ruleset_versions (id) values ('T1103-V');
insert into ref.coverage_nodes (ruleset_version, node_id, domain, state, rules_encoded, gap_id)
select 'T1103-V', n, d, 'complete', 1, null
from unnest(array['EU-DK','EU-SE']) n,
     unnest(array['mandatory_particulars','composition','claims_wording','type_geometry','language','registration']) d;
-- Cat adult: EU-DK clear and registered; EU-SE label clear but registration unknown (displays not_assessed);
-- EU-FR has no row. Dog adult: EU-DK clear and registered.
insert into app.product_nodes (product_id, node_id, workspace_id, label_state, registration_state, ruleset_version) values
  ('40000000-0000-4000-8110-0000000000a1','EU-DK','20000000-0000-4000-8110-00000000000a','clear','registered','T1103-V'),
  ('40000000-0000-4000-8110-0000000000a1','EU-SE','20000000-0000-4000-8110-00000000000a','clear','unknown','T1103-V'),
  ('40000000-0000-4000-8110-0000000000a2','EU-DK','20000000-0000-4000-8110-00000000000a','clear','registered','T1103-V');
insert into app.reports (id, workspace_id, product_id, node_id, ref, check_ids, ruleset_version, artwork_sha, has_not_assessed) values
  ('60000000-0000-4000-8110-0000000000a1','20000000-0000-4000-8110-00000000000a','40000000-0000-4000-8110-0000000000a1','EU-DK',
   'T1103REFAAAAAAAAAAAAAAAAA1','{}','T1103-V','sha',false),
  ('60000000-0000-4000-8110-0000000000a2','20000000-0000-4000-8110-00000000000a','40000000-0000-4000-8110-0000000000a2','EU-DK',
   'T1103REFAAAAAAAAAAAAAAAAA2','{}','T1103-V','sha',false),
  ('60000000-0000-4000-8110-0000000000a3','20000000-0000-4000-8110-00000000000a','40000000-0000-4000-8110-0000000000a1',null,
   'T1103REFAAAAAAAAAAAAAAAAA3','{}','T1103-V','sha',true),
  ('60000000-0000-4000-8110-0000000000a4','20000000-0000-4000-8110-00000000000a','40000000-0000-4000-8110-0000000000a1','EU-SE',
   'T1103REFAAAAAAAAAAAAAAAAA4','{}','T1103-V','sha',true);

create function pg_temp.as_user(uid text, aal text default 'aal2') returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true);
$$;

-- ─── 1 · issue_certificate: scope, the report's market, and only a market that displays Clear ────────────────────
select pg_temp.as_user('00000000-0000-4000-8110-0000000000f1');
set local role authenticated;
select throws_ok($$select app.issue_certificate('60000000-0000-4000-8110-0000000000a2', 'EU-DK')$$,
                 'P0002', 'report not found',
                 '[T-1103] a family-scoped signer cannot certify a product outside their families, and learns nothing');
reset role;

select pg_temp.as_user('00000000-0000-4000-8110-0000000000d1');
set local role authenticated;
select throws_ok($$select app.issue_certificate('60000000-0000-4000-8110-0000000000a4', 'EU-SE')$$,
                 'P0291', null, '[T-1103] a market-scoped signer cannot certify a market outside their scope, grant or not');
reset role;

select pg_temp.as_user('00000000-0000-4000-8110-0000000000a1');
set local role authenticated;
select throws_ok($$select app.issue_certificate('60000000-0000-4000-8110-0000000000a1', 'EU-SE')$$,
                 '22023', null, '[T-1103] a report for EU-DK is never certified for another market');
select throws_ok($$select app.issue_certificate('60000000-0000-4000-8110-0000000000a4', 'EU-SE')$$,
                 'P0293', null,
                 '[T-1103] a market whose registration is unknown displays not assessed and is never certified (non-negotiable 8)');
select throws_ok($$select app.issue_certificate('60000000-0000-4000-8110-0000000000a3', 'EU-FR')$$,
                 'P0293', null, '[T-1103] a market with no state at all is not assessed and is never certified (non-negotiable 3)');
reset role;
select pg_temp.as_user('00000000-0000-4000-8110-0000000000a1', 'aal1');
set local role authenticated;
select throws_ok($$select app.issue_certificate('60000000-0000-4000-8110-0000000000a1', 'EU-DK')$$,
                 'P0292', null, '[T-1103] two-factor is still required before the market state is looked at');
reset role;
select pg_temp.as_user('00000000-0000-4000-8110-0000000000a1');
set local role authenticated;
select ok(app.issue_certificate('60000000-0000-4000-8110-0000000000a1', 'EU-DK') is not null,
          '[T-1103] a signer in scope certifies the report''s own Clear market');
select ok(app.issue_certificate('60000000-0000-4000-8110-0000000000a3', 'EU-DK') is not null,
          '[T-1103] a report with no market of its own is certified for a Clear market of its product');
reset role;
select pg_temp.as_user('00000000-0000-4000-8110-0000000000f1');
set local role authenticated;
select ok(app.issue_certificate('60000000-0000-4000-8110-0000000000a1', 'EU-DK') is not null,
          '[T-1103] a family-scoped signer still certifies a product in their family');
reset role;

-- ─── 2 · certificates are read with market scope ─────────────────────────────────────────────────────────────────
-- A certificate for EU-SE written before this sweep (insert-only rows stay; reads now follow the market).
insert into app.certificates (workspace_id, report_id, product_id, node_id, signer_id, grant_id, prev_hash, hash) values
  ('20000000-0000-4000-8110-00000000000a','60000000-0000-4000-8110-0000000000a4','40000000-0000-4000-8110-0000000000a1',
   'EU-SE','10000000-0000-4000-8110-0000000000a1','50000000-0000-4000-8110-0000000000a2', null, 'legacy-hash');
select pg_temp.as_user('00000000-0000-4000-8110-0000000000a1');
set local role authenticated;
select is((select count(*)::int from app.certificates), 4, '[T-1103] an unscoped member reads every certificate of the workspace');
reset role;
select pg_temp.as_user('00000000-0000-4000-8110-0000000000d1');
set local role authenticated;
select is((select array_agg(distinct node_id) from app.certificates), array['EU-DK'],
          '[T-1103] a market-scoped member reads certificates for their own markets only');
reset role;
select pg_temp.as_user('00000000-0000-4000-8110-0000000000f1');
set local role authenticated;
select is((select count(*)::int from app.certificates where product_id <> '40000000-0000-4000-8110-0000000000a1'), 0,
          '[T-1103] a family-scoped member reads no certificate of another family''s product');
reset role;
select pg_temp.as_user('00000000-0000-4000-8110-0000000000b1');
set local role authenticated;
select is((select count(*)::int from app.certificates), 0, '[T-1103] another workspace reads no certificate');
reset role;

-- ─── 3 · artwork uploads follow family scope ─────────────────────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-4000-8110-0000000000f1');
set local role authenticated;
select lives_ok($$insert into storage.objects (bucket_id, name) values
                  ('artwork', '20000000-0000-4000-8110-00000000000a/40000000-0000-4000-8110-0000000000a1/' || repeat('a', 64) || '.pdf')$$,
                '[T-1103] a family-scoped editor uploads artwork for a product in their family');
select throws_ok($$insert into storage.objects (bucket_id, name) values
                  ('artwork', '20000000-0000-4000-8110-00000000000a/40000000-0000-4000-8110-0000000000a2/' || repeat('b', 64) || '.pdf')$$,
                 '42501', null, '[T-1103] a family-scoped editor cannot upload under another family''s product');
select throws_ok($$insert into storage.objects (bucket_id, name) values
                  ('artwork', '20000000-0000-4000-8110-00000000000a/stray.pdf')$$,
                 '42501', null, '[T-1103] no upload outside a product folder');
select ok(not private.can_upload_artwork('20000000-0000-4000-8110-00000000000b/40000000-0000-4000-8110-0000000000a1/x.pdf')
          and not private.can_upload_artwork('not-a-uuid/also-not/x.pdf') and not private.can_upload_artwork(''),
          '[T-1103] a product under another workspace''s folder, or a malformed path, is refused without an error');
reset role;
select pg_temp.as_user('00000000-0000-4000-8110-0000000000a1');
set local role authenticated;
select ok(private.can_upload_artwork('20000000-0000-4000-8110-00000000000a/40000000-0000-4000-8110-0000000000a2/x.pdf'),
          '[T-1103] an unscoped editor still uploads for every product of the workspace');
reset role;
select ok(not has_function_privilege('anon', 'private.can_upload_artwork(text)', 'execute')
          and not has_function_privilege('anon', 'app.issue_certificate(uuid,text)', 'execute'),
          '[T-1103] anon executes neither the upload check nor issue_certificate');

select * from finish();
rollback;
