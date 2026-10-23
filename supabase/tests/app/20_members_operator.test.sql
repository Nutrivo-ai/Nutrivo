-- T-104 · app.change_member (A05), app.remove_member (A06), app.revoke_invitation (A03), app.set_default_operator (B01).
-- Every write is an admin's, inside their own workspace, audited, and refused across workspaces.
-- B01 runs against the demo seed (T-013), loaded and rolled back like 10_demo_seed.test.sql.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(54);
set local client_min_messages = warning;

-- ─── Workspace A: Alice (admin), Carl and Dan (editors with signing grants), Vera and Wynn (viewers). B: Bob. ──
insert into auth.users (id, email) values
  ('00000000-0000-4000-8104-0000000000a1','alice@a.test'), ('00000000-0000-4000-8104-0000000000c1','carl@a.test'),
  ('00000000-0000-4000-8104-0000000000d1','dan@a.test'),   ('00000000-0000-4000-8104-0000000000f1','vera@a.test'),
  ('00000000-0000-4000-8104-0000000000e1','wynn@a.test'),  ('00000000-0000-4000-8104-0000000000b1','bob@b.test');
insert into app.people (id, user_id, display_name, email)
select ('10000000' || substr(u.id::text, 9))::uuid, u.id, split_part(u.email, '@', 1), u.email
from auth.users u where u.id::text like '00000000-0000-4000-8104-%';
insert into app.workspaces (id, name) values
  ('20000000-0000-4000-8104-00000000000a','Workspace A'), ('20000000-0000-4000-8104-00000000000b','Workspace B');
insert into app.memberships (id, workspace_id, person_id, role) values
  ('50000000-0000-4000-8104-0000000000a1','20000000-0000-4000-8104-00000000000a','10000000-0000-4000-8104-0000000000a1','admin'),
  ('50000000-0000-4000-8104-0000000000c1','20000000-0000-4000-8104-00000000000a','10000000-0000-4000-8104-0000000000c1','editor'),
  ('50000000-0000-4000-8104-0000000000d1','20000000-0000-4000-8104-00000000000a','10000000-0000-4000-8104-0000000000d1','editor'),
  ('50000000-0000-4000-8104-0000000000f1','20000000-0000-4000-8104-00000000000a','10000000-0000-4000-8104-0000000000f1','viewer'),
  ('50000000-0000-4000-8104-0000000000e1','20000000-0000-4000-8104-00000000000a','10000000-0000-4000-8104-0000000000e1','viewer'),
  ('50000000-0000-4000-8104-0000000000b1','20000000-0000-4000-8104-00000000000b','10000000-0000-4000-8104-0000000000b1','admin');
insert into app.families (id, workspace_id, name) values
  ('30000000-0000-4000-8104-00000000000a','20000000-0000-4000-8104-00000000000a','Family A'),
  ('30000000-0000-4000-8104-00000000000b','20000000-0000-4000-8104-00000000000b','Family B');
insert into app.products (id, workspace_id, family_id, name) values
  ('40000000-0000-4000-8104-00000000000a','20000000-0000-4000-8104-00000000000a','30000000-0000-4000-8104-00000000000a','Product A');
insert into app.signing_grants (workspace_id, person_id, node_id, granted_by) values
  ('20000000-0000-4000-8104-00000000000a','10000000-0000-4000-8104-0000000000c1','EU-SE','10000000-0000-4000-8104-0000000000a1'),
  ('20000000-0000-4000-8104-00000000000a','10000000-0000-4000-8104-0000000000d1','EU-DE','10000000-0000-4000-8104-0000000000a1');
-- Three editor seats, all taken by Alice, Carl and Dan.
insert into app.subscriptions (workspace_id, plan, status, editor_seats)
values ('20000000-0000-4000-8104-00000000000a','basic','active',3);

select ok(not has_function_privilege('anon', 'app.change_member(uuid,text,boolean,uuid[],text[],timestamptz)', 'execute')
          and not has_function_privilege('anon', 'app.remove_member(uuid,text)', 'execute')
          and not has_function_privilege('anon', 'app.revoke_invitation(uuid)', 'execute')
          and not has_function_privilege('anon', 'app.set_default_operator(uuid,jsonb)', 'execute')
          and has_function_privilege('authenticated', 'app.change_member(uuid,text,boolean,uuid[],text[],timestamptz)', 'execute'),
          '[T-104] the four RPCs are executable by authenticated users and never by anon');

