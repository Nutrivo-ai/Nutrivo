-- T-702 · M04: app.record_stripe_event (payment events stored once by Stripe event id, an ids-only billing_sync job)
-- and app.apply_subscription (the subscription mirror, workspace plan and status). Service role only; nothing is ever
-- deleted and verification never breaks (BE-36).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(35);
set local client_min_messages = warning;

-- ─── A: Alice (admin), Carl (editor), basic once subscribed. B: Bob (admin), another workspace. ─────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-4000-8702-0000000000a1','alice@a.test'), ('00000000-0000-4000-8702-0000000000c1','carl@a.test'),
  ('00000000-0000-4000-8702-0000000000b1','bob@b.test');
insert into app.people (id, user_id, display_name, email)
select ('10000000' || substr(u.id::text, 9))::uuid, u.id, split_part(u.email, '@', 1), u.email
from auth.users u where u.id::text like '00000000-0000-4000-8702-%';
insert into app.workspaces (id, name) values
  ('20000000-0000-4000-8702-00000000000a','Workspace A'), ('20000000-0000-4000-8702-00000000000b','Workspace B');
insert into app.memberships (workspace_id, person_id, role) values
  ('20000000-0000-4000-8702-00000000000a','10000000-0000-4000-8702-0000000000a1','admin'),
  ('20000000-0000-4000-8702-00000000000a','10000000-0000-4000-8702-0000000000c1','editor'),
  ('20000000-0000-4000-8702-00000000000b','10000000-0000-4000-8702-0000000000b1','admin');
insert into app.families (id, workspace_id, name) values
  ('30000000-0000-4000-8702-00000000000a','20000000-0000-4000-8702-00000000000a','Family A');
insert into app.products (id, workspace_id, family_id, name) values
  ('40000000-0000-4000-8702-00000000000a','20000000-0000-4000-8702-00000000000a',
   '30000000-0000-4000-8702-00000000000a','Product A');
insert into app.reports (workspace_id, product_id, node_id, ref, check_ids, ruleset_version, artwork_sha, has_not_assessed)
values ('20000000-0000-4000-8702-00000000000a','40000000-0000-4000-8702-00000000000a','EU-SE',
        'nv-t702-reference-00000001','{}','0000.00-empty','sha-a',true);

create function pg_temp.evt(p_id text, p_type text, p_obj jsonb) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'object', 'event', 'type', p_type, 'livemode', false,
                            'data', jsonb_build_object('object', p_obj))
$$;
create function pg_temp.snap(p_status text, p_sub text default 'sub_A1', p_plan text default 'basic') returns jsonb
language sql as $$
  select jsonb_build_object('customer_id', 'cus_A', 'subscription_id', p_sub, 'plan', p_plan, 'term', 'monthly',
                            'status', p_status, 'editor_seats', 4, 'recipes_included', 12,
                            'current_period_end', '2026-11-29T00:00:00Z')
$$;
create function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true)
$$;
grant execute on all functions in schema pg_temp to service_role, authenticated;

-- ─── Grants: clients never reach the billing RPCs ──────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('anon', 'app.record_stripe_event(jsonb)', 'execute')
          and not has_function_privilege('authenticated', 'app.record_stripe_event(jsonb)', 'execute')
          and has_function_privilege('service_role', 'app.record_stripe_event(jsonb)', 'execute'),
          '[T-702] app.record_stripe_event is executable by the service role only');
select ok(not has_function_privilege('anon', 'app.apply_subscription(uuid,jsonb,text,text)', 'execute')
          and not has_function_privilege('authenticated', 'app.apply_subscription(uuid,jsonb,text,text)', 'execute')
          and has_function_privilege('service_role', 'app.apply_subscription(uuid,jsonb,text,text)', 'execute'),
          '[T-702] app.apply_subscription is executable by the service role only');
select ok(not has_function_privilege('authenticated', 'private.stripe_workspace(jsonb)', 'execute')
          and not has_function_privilege('authenticated', 'private.enqueue_billing_reconcile()', 'execute'),
          '[T-702] the billing helpers are not executable by clients');
select ok(not has_table_privilege('authenticated', 'app.payment_events', 'insert')
          and not has_table_privilege('authenticated', 'app.subscriptions', 'update')
          and not has_table_privilege('anon', 'app.payment_events', 'select'),
          '[T-702] no client write grant on payment_events or subscriptions, and anon reads neither');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8702-0000000000a1","role":"authenticated"}', true);
