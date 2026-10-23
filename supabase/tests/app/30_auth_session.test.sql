-- T-103 · Sign-in and password access events (A02, A07), app.my_ended_access (S-REC-004), signing at aal2.
-- Supabase Auth's own writes are imitated here: a row in auth.sessions per sign-in, an update of
-- auth.users.encrypted_password per password change.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(24);
set local client_min_messages = warning;

-- ─── Workspaces A and B. Alice admins A, Carl edits A and B and signs for EU-SE in A, Erin's access to A has
-- expired, Rhea was removed from A, Sam has never been in A. Tina's person row is tombstoned. ────────────────────
insert into auth.users (id, email, encrypted_password) values
  ('00000000-0000-4000-8103-0000000000a1','alice@a.test','$2a$10$alice-old-hash'),
  ('00000000-0000-4000-8103-0000000000c1','carl@a.test','$2a$10$carl-old-hash'),
  ('00000000-0000-4000-8103-0000000000e1','erin@a.test','$2a$10$erin-old-hash'),
  ('00000000-0000-4000-8103-0000000000f1','rhea@a.test','$2a$10$rhea-old-hash'),
  ('00000000-0000-4000-8103-0000000000b1','sam@b.test','$2a$10$sam-old-hash');
insert into app.people (id, user_id, display_name, email)
select ('10000000' || substr(u.id::text, 9))::uuid, u.id, initcap(split_part(u.email, '@', 1)) || ' Test', u.email
from auth.users u where u.id::text like '00000000-0000-4000-8103-%';
insert into app.workspaces (id, name, created_by) values
  ('20000000-0000-4000-8103-00000000000a','Workspace A','10000000-0000-4000-8103-0000000000a1'),
  ('20000000-0000-4000-8103-00000000000b','Workspace B',null);
insert into app.memberships (id, workspace_id, person_id, role, is_external, access_ends_at, ended_at, ended_reason, created_at) values
  ('50000000-0000-4000-8103-0000000000a1','20000000-0000-4000-8103-00000000000a','10000000-0000-4000-8103-0000000000a1','admin',false,null,null,null,'2025-06-01 09:00+00'),
  ('50000000-0000-4000-8103-0000000000c1','20000000-0000-4000-8103-00000000000a','10000000-0000-4000-8103-0000000000c1','editor',false,null,null,null,'2025-06-01 09:00+00'),
  ('50000000-0000-4000-8103-0000000000c2','20000000-0000-4000-8103-00000000000b','10000000-0000-4000-8103-0000000000c1','viewer',true,null,null,null,'2025-06-01 09:00+00'),
  ('50000000-0000-4000-8103-0000000000e1','20000000-0000-4000-8103-00000000000a','10000000-0000-4000-8103-0000000000e1','viewer',true,'2026-01-31 12:00+00',null,null,'2025-06-01 09:00+00'),
  ('50000000-0000-4000-8103-0000000000f1','20000000-0000-4000-8103-00000000000a','10000000-0000-4000-8103-0000000000f1','editor',false,null,'2026-02-28 09:00+00','removed by an admin','2025-06-01 09:00+00'),
  ('50000000-0000-4000-8103-0000000000b1','20000000-0000-4000-8103-00000000000b','10000000-0000-4000-8103-0000000000b1','admin',false,null,null,null,'2025-06-01 09:00+00');
insert into app.families (id, workspace_id, name) values
  ('30000000-0000-4000-8103-00000000000a','20000000-0000-4000-8103-00000000000a','Family A');
insert into app.products (id, workspace_id, family_id, name) values
  ('40000000-0000-4000-8103-00000000000a','20000000-0000-4000-8103-00000000000a','30000000-0000-4000-8103-00000000000a','Product A');
insert into app.signing_grants (workspace_id, person_id, node_id, granted_by) values
  ('20000000-0000-4000-8103-00000000000a','10000000-0000-4000-8103-0000000000c1','EU-SE','10000000-0000-4000-8103-0000000000a1');