-- ─── A05 · change a role, scope or end date ─────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8104-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select app.change_member('50000000-0000-4000-8104-0000000000e1', 'editor', false, null, null, null)$$,
                 'P0033', null, '[A05.fail.2] promoting a viewer to editor with no seat left is refused for the upsell');
select lives_ok($$select app.change_member('50000000-0000-4000-8104-0000000000c1', 'editor', false,
                    '{30000000-0000-4000-8104-00000000000a}', '{EU-SE}', now() + interval '30 days')$$,
                '[A05.main] an admin changes an editor''s scope and end date; a seat already held needs no new one');
reset role;
select is((select role from app.memberships where id = '50000000-0000-4000-8104-0000000000e1'), 'viewer',
          '[A05.fail.2] the refused promotion leaves the viewer a viewer');
select ok((select scope_family_ids = '{30000000-0000-4000-8104-00000000000a}' and scope_node_ids = '{EU-SE}'
                  and access_ends_at = now() + interval '30 days'
           from app.memberships where id = '50000000-0000-4000-8104-0000000000c1'),
          '[A05.main] the membership carries the new scope and end date');
select ok((select before ->> 'scope_family_ids' is null
                  and after -> 'scope_family_ids' = '["30000000-0000-4000-8104-00000000000a"]'::jsonb
                  and actor_id = '10000000-0000-4000-8104-0000000000a1'
           from app.audit_events where kind = 'membership.changed' and object_id = '50000000-0000-4000-8104-0000000000c1'),
          '[A05.main] the change is audited with before and after values and the acting admin');

update app.subscriptions set editor_seats = 10 where workspace_id = '20000000-0000-4000-8104-00000000000a';
set local role authenticated;
select lives_ok($$select app.change_member('50000000-0000-4000-8104-0000000000f1', 'admin', false, null, null, null)$$,
                '[A05.must.2] an admin promotes a viewer to admin once a seat is free');
reset role;
select is((select count(*)::int from app.signing_grants where person_id = '10000000-0000-4000-8104-0000000000f1')
          || '/' || (select count(*)::int from app.signing_grants where revoked_at is null
                     and workspace_id = '20000000-0000-4000-8104-00000000000a'),
          '0/2', '[A05.must.2] a role change grants no signing authority (BE-04)');

set local role authenticated;
select app.change_member('50000000-0000-4000-8104-0000000000c1', 'editor', true,
                         '{30000000-0000-4000-8104-00000000000a}', '{EU-SE}', now() + interval '30 days');
reset role;
select ok((select count(*) = 1 and bool_and(revoked_at = now() and revoked_by = '10000000-0000-4000-8104-0000000000a1')
           from app.signing_grants where person_id = '10000000-0000-4000-8104-0000000000c1'),
          '[A05.must.3] becoming external revokes the signing grant in the same transaction, by the acting admin');
select is((select (after ->> 'signing_grants_revoked')::int from app.audit_events
           where kind = 'membership.changed' and object_id = '50000000-0000-4000-8104-0000000000c1'
             and (after ->> 'is_external')::boolean),
          1, '[A05.must.3] the audit event records the revoked grant');

-- Last admin. Vera becomes a viewer again; Alice is then the only admin.
set local role authenticated;
select lives_ok($$select app.change_member('50000000-0000-4000-8104-0000000000f1', 'viewer', false, null, null, null)$$,
                '[A05.must.1] an admin can be demoted while another admin with no end date remains');
select throws_ok($$select app.change_member('50000000-0000-4000-8104-0000000000a1', 'editor', false, null, null, null)$$,
                 'P0043', null, '[A05.fail.1] the last admin demoting themselves is refused');
select throws_ok($$select app.change_member('50000000-0000-4000-8104-0000000000a1', 'admin', false, null, null,
                                             now() + interval '1 day')$$,
                 'P0043', null, '[A05.must.1] the last admin cannot be given an end date');
select lives_ok($$select app.change_member('50000000-0000-4000-8104-0000000000f1', 'admin', false, null, null,
                                            now() + interval '7 days')$$,
                '[A05.must.1] a second admin can be added with an end date');
