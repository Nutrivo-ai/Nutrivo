-- T-703 · M01, M03, M05: app.billing_context and app.record_billing_change. Only an internal admin of the whole
-- workspace (private.can_manage_billing, which is private.can_export) reads the context or records a change; the
-- context names the caller's own workspace and the mirrored Stripe customer, never another workspace's; a recorded
-- change is an audit row naming who changed which billing details.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(20);
set local client_min_messages = warning;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8703-0000000000a1','alice@a.test'), ('00000000-0000-4000-8703-0000000000c1','carl@a.test'),
  ('00000000-0000-4000-8703-0000000000b1','bob@b.test'),   ('00000000-0000-4000-8703-0000000000e1','ezra@agency.test'),
  ('00000000-0000-4000-8703-0000000000e2','sam@a.test'),   ('00000000-0000-4000-8703-0000000000e3','olga@a.test');
insert into app.people (id, user_id, display_name, email)
select ('10000000' || substr(u.id::text, 9))::uuid, u.id, split_part(u.email, '@', 1), u.email
from auth.users u where u.id::text like '00000000-0000-4000-8703-%';
insert into app.workspaces (id, name, plan, status) values
  ('20000000-0000-4000-8703-00000000000a','Workspace A','standard','active'),
  ('20000000-0000-4000-8703-00000000000b','Workspace B','free','active');
insert into app.subscriptions (workspace_id, stripe_customer_id, stripe_subscription_id, plan, term, status) values
  ('20000000-0000-4000-8703-00000000000a','cus_t703_a','sub_t703_a','standard','annual','active');
insert into app.memberships (workspace_id, person_id, role) values
  ('20000000-0000-4000-8703-00000000000a','10000000-0000-4000-8703-0000000000a1','admin'),
  ('20000000-0000-4000-8703-00000000000a','10000000-0000-4000-8703-0000000000c1','editor'),
  ('20000000-0000-4000-8703-00000000000b','10000000-0000-4000-8703-0000000000b1','admin');
-- A's other admins: Ezra external, Sam scoped to one market, Olga whose access ended yesterday.
insert into app.memberships (workspace_id, person_id, role, is_external, scope_node_ids, access_ends_at) values
  ('20000000-0000-4000-8703-00000000000a','10000000-0000-4000-8703-0000000000e1','admin',true,null,null),
  ('20000000-0000-4000-8703-00000000000a','10000000-0000-4000-8703-0000000000e2','admin',false,'{EU-DE}',null),
  ('20000000-0000-4000-8703-00000000000a','10000000-0000-4000-8703-0000000000e3','admin',false,null,now() - interval '1 day');

select ok(not has_function_privilege('anon', 'app.billing_context(uuid)', 'execute')
          and has_function_privilege('authenticated', 'app.billing_context(uuid)', 'execute'),
          '[T-703] app.billing_context is executable by authenticated users and never by anon');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc
           where oid = 'app.billing_context(uuid)'::regprocedure),
          '[T-703] app.billing_context is security definer with an empty search_path');

-- ─── M01.main: Alice, an internal admin, gets her own workspace and its mirrored customer ───────────────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8703-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is(app.billing_context('20000000-0000-4000-8703-00000000000a')->>'workspace_id',
          '20000000-0000-4000-8703-00000000000a', '[M01.main] an admin reads the billing context of her own workspace');
select is(app.billing_context('20000000-0000-4000-8703-00000000000a')->>'stripe_customer_id', 'cus_t703_a',
          '[M01.main] the context names the mirrored Stripe customer');
select is((app.billing_context('20000000-0000-4000-8703-00000000000a')->>'subscription_status')
          || '/' || (app.billing_context('20000000-0000-4000-8703-00000000000a')->>'term'), 'active/annual',
          '[M05.main] the context carries the live subscription, so a plan change goes to the portal');
-- Alice is not a member of B: the context of a workspace she does not administer is refused, not empty.
select throws_ok($$ select app.billing_context('20000000-0000-4000-8703-00000000000b') $$, '42501', null,
                 '[T-703] the billing context of another workspace is refused (42501)');