insert into app.reports (workspace_id, product_id, node_id, ref, check_ids, ruleset_version, artwork_sha, has_not_assessed)
values ('20000000-0000-4000-8103-00000000000a','40000000-0000-4000-8103-00000000000a','EU-SE',
        'nv-t103-reference-0000000001','{}','0000.00-empty','sha-t103',true);

-- ─── A02.main · a sign-in is audited once per active workspace, at the level it started ─────────────────────
insert into auth.sessions (id, user_id, aal, created_at)
values ('60000000-0000-4000-8103-0000000000c1','00000000-0000-4000-8103-0000000000c1','aal1',now());
select is((select array_agg(workspace_id::text || ':' || actor_is_external::text order by workspace_id)
           from app.audit_events where kind = 'session.started' and object_id = '60000000-0000-4000-8103-0000000000c1'),
          array['20000000-0000-4000-8103-00000000000a:false','20000000-0000-4000-8103-00000000000b:true'],
          '[A02.main] a sign-in writes session.started to each of the person''s active workspaces, external flag stamped');
select ok((select bool_and(actor_id = '10000000-0000-4000-8103-0000000000c1' and object_type = 'session'
                           and after = '{"aal":"aal1"}'::jsonb and before is null)
           from app.audit_events where kind = 'session.started' and object_id = '60000000-0000-4000-8103-0000000000c1'),
          '[A02.main] session.started names the person and the assurance level, and nothing else');
insert into auth.sessions (id, user_id, aal, created_at)
values ('60000000-0000-4000-8103-0000000000e1','00000000-0000-4000-8103-0000000000e1','aal1',now()),
       ('60000000-0000-4000-8103-0000000000f1','00000000-0000-4000-8103-0000000000f1','aal1',now());
select is((select count(*)::int from app.audit_events where kind = 'session.started'
           and object_id in ('60000000-0000-4000-8103-0000000000e1','60000000-0000-4000-8103-0000000000f1')), 0,
          '[A02.must.1] a sign-in by someone whose access expired or ended is audited in no workspace');
select ok(exists (select 1 from auth.sessions where id = '60000000-0000-4000-8103-0000000000f1'),
          '[A02.main] the audit never stands in the way of the sign-in itself');
select ok(not has_function_privilege('authenticated', 'private.audit_session_started()', 'execute')
          and not has_function_privilege('anon', 'private.audit_password_changed()', 'execute')
          and not has_function_privilege('authenticated', 'private.active_workspaces_of(uuid)', 'execute'),
          '[A02.main] the audit triggers cannot be called by a client, so access events cannot be forged');

-- ─── A02.must.1 · an expired or ended membership gives no access (BE-03) ──────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8103-0000000000e1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*)::int from app.workspaces), 0, '[A02.must.1] an expired membership reads no workspace');
select is((select count(*)::int from app.products), 0, '[A02.must.1] an expired membership reads no product');
select is((select count(*)::int from app.memberships), 0, '[A02.must.1] an expired membership reads no membership');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8103-0000000000f1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*)::int from app.workspaces) + (select count(*)::int from app.products)
          + (select count(*)::int from app.reports), 0, '[A02.must.1] an ended membership reads nothing in the workspace');

-- ─── A02.fail.1 · the Access removed page reads its name, date and admin, and nothing more ───────────────────
select is(app.my_ended_access('20000000-0000-4000-8103-00000000000a'),
          jsonb_build_object('workspace_name','Workspace A','ended_on','2026-02-28 09:00+00'::timestamptz,
                             'admin_name','Alice Test','admin_email','alice@a.test'),
          '[A02.fail.1] a removed member reads the workspace name, the day access ended and the admin to ask');
reset role;
-- Bob becomes an admin of A after Rhea left, and Alice steps down: Rhea is never told about Bob.
insert into app.memberships (workspace_id, person_id, role)
values ('20000000-0000-4000-8103-00000000000a','10000000-0000-4000-8103-0000000000b1','admin');
update app.memberships set role = 'editor' where id = '50000000-0000-4000-8103-0000000000a1';
set local role authenticated;
select ok((app.my_ended_access('20000000-0000-4000-8103-00000000000a') ->> 'admin_email') is null
          and (app.my_ended_access('20000000-0000-4000-8103-00000000000a') ->> 'workspace_name') = 'Workspace A',
          '[A02.fail.1] an admin appointed after access ended is never named: no new name or email reaches a former member');