select throws_ok($$select app.change_member('50000000-0000-4000-8104-0000000000a1', 'portfolio_manager', false, null, null, null)$$,
                 'P0043', null, '[A05.must.1] an admin whose access ends does not count as the admin who remains');
reset role;
select is((select role from app.memberships where id = '50000000-0000-4000-8104-0000000000a1'), 'admin',
          '[A05.fail.1] the refused demotion leaves the last admin an admin');

-- Permission, tenancy and arguments.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8104-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select app.change_member('50000000-0000-4000-8104-0000000000e1', 'editor', false, null, null, null)$$,
                 '42501', null, '[T-104] an editor cannot change a member');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8104-0000000000b1","role":"authenticated"}', true);
select throws_ok($$select app.change_member('50000000-0000-4000-8104-0000000000e1', 'viewer', false, null, null, null)$$,
                 '42501', null, '[T-104] an admin of another workspace cannot change this workspace''s members');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8104-0000000000a1","role":"authenticated"}', true);
select throws_ok($$select app.change_member('50000000-0000-4000-8104-0000000000b1', 'viewer', false, null, null, null)$$,
                 '42501', null, '[T-104] an admin cannot change a member of a workspace they do not administer');
select throws_ok($$select app.change_member('50000000-0000-4000-8104-0000000000e1', 'viewer', false,
                                             '{30000000-0000-4000-8104-00000000000b}', null, null)$$,
                 '22023', null, '[T-104] a scope cannot name another workspace''s family');
select throws_ok($$select app.change_member('50000000-0000-4000-8104-0000000000e1', 'viewer', false, null, null,
                                             now() - interval '1 day')$$,
                 '22023', null, '[T-104] an end date in the past is refused (removal is its own action)');
reset role;
create temp table audit_n on commit drop as select count(*) as n from app.audit_events;
set local role authenticated;
select app.change_member('50000000-0000-4000-8104-0000000000e1', 'viewer', false, null, null, null);
reset role;
select is((select count(*) from app.audit_events), (select n from audit_n),
          '[T-104] resubmitting a membership unchanged writes nothing');

-- ─── A06 · remove a member ───────────────────────────────────────────────────────────────────────────
-- Dan acts before he is removed; his event is kept to compare afterwards.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8104-0000000000d1","role":"authenticated"}', true);
select private.write_audit('20000000-0000-4000-8104-00000000000a', 'test.before_removal', 'product',
                           '40000000-0000-4000-8104-00000000000a');
create temp table dan_event on commit drop as
  select to_jsonb(a) as row from app.audit_events a where a.kind = 'test.before_removal';

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8104-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select app.remove_member('50000000-0000-4000-8104-0000000000d1', '  Left the company ')$$,
                '[A06.main] an admin removes a member with a reason');
reset role;
select ok((select ended_at = now() and ended_reason = 'Left the company'
           from app.memberships where id = '50000000-0000-4000-8104-0000000000d1'),
          '[A06.main] the membership is ended with the reason, and the row is kept');
select ok((select count(*) = 1 and bool_and(status = 'queued' and workspace_id = '20000000-0000-4000-8104-00000000000a'
                  and payload = jsonb_build_object('membership_id', '50000000-0000-4000-8104-0000000000d1',
                                                   'person_id', '10000000-0000-4000-8104-0000000000d1'))
           from app.jobs where kind = 'session_revoke'),
          '[A06.main] one session_revoke job signs the person out, and its payload holds ids only');
select ok((select before ->> 'ended_at' is null and after ->> 'ended_reason' = 'Left the company'
                  and actor_id = '10000000-0000-4000-8104-0000000000a1'
           from app.audit_events where kind = 'membership.ended' and object_id = '50000000-0000-4000-8104-0000000000d1'),
          '[A06.main] the removal is audited with before and after values');
select ok((select bool_and(revoked_at is not null) from app.signing_grants
           where person_id = '10000000-0000-4000-8104-0000000000d1'),
          '[A06.main] the removed member''s signing grants are revoked');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8104-0000000000d1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from app.workspaces) + (select count(*)::int from app.memberships)
          + (select count(*)::int from app.products) + (select count(*)::int from app.signing_grants),
          0, '[A06.must.2] access ends on the next request: the removed member reads nothing of the workspace');