select throws_ok($$select app.record_stripe_event(pg_temp.evt('evt_forged', 'invoice.paid', '{"object":"invoice"}'))$$,
                 '42501', null, '[T-702] a call carrying a client JWT is refused even where execute is held');

-- ─── M04.main: an event is stored once and queues one ids-only job ─────────────────────────────────────────────────
set local role service_role;
select pg_temp.as_service();
select is(app.record_stripe_event(pg_temp.evt('evt_checkout_1', 'checkout.session.completed',
            '{"object":"checkout.session","id":"cs_test_1","customer":"cus_A","subscription":"sub_A1",
              "client_reference_id":"20000000-0000-4000-8702-00000000000a"}')) ->> 'stored', 'true',
          '[M04.main] a checkout.session.completed event is stored');
select is(app.record_stripe_event(pg_temp.evt('evt_checkout_1', 'checkout.session.completed',
            '{"object":"checkout.session","id":"cs_test_1","customer":"cus_A","subscription":"sub_A1",
              "client_reference_id":"20000000-0000-4000-8702-00000000000a"}')),
          '{"stored": false, "duplicate": true}'::jsonb,
          '[M04.main] a redelivery of the same event id is a no-op');
reset role;
select is((select count(*)::int from app.payment_events where stripe_event_id = 'evt_checkout_1'), 1,
          '[M04.main] webhook events are stored once by id');
select is((select workspace_id from app.payment_events where stripe_event_id = 'evt_checkout_1'),
          '20000000-0000-4000-8702-00000000000a'::uuid,
          '[M04.main] the event is attributed to the workspace named by client_reference_id');
select is((select count(*)::int from app.jobs where kind = 'billing_sync'), 1,
          '[M04.main] one billing_sync job is queued however often Stripe delivers');
select is((select payload from app.jobs where kind = 'billing_sync'), '{"stripe_event_id":"evt_checkout_1"}'::jsonb,
          '[M04.main] the job payload holds the event id only');
select is((select count(*)::int from pgmq.q_billing_sync), 1, '[M04.main] the job is on the billing_sync queue');

set local role service_role;
select pg_temp.as_service();
select is(app.record_stripe_event(pg_temp.evt('evt_other_1', 'customer.created', '{"object":"customer","id":"cus_Z"}'))
          ->> 'job_id', null, '[T-702] a type outside docs/08 is stored but queues nothing');
select throws_ok($$select app.record_stripe_event('{"id":"nope","type":"invoice.paid","data":{"object":{}}}')$$,
                 '22023', null, '[T-702] something that is not a Stripe event is refused');

-- ─── M04.main: the mirror and the workspace follow the subscription ────────────────────────────────────────────────
select is(app.apply_subscription('20000000-0000-4000-8702-00000000000a', pg_temp.snap('active'), 'webhook', 'evt_checkout_1'),
          'applied', '[M04.main] an active subscription is applied');
reset role;
select is((select (plan, status) from app.workspaces where id = '20000000-0000-4000-8702-00000000000a')::text,
          '(basic,active)', '[M04.main] the workspace is on the plan it paid for');
select is((select (stripe_subscription_id, plan, status, editor_seats, recipes_included) from app.subscriptions
           where workspace_id = '20000000-0000-4000-8702-00000000000a')::text,
          '(sub_A1,basic,active,4,12)', '[M04.main] the mirror holds the subscription with its dials');
set local role service_role;
select pg_temp.as_service();
select is(app.apply_subscription('20000000-0000-4000-8702-00000000000a', pg_temp.snap('active'), 'reconcile', 'daily'),
          'unchanged', '[M04.main] applying the same state again changes nothing');
select is((select private.stripe_workspace('{"object":"invoice","customer":"cus_A","subscription":"sub_A1"}')),
          '20000000-0000-4000-8702-00000000000a'::uuid,
          '[M04.main] a later invoice event without metadata is attributed through the mirror');

select app.apply_subscription('20000000-0000-4000-8702-00000000000a', pg_temp.snap('past_due'), 'webhook', 'evt_failed_1');
reset role;
select is((select status from app.workspaces where id = '20000000-0000-4000-8702-00000000000a'), 'dunning',
          '[M04.main] a failed payment puts the workspace into dunning, which restricts nothing');
update app.workspaces set status = 'new_artwork_stopped' where id = '20000000-0000-4000-8702-00000000000a';
set local role service_role;
select pg_temp.as_service();
select app.apply_subscription('20000000-0000-4000-8702-00000000000a', pg_temp.snap('past_due'), 'reconcile', 'daily');
reset role;
select is((select status from app.workspaces where id = '20000000-0000-4000-8702-00000000000a'), 'new_artwork_stopped',
          '[T-702] another failed payment never relaxes day 14 of dunning (the schedule is T-704''s)');
set local role service_role;
select pg_temp.as_service();
select app.apply_subscription('20000000-0000-4000-8702-00000000000a', pg_temp.snap('active'), 'webhook', 'evt_paid_1');
reset role;
select is((select status from app.workspaces where id = '20000000-0000-4000-8702-00000000000a'), 'active',
          '[M04.main] a paid invoice brings the workspace back to active');

-- ─── Stale and foreign subscriptions ───────────────────────────────────────────────────────────────────────────────
set local role service_role;
select pg_temp.as_service();
select is(app.apply_subscription('20000000-0000-4000-8702-00000000000a', pg_temp.snap('canceled', 'sub_A0'), 'webhook', 'evt_old'),
          'stale', '[T-702] the end of an older subscription never downgrades a workspace with a live one');
select throws_ok($$select app.apply_subscription('20000000-0000-4000-8702-00000000000b', pg_temp.snap('active'), 'webhook', 'x')$$,
                 '23505', null, '[T-702] a subscription mirrored for one workspace is never applied to another');
select throws_ok($$select app.apply_subscription('20000000-0000-4000-8702-00000000000a',
                   pg_temp.snap('active') || '{"plan":"partner"}', 'webhook', 'x')$$,
                 '22023', null, '[T-702] a snapshot outside the catalogue is refused');

-- ─── M04.must.1: cancellation deletes nothing and verification keeps working ───────────────────────────────────────
select app.record_stripe_event(pg_temp.evt('evt_deleted_1', 'customer.subscription.deleted',
         '{"object":"subscription","id":"sub_A1","customer":"cus_A","status":"canceled"}'));
select is(app.apply_subscription('20000000-0000-4000-8702-00000000000a', pg_temp.snap('canceled'), 'webhook', 'evt_deleted_1'),
          'applied', '[M04.must.1] a cancelled subscription is applied');
reset role;
select is((select (plan, status) from app.workspaces where id = '20000000-0000-4000-8702-00000000000a')::text,
          '(free,active)', '[M04.must.1] after cancellation the workspace is back on the free plan, nothing removed');
select is((select (status, editor_seats, recipes_included) from app.subscriptions
           where workspace_id = '20000000-0000-4000-8702-00000000000a')::text, '(canceled,,)',
          '[M04.must.1] the mirror row stays, cancelled, with no seat check (D-21)');
select is(public.verify_reference('nv-t702-reference-00000001') ->> 'status', 'current',
          '[M04.must.1] verification still works after the subscription is cancelled');
set local role anon;
select is(public.verify_reference('nv-t702-reference-00000001') ->> 'status', 'current',
          '[M04.must.1] verification still works for anyone holding the document');
reset role;
select is((select count(*)::int from app.payment_events where workspace_id = '20000000-0000-4000-8702-00000000000a'), 2,
          '[M04.must.1] every payment event is still there');
select throws_ok($$delete from app.payment_events where stripe_event_id = 'evt_checkout_1'$$, 'P0005', null,
                 '[M04.must.1] payment events are never deleted');
select throws_ok($$update app.payment_events set type = 'x' where stripe_event_id = 'evt_checkout_1'$$, 'P0005', null,
                 '[M04.must.1] payment events are never updated');

-- ─── Reads: the admin sees the payment events of their workspace only; the editor sees the mirror, not the events ──
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8702-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from app.payment_events) + (select count(*)::int from app.subscriptions), 0,
          '[T-702] another workspace''s admin reads none of A''s payment events or subscription');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8702-0000000000c1","role":"authenticated"}', true);
select is((select count(*)::int from app.payment_events)::text || '/' || (select count(*)::int from app.subscriptions)::text,
          '0/1', '[T-702] an editor reads the subscription mirror but not the payment events');
reset role;

select * from finish();
rollback;