reset role;
update app.memberships set role = 'admin' where id = '50000000-0000-4000-8103-0000000000a1';
delete from app.memberships where workspace_id = '20000000-0000-4000-8103-00000000000a'
  and person_id = '10000000-0000-4000-8103-0000000000b1';
set local role authenticated;
select is(app.my_ended_access('20000000-0000-4000-8103-00000000000a') ->> 'admin_name', 'Alice Test',
          '[A02.fail.1] the admin named is one who was in the workspace while the person was');
select ok(not (app.my_ended_access('20000000-0000-4000-8103-00000000000a') ? 'ended_reason'),
          '[A02.fail.1] it never says whether an admin removed them or an end date passed');
select is(app.my_ended_access('20000000-0000-4000-8103-00000000000b'), null,
          '[A02.fail.1] a workspace the person never belonged to returns nothing, as for a stranger');
select is(app.my_ended_access('20000000-0000-4000-8103-0000000000ff'), null,
          '[A02.fail.1] a workspace that does not exist reads the same as one the person never joined');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8103-0000000000e1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is(app.my_ended_access('20000000-0000-4000-8103-00000000000a') ->> 'ended_on',
          to_jsonb('2026-01-31 12:00+00'::timestamptz) #>> '{}',
          '[A02.fail.1] an expired end date reads as the day access ended');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8103-0000000000c1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is(app.my_ended_access('20000000-0000-4000-8103-00000000000a'), null,
          '[A02.fail.1] an active member gets nothing from it: the workspace itself serves them');
reset role;
select ok(not has_function_privilege('anon', 'app.my_ended_access(uuid)', 'execute')
          and has_function_privilege('authenticated', 'app.my_ended_access(uuid)', 'execute'),
          '[A02.fail.1] my_ended_access is for signed-in people only');

-- ─── A02.must.2 · signing always requires aal2 ───────────────────────────────────────────────────────────
set local role authenticated;
select throws_ok($$select app.issue_certificate((select id from app.reports where ref = 'nv-t103-reference-0000000001'), 'EU-SE')$$,
                 'P0292', null, '[A02.must.2] a signer with a grant at aal1 cannot sign: two-factor is required');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8103-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select app.issue_certificate((select id from app.reports where ref = 'nv-t103-reference-0000000001'), 'EU-SE')$$,
                 'P0292', null, '[A02.must.2] a token without an assurance level is treated as aal1');
reset role;

-- ─── A07 · a password change is an access event; the secret never reaches the audit ────────────────────────
update auth.users set encrypted_password = '$2a$10$carl-new-hash' where id = '00000000-0000-4000-8103-0000000000c1';
select is((select count(*)::int from app.audit_events where kind = 'access.password_changed'
           and actor_id = '10000000-0000-4000-8103-0000000000c1'), 2,
          '[A07.main] a password change is audited in each of the person''s active workspaces');
select ok((select bool_and(before is null and after is null and object_id = '10000000-0000-4000-8103-0000000000c1')
           from app.audit_events where kind = 'access.password_changed'
             and workspace_id in ('20000000-0000-4000-8103-00000000000a','20000000-0000-4000-8103-00000000000b')),
          '[A07.must.1] the password audit row holds no before or after, only the person');
select is((select count(*)::int from app.audit_events
           where workspace_id in ('20000000-0000-4000-8103-00000000000a','20000000-0000-4000-8103-00000000000b')
             and coalesce(before::text, '') || coalesce(after::text, '') || coalesce(object_id, '') ~ 'hash|\$2a\$|password'), 0,
          '[A07.must.1] no password, hash or secret appears anywhere in the audit');
update auth.users set email = 'carl+renamed@a.test' where id = '00000000-0000-4000-8103-0000000000c1';
select is((select count(*)::int from app.audit_events where kind = 'access.password_changed'
           and actor_id = '10000000-0000-4000-8103-0000000000c1'), 2,
          '[A07.main] an update that leaves the password alone records no password change');

select * from finish();
rollback;