select throws_ok($$select app.request_check('40000000-0000-4000-8104-00000000000a')$$,
                 '42501', null, '[A06.must.2] the removed member can no longer write either');
reset role;
select is((select to_jsonb(a) from app.audit_events a where a.kind = 'test.before_removal'), (select row from dan_event),
          '[A06.must.1] an event the member wrote before removal reads exactly as before (BE-06)');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8104-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is((select display_name from app.people where id = '10000000-0000-4000-8104-0000000000d1'), 'dan',
          '[A06.must.1] colleagues still see who the former member was');
reset role;

create temp table removal_n on commit drop as
  select (select count(*) from app.audit_events) || '/' || (select count(*) from app.jobs) as n;
set local role authenticated;
select lives_ok($$select app.remove_member('50000000-0000-4000-8104-0000000000d1', 'again')$$,
                '[T-104] removing an ended membership again succeeds');
reset role;
select is((select count(*) from app.audit_events) || '/' || (select count(*) from app.jobs), (select n from removal_n),
          '[T-104] removing an ended membership again changes nothing');

set local role authenticated;
select throws_ok($$select app.remove_member('50000000-0000-4000-8104-0000000000a1', 'leaving')$$,
                 'P0043', null, '[A06.fail.1] removing the last admin is refused');
reset role;
select ok((select ended_at is null from app.memberships where id = '50000000-0000-4000-8104-0000000000a1'),
          '[A06.fail.1] the refused removal leaves the last admin a member');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8104-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select app.remove_member('50000000-0000-4000-8104-0000000000e1')$$,
                 '42501', null, '[T-104] a non-admin cannot remove a member');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8104-0000000000b1","role":"authenticated"}', true);
select throws_ok($$select app.remove_member('50000000-0000-4000-8104-0000000000e1')$$,
                 '42501', null, '[T-104] an admin of another workspace cannot remove this workspace''s members');
reset role;

-- ─── A03 · revoke an invitation ──────────────────────────────────────────────────────────────────────
insert into app.invitations (id, workspace_id, email, role, invited_by) values
  ('60000000-0000-4000-8104-000000000001','20000000-0000-4000-8104-00000000000a','new@a.test','editor',
   '10000000-0000-4000-8104-0000000000a1'),
  ('60000000-0000-4000-8104-000000000002','20000000-0000-4000-8104-00000000000a','taken@a.test','viewer',
   '10000000-0000-4000-8104-0000000000a1');
update app.invitations set accepted_at = now() where id = '60000000-0000-4000-8104-000000000002';
insert into app.jobs (kind, workspace_id, idempotency_key, payload)
values ('notify','20000000-0000-4000-8104-00000000000a','invite:60000000-0000-4000-8104-000000000001',
        '{"template":"invitation","invitation_id":"60000000-0000-4000-8104-000000000001"}');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8104-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select app.revoke_invitation('60000000-0000-4000-8104-000000000001')$$,
                 '42501', null, '[T-104] an admin of another workspace cannot revoke this workspace''s invitation');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8104-0000000000c1","role":"authenticated"}', true);
select throws_ok($$select app.revoke_invitation('60000000-0000-4000-8104-000000000001')$$,
                 '42501', null, '[T-104] a non-admin cannot revoke an invitation');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8104-0000000000a1","role":"authenticated"}', true);
select lives_ok($$select app.revoke_invitation('60000000-0000-4000-8104-000000000001')$$,
                '[T-104] an admin revokes a pending invitation');
reset role;
select ok((select revoked_at = now() from app.invitations where id = '60000000-0000-4000-8104-000000000001')
          and (select status = 'cancelled' from app.jobs where idempotency_key = 'invite:60000000-0000-4000-8104-000000000001')
          and exists (select 1 from app.audit_events where kind = 'invitation.revoked'
                      and object_id = '60000000-0000-4000-8104-000000000001'),
          '[T-104] the invitation is revoked, its unsent email cancelled and the revocation audited');
create temp table revoke_n on commit drop as select count(*) as n from app.audit_events;
set local role authenticated;
select app.revoke_invitation('60000000-0000-4000-8104-000000000001');
reset role;
select is((select count(*) from app.audit_events), (select n from revoke_n),
          '[T-104] revoking an invitation twice changes nothing');