select throws_ok($$ select app.billing_context(null) $$, '42501', null, '[T-703] no workspace is refused (42501)');
reset role;

-- ─── Below an internal, unscoped, current admin: refused ─────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8703-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select app.billing_context('20000000-0000-4000-8703-00000000000a') $$, '42501', null,
                 '[T-703] an editor cannot read the billing context (42501)');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8703-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select app.billing_context('20000000-0000-4000-8703-00000000000a') $$, '42501', null,
                 '[T-703] an external admin cannot manage the workspace''s billing (42501)');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8703-0000000000e2","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select app.billing_context('20000000-0000-4000-8703-00000000000a') $$, '42501', null,
                 '[T-703] a scoped admin cannot manage the workspace''s billing (42501)');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8703-0000000000e3","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select app.billing_context('20000000-0000-4000-8703-00000000000a') $$, '42501', null,
                 '[T-703] an admin whose access ended cannot manage the workspace''s billing (42501)');
reset role;

-- Bob, admin of B with no subscription: his context has no customer yet (the web server finds or creates one).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8703-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select ok(app.billing_context('20000000-0000-4000-8703-00000000000b')->>'stripe_customer_id' is null
          and app.billing_context('20000000-0000-4000-8703-00000000000b')->>'plan' = 'free',
          '[T-703] a workspace with no subscription has a context with no customer, on the free plan');
reset role;

-- ─── M03.main: a change to the billing details is audited with who changed what ───────────────────────────────
select ok((select prosrc like '%private.can_export(ws)%' from pg_proc where oid = 'private.can_manage_billing(uuid)'::regprocedure),
          '[T-703] private.can_manage_billing is private.can_export, so the two cannot drift');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8703-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$ select app.record_billing_change('20000000-0000-4000-8703-00000000000a', 'details', 'cus_t703_a',
                     '{"legal_name":"Halden Pet Nutrition AB","vat_number":null}',
                     '{"legal_name":"Halden Pet Nutrition AB","vat_number":"SE556734112801"}') $$,
                '[M03.main] an admin records a change to the billing details');
select throws_ok($$ select app.record_billing_change('20000000-0000-4000-8703-00000000000a', 'details', 'cus_other', null, '{"legal_name":"X"}') $$,
                 '22023', null, '[T-703] a change to another customer than the workspace''s is refused (22023)');
select throws_ok($$ select app.record_billing_change('20000000-0000-4000-8703-00000000000a', 'card', 'cus_t703_a', null, '{}') $$,
                 '22023', null, '[T-703] an unknown kind of billing change is refused (22023)');
select throws_ok($$ select app.record_billing_change('20000000-0000-4000-8703-00000000000a', 'finance_email', 'cus_t703_a', null, '{"email":"a@b.test","card_number":"4242"}') $$,
                 '22023', null, '[T-703] a billing change holding other fields is refused (22023)');
select throws_ok($$ select app.record_billing_change('20000000-0000-4000-8703-00000000000b', 'details', 'cus_t703_a', null, '{}') $$,
                 '42501', null, '[T-703] a change to another workspace''s billing is refused (42501)');
reset role;
select ok((select count(*) = 1 from app.audit_events a
           where a.workspace_id = '20000000-0000-4000-8703-00000000000a' and a.kind = 'billing.details_changed'
             and a.object_type = 'stripe_customer' and a.object_id = 'cus_t703_a'
             and a.actor_id = '10000000-0000-4000-8703-0000000000a1' and not a.actor_is_external
             and a.after->>'vat_number' = 'SE556734112801' and a.before->>'vat_number' is null),
          '[M03.main] the audit row names the admin, the customer and the VAT number before and after');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8703-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select app.record_billing_change('20000000-0000-4000-8703-00000000000a', 'finance_email', 'cus_t703_a', null, '{"email":"a@b.test"}') $$,
                 '42501', null, '[T-703] an editor cannot record a billing change (42501)');
reset role;

select * from finish();
rollback;