set local role authenticated;
select throws_ok($$select app.revoke_invitation('60000000-0000-4000-8104-000000000002')$$,
                 'P0040', null, '[T-104] an accepted invitation cannot be revoked');
select lives_ok($$select app.invite_member('20000000-0000-4000-8104-00000000000a', 'new@a.test', 'viewer')$$,
                '[T-104] once revoked, the same address can be invited again');
reset role;

-- ─── B01 · set the default operator (demo workspace: Johanna Holm is the admin, Marit Feldt a portfolio manager) ─
\set seed_from_root `[ -f supabase/tests/app/fixtures/demo_halden.psql ] && echo true || echo false`
\if :seed_from_root
\i supabase/tests/app/fixtures/demo_halden.psql
\else
\ir fixtures/demo_halden.psql
\endif
create temp table demo_checks on commit drop as
  select md5(string_agg(to_jsonb(c)::text, '|' order by c.id)) as h, (select default_operator from app.workspaces
         where id = 'da7a0000-0000-4000-8000-000000000001') as op
  from app.checks c where c.workspace_id = 'da7a0000-0000-4000-8000-000000000001';

select set_config('request.jwt.claims', '{"sub":"da7a0002-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select app.set_default_operator('da7a0000-0000-4000-8000-000000000001',
                    '{"name":"Halden Pet Nutrition AB","address":"Industrivägen 4, 412 63 Göteborg, SE","country":"SE",
                      "approval_number":"α SE 14 2231"}')$$,
                '[B01.main] the admin sets the default operator');
select is((select default_operator from app.workspaces where id = 'da7a0000-0000-4000-8000-000000000001'),
          '{"name":"Halden Pet Nutrition AB","address":"Industrivägen 4, 412 63 Göteborg, SE","country":"SE",
            "approval_number":"α SE 14 2231"}'::jsonb,
          '[B01.main] the operator is stored exactly as printed');
reset role;
select ok((select before = (select op from demo_checks) and after ->> 'approval_number' = 'α SE 14 2231'
                  and actor_id = 'da7a0001-0000-4000-8000-000000000001'
           from app.audit_events where kind = 'workspace.default_operator_set'),
          '[B01.main] the change is audited with before and after values');
set local role authenticated;
select lives_ok($$select app.set_default_operator('da7a0000-0000-4000-8000-000000000001',
                    '{"name":"Halden Pet Nutrition AB","address":"Industrivägen 4, 412 63 Göteborg, SE","country":"SE",
                      "approval_number":"  "}')$$,
                '[B01.fail.1] no approval number: allowed');
select is((select default_operator ? 'approval_number' from app.workspaces where id = 'da7a0000-0000-4000-8000-000000000001'),
          false, '[B01.fail.1] without an approval number none is stored, so the establishment-number rule can report Action');
reset role;
select is((select md5(string_agg(to_jsonb(c)::text, '|' order by c.id)) from app.checks c
           where c.workspace_id = 'da7a0000-0000-4000-8000-000000000001'), (select h from demo_checks),
          '[B01.must.1] changing the default operator never alters a past check');

set local role authenticated;
select throws_ok($$select app.set_default_operator('da7a0000-0000-4000-8000-000000000001',
                    '{"name":"Halden","address":"Göteborg","country":"SE","vat":"SE556"}')$$,
                 '22023', null, '[T-104] an operator with an unknown field is refused');
select throws_ok($$select app.set_default_operator('da7a0000-0000-4000-8000-000000000001',
                    '{"name":"Halden","country":"se"}')$$,
                 '22023', null, '[T-104] an operator without an address or a two-letter country code is refused');
select set_config('request.jwt.claims', '{"sub":"da7a0002-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$select app.set_default_operator('da7a0000-0000-4000-8000-000000000001',
                    '{"name":"Halden","address":"Göteborg","country":"SE"}')$$,
                 '42501', null, '[T-104] a portfolio manager cannot set the default operator');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8104-0000000000a1","role":"authenticated"}', true);
select throws_ok($$select app.set_default_operator('da7a0000-0000-4000-8000-000000000001',
                    '{"name":"Halden","address":"Göteborg","country":"SE"}')$$,
                 '42501', null, '[T-104] an admin of another workspace cannot set this workspace''s operator');
reset role;

select * from finish();
rollback;
