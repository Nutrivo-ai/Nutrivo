-- T-704 · BE-34 (overage capped at 1.5x list, then the next plan) and BE-36 (the dunning schedule that never deletes).
-- private.require_recipe_room through app.create_product; app.dunning_due, app.record_dunning_step and app.dunning_steps;
-- public.verify_reference through dunning, day 14 and cancellation (CLAUDE.md non-negotiable 9).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(60);
set local client_min_messages = warning;

-- ─── O: basic monthly, 2 recipes paid, €344 billed, cap €374 (room for two €15 recipes). Owen (admin).
-- N: the same on an annual term. Nina (admin).
-- D: in dunning. Dana (admin), Eric (editor). B: another workspace. Bob (admin). ───────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-4000-8704-0000000000a1','owen@o.test'), ('00000000-0000-4000-8704-0000000000a2','nina@n.test'),
  ('00000000-0000-4000-8704-0000000000d1','dana@d.test'), ('00000000-0000-4000-8704-0000000000e1','eric@d.test'),
  ('00000000-0000-4000-8704-0000000000b1','bob@b.test');
insert into app.people (id, user_id, display_name, email)
select ('10000000' || substr(u.id::text, 9))::uuid, u.id, split_part(u.email, '@', 1), u.email
from auth.users u where u.id::text like '00000000-0000-4000-8704-%';
insert into app.workspaces (id, name, plan, status, entitled_regions) values
  ('20000000-0000-4000-8704-00000000000a','Workspace O','basic','active','{EU}'),
  ('20000000-0000-4000-8704-00000000000c','Workspace N','basic','active','{EU}'),
  ('20000000-0000-4000-8704-00000000000d','Workspace D','basic','dunning','{EU}'),
  ('20000000-0000-4000-8704-00000000000b','Workspace B','basic','active','{EU}');
insert into app.allowances (workspace_id)
select id from app.workspaces where id::text like '20000000-0000-4000-8704-%';
insert into app.subscriptions (workspace_id, stripe_customer_id, stripe_subscription_id, plan, term, status,
                               recipes_included, editor_seats, plan_recipes, amount_per_period, recipe_unit_amount,
                               overage_cap) values
  ('20000000-0000-4000-8704-00000000000a','cus_O','sub_O','basic','monthly','active',2,3,2,34400,1500,37400),
  ('20000000-0000-4000-8704-00000000000c','cus_N','sub_N','basic','annual','active',2,3,2,249000,15000,37400),
  ('20000000-0000-4000-8704-00000000000d','cus_D','sub_D','basic','monthly','past_due',10,3,10,24900,1500,37400);
insert into app.memberships (workspace_id, person_id, role) values
  ('20000000-0000-4000-8704-00000000000a','10000000-0000-4000-8704-0000000000a1','admin'),
  ('20000000-0000-4000-8704-00000000000c','10000000-0000-4000-8704-0000000000a2','admin'),
  ('20000000-0000-4000-8704-00000000000d','10000000-0000-4000-8704-0000000000d1','admin'),
  ('20000000-0000-4000-8704-00000000000d','10000000-0000-4000-8704-0000000000e1','editor'),
  ('20000000-0000-4000-8704-00000000000b','10000000-0000-4000-8704-0000000000b1','admin');
insert into app.families (id, workspace_id, name) values
  ('30000000-0000-4000-8704-0000000000a1','20000000-0000-4000-8704-00000000000a','O one'),
  ('30000000-0000-4000-8704-0000000000a2','20000000-0000-4000-8704-00000000000a','O two'),
  ('30000000-0000-4000-8704-0000000000c1','20000000-0000-4000-8704-00000000000c','N one'),
  ('30000000-0000-4000-8704-0000000000c2','20000000-0000-4000-8704-00000000000c','N two'),
  ('30000000-0000-4000-8704-0000000000d1','20000000-0000-4000-8704-00000000000d','D one');
insert into app.products (id, workspace_id, family_id, name)
select ('40000000' || substr(f.id::text, 9))::uuid, f.workspace_id, f.id, f.name || ' product' from app.families f
where f.id::text like '30000000-0000-4000-8704-%';
insert into app.reports (workspace_id, product_id, node_id, ref, check_ids, ruleset_version, artwork_sha, has_not_assessed)
values ('20000000-0000-4000-8704-00000000000d','40000000-0000-4000-8704-0000000000d1','EU-SE',
        'nv-t704-reference-00000001','{}','0000.00-empty','sha-d',true);

-- Payment failures, stored as stripe-webhook stores them. in_D1 failed 15 days ago, in_D2 4 days ago, in_D3 was paid,
-- in_B1 belongs to B.
create function pg_temp.failed(p_evt text, p_type text, p_inv text, p_ws uuid, p_days int) returns void
language sql as $$
  insert into app.payment_events (stripe_event_id, workspace_id, type, payload)
  values (p_evt, p_ws, p_type, jsonb_build_object('id', p_evt, 'object', 'event', 'type', p_type,
          'created', extract(epoch from now() - make_interval(days => p_days))::bigint,
          'data', jsonb_build_object('object', jsonb_build_object('id', p_inv, 'object', 'invoice',
                                                                  'subscription', 'sub_D'))))
$$;
select pg_temp.failed('evt_d1a', 'invoice.payment_failed', 'in_D1', '20000000-0000-4000-8704-00000000000d', 15);
select pg_temp.failed('evt_d1b', 'invoice.payment_failed', 'in_D1', '20000000-0000-4000-8704-00000000000d', 8);
select pg_temp.failed('evt_d2a', 'invoice.payment_failed', 'in_D2', '20000000-0000-4000-8704-00000000000d', 4);
select pg_temp.failed('evt_d3a', 'invoice.payment_failed', 'in_D3', '20000000-0000-4000-8704-00000000000d', 9);
select pg_temp.failed('evt_d3b', 'invoice.paid', 'in_D3', '20000000-0000-4000-8704-00000000000d', 8);
select pg_temp.failed('evt_b1a', 'invoice.payment_failed', 'in_B1', '20000000-0000-4000-8704-00000000000b', 1);

create function pg_temp.as_user(p text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true) $$;
create function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true) $$;
grant execute on all functions in schema pg_temp to service_role, authenticated;

-- ─── Grants ───────────────────────────────────────────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('authenticated', 'app.dunning_due()', 'execute')
          and not has_function_privilege('anon', 'app.dunning_due()', 'execute')
          and not has_function_privilege('authenticated', 'app.record_dunning_step(uuid,text,int,text,text)', 'execute')
          and not has_function_privilege('anon', 'app.record_dunning_step(uuid,text,int,text,text)', 'execute')
          and not has_function_privilege('authenticated', 'app.recipe_overage_context(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'private.enqueue_dunning()', 'execute')
          and has_function_privilege('service_role', 'app.record_dunning_step(uuid,text,int,text,text)', 'execute'),
          '[T-704] the dunning and overage RPCs are executable by the service role only');
select ok(not has_table_privilege('authenticated', 'app.dunning_steps', 'insert')
          and not has_table_privilege('authenticated', 'app.dunning_steps', 'update')
          and not has_table_privilege('anon', 'app.dunning_steps', 'select')
          and has_table_privilege('authenticated', 'app.dunning_steps', 'select'),
          '[T-704] clients may only read app.dunning_steps, under RLS');
select is((select relrowsecurity from pg_class where oid = 'app.dunning_steps'::regclass), true,
          '[T-704] app.dunning_steps has RLS enabled');

-- ─── BE-34 · C01.must.2: overage within the cap is allowed and queues a recipe_overage job ──────────────────────────
select pg_temp.as_user('00000000-0000-4000-8704-0000000000a1');
set local role authenticated;
select lives_ok($$select app.create_product('20000000-0000-4000-8704-00000000000a', 'O three', null, 'O three')$$,
                '[T-704][C01.must.2] a third recipe on a two-recipe plan is overage within the €374 cap');
select lives_ok($$select app.create_product('20000000-0000-4000-8704-00000000000a', 'O four', null, 'O four')$$,
                '[T-704][C01.must.2] a fourth recipe still fits: €344 + 2 × €15 = €374');
-- ─── BE-34 · C01.fail.1: past the cap, P0034 offers the next plan; nothing is created, nothing is charged ─────────
select throws_ok($$select app.create_product('20000000-0000-4000-8704-00000000000a', 'O five', null, 'O five')$$,
                 'P0034', null, '[T-704][C01.fail.1] a fifth recipe would pass the cap: P0034');
reset role;
select is((select count(*)::int from app.families where workspace_id = '20000000-0000-4000-8704-00000000000a'), 4,
          '[T-704][C01.fail.1] past the cap no family is created');
select is((select count(*)::int from app.jobs where workspace_id = '20000000-0000-4000-8704-00000000000a'
           and kind = 'recipe_overage'), 2,
          '[T-704][C01.must.2] each recipe within the cap queued one recipe_overage job, the refused one none');
select is((select count(*)::int from app.jobs where workspace_id = '20000000-0000-4000-8704-00000000000a'
           and kind = 'recipe_overage' and payload <> '{}'::jsonb), 0,
          '[T-704] recipe_overage payloads hold nothing: the workspace is the job''s own column');
select is((select amount_per_period from app.subscriptions where workspace_id = '20000000-0000-4000-8704-00000000000a'),
          34400::bigint, '[T-704][C01.fail.1] the database never changes the bill itself: Stripe does, via the worker');
-- The hint names the next plan and the cap, so the screen can offer it.
do $$
declare v_hint text;
begin
  perform set_config('request.jwt.claims',
                     '{"sub":"00000000-0000-4000-8704-0000000000a1","role":"authenticated"}', true);
  begin
    perform app.create_product('20000000-0000-4000-8704-00000000000a', 'O five', null, 'O five');
  exception when sqlstate 'P0034' then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  create temp table t_hint as select v_hint::jsonb as h;
end $$;
select is((select h->>'next_plan' from t_hint), 'standard', '[T-704][C01.fail.1] the P0034 hint offers the next plan');
select is((select (h->>'overage_cap')::int from t_hint), 37400, '[T-704][C01.fail.1] the P0034 hint names the cap');

-- An annual term has no overage (#65 Q2): P0034 at the paid recipes.
select pg_temp.as_user('00000000-0000-4000-8704-0000000000a2');
set local role authenticated;
select throws_ok($$select app.create_product('20000000-0000-4000-8704-00000000000c', 'N three', null, 'N three')$$,
                 'P0034', null, '[T-704][C01.fail.1] an annual subscription takes no overage: the next plan is offered');
reset role;

-- A mirror without the BE-34 amounts (not yet re-synced) keeps the T-401 refusal.
update app.subscriptions set overage_cap = null where workspace_id = '20000000-0000-4000-8704-00000000000a';
select pg_temp.as_user('00000000-0000-4000-8704-0000000000a1');
set local role authenticated;
select throws_ok($$select app.create_product('20000000-0000-4000-8704-00000000000a', 'O five', null, 'O five')$$,
                 'P0034', null, '[T-704] without a mirrored cap no overage is allowed');
reset role;

-- A subscription in dunning takes no overage, even with room under the cap (it would be billed to an unpaid invoice).
update app.subscriptions set overage_cap = 37400, amount_per_period = 24900, status = 'past_due'
where workspace_id = '20000000-0000-4000-8704-00000000000a';
select pg_temp.as_user('00000000-0000-4000-8704-0000000000a1');
set local role authenticated;
select throws_ok($$select app.create_product('20000000-0000-4000-8704-00000000000a', 'O five', null, 'O five')$$,
                 'P0034', null, '[T-704][C01.fail.1] a subscription in dunning takes no overage');
reset role;
select is((select count(*)::int from app.jobs where workspace_id = '20000000-0000-4000-8704-00000000000a'
           and kind = 'recipe_overage'), 2, '[T-704][C01.fail.1] and queues no recipe_overage job');

-- ─── BE-34: the mirror stores the amounts while live and clears them when not ───────────────────────────────────
select pg_temp.as_service();
set local role service_role;
select is(app.apply_subscription('20000000-0000-4000-8704-00000000000b',
            '{"customer_id":"cus_B","subscription_id":"sub_B","plan":"basic","term":"monthly","status":"active",
              "editor_seats":3,"recipes_included":12,"plan_recipes":10,"amount_per_period":27900,
              "recipe_unit_amount":1500,"overage_cap":37400,"current_period_end":"2026-12-01T00:00:00Z"}', 'overage', 'j1'),
          'applied', '[T-704] apply_subscription takes the overage source and the BE-34 amounts');
reset role;
select is((select (plan_recipes, amount_per_period, recipe_unit_amount, overage_cap)::text from app.subscriptions
           where workspace_id = '20000000-0000-4000-8704-00000000000b'), '(10,27900,1500,37400)',
          '[T-704] the BE-34 amounts are mirrored from the snapshot');
set local role service_role;
select throws_ok($$select app.apply_subscription('20000000-0000-4000-8704-00000000000b',
            '{"customer_id":"cus_B","subscription_id":"sub_B","plan":"basic","term":"monthly","status":"active",
              "amount_per_period":-1}', 'overage', 'j2')$$,
                 '22023', null, '[T-704] a negative amount is refused');
select is(app.apply_subscription('20000000-0000-4000-8704-00000000000b',
            '{"customer_id":"cus_B","subscription_id":"sub_B","plan":"basic","term":"monthly","status":"canceled",
              "plan_recipes":10,"amount_per_period":27900,"recipe_unit_amount":1500,"overage_cap":37400}',
            'webhook', 'j3'), 'applied', '[T-704] a cancelled subscription applies');
reset role;
select is((select (plan_recipes, amount_per_period, overage_cap)::text from app.subscriptions
           where workspace_id = '20000000-0000-4000-8704-00000000000b'), '(,,)',
          '[T-704] a subscription that is no longer live keeps no BE-34 amounts');

-- A cancelled subscription leaves the workspace stopped while an invoice is still open, and active once it is paid.
update app.workspaces set status = 'new_artwork_stopped' where id = '20000000-0000-4000-8704-00000000000b';
select pg_temp.as_service();
set local role service_role;
select is(app.apply_subscription('20000000-0000-4000-8704-00000000000b',
            '{"customer_id":"cus_B","subscription_id":"sub_B","plan":"basic","term":"monthly","status":"canceled"}',
            'webhook', 'j4'), 'unchanged', '[T-704][M04.main] cancelled with an open invoice: still stopped');
reset role;
select pg_temp.failed('evt_b1p', 'invoice.paid', 'in_B1', '20000000-0000-4000-8704-00000000000b', 0);
set local role service_role;
select is(app.apply_subscription('20000000-0000-4000-8704-00000000000b',
            '{"customer_id":"cus_B","subscription_id":"sub_B","plan":"basic","term":"monthly","status":"canceled"}',
            'webhook', 'j5'), 'applied', '[T-704][M04.main] the open invoice is paid after cancellation');
reset role;
select is((select (plan, status)::text from app.workspaces where id = '20000000-0000-4000-8704-00000000000b'),
          '(free,active)', '[T-704][M04.main] paying after cancellation restores new labels on the free plan');

-- An invoice Stripe marks uncollectible (or voids) settles it too: the cancelled workspace is not stuck stopped.
select pg_temp.failed('evt_b2a', 'invoice.payment_failed', 'in_B2', '20000000-0000-4000-8704-00000000000b', 20);
update app.workspaces set status = 'new_artwork_stopped' where id = '20000000-0000-4000-8704-00000000000b';
set local role service_role;
select is(app.apply_subscription('20000000-0000-4000-8704-00000000000b',
            '{"customer_id":"cus_B","subscription_id":"sub_B","plan":"basic","term":"monthly","status":"canceled"}',
            'webhook', 'j6'), 'unchanged', '[T-704][M04.main] cancelled with in_B2 open: still stopped');
select ok((app.record_stripe_event(jsonb_build_object('id', 'evt_b2u', 'object', 'event',
            'type', 'invoice.marked_uncollectible', 'created', extract(epoch from now())::bigint,
            'data', jsonb_build_object('object', jsonb_build_object('id', 'in_B2', 'object', 'invoice',
                                                                    'customer', 'cus_B', 'subscription', 'sub_B'))))
           ->> 'job_id') is not null,
          '[T-704][M04.main] invoice.marked_uncollectible is stored and queues billing_sync');
select is(app.apply_subscription('20000000-0000-4000-8704-00000000000b',
            '{"customer_id":"cus_B","subscription_id":"sub_B","plan":"basic","term":"monthly","status":"canceled"}',
            'webhook', 'j7'), 'applied', '[T-704][M04.main] the uncollectible invoice is settled');
reset role;
select is((select status from app.workspaces where id = '20000000-0000-4000-8704-00000000000b'), 'active',
          '[T-704][M04.main] an uncollectible invoice after cancellation leaves the workspace active');

-- ─── BE-36 · M04.main: the steps due, latest day only, never a paid invoice ─────────────────────────────────────────
select pg_temp.as_service();
set local role service_role;
create temp table t_due as select * from app.dunning_due();
reset role;
select is((select day from t_due where stripe_invoice_id = 'in_D1'), 14,
          '[T-704][M04.main] day 0 is the first failure: 15 days on, day 14 is due (and only day 14)');
select is((select count(*)::int from t_due where stripe_invoice_id = 'in_D1'), 1,
          '[T-704][M04.main] a late run returns only the latest day, so it never sends a backlog of emails');
select is((select day from t_due where stripe_invoice_id = 'in_D2'), 3, '[T-704][M04.main] 4 days on, day 3 is due');
select is((select count(*)::int from t_due where stripe_invoice_id = 'in_D3'), 0,
          '[T-704][M04.main] a paid invoice has no dunning');
select is((select count(*)::int from t_due where stripe_invoice_id = 'in_B1'), 0,
          '[T-704][M04.main] a cancelled subscription gets no dunning: no retry, no email, no stop (#65 Q9)');

set local role service_role;
select is(app.record_dunning_step('20000000-0000-4000-8704-00000000000d', 'in_D2', 3, 'notified', 'job-1'), 'recorded',
          '[T-704][M04.main] day 3 is recorded');
select is(app.record_dunning_step('20000000-0000-4000-8704-00000000000d', 'in_D2', 3, 'notified', 'job-2'), 'duplicate',
          '[T-704][M04.main] recording a step twice is a no-op (idempotent handler)');
select throws_ok($$select app.record_dunning_step('20000000-0000-4000-8704-00000000000d', 'in_D2', 7, 'notified', 'x')$$,
                 '22023', null, '[T-704][M04.main] a step that is not yet due is refused');
select throws_ok($$select app.record_dunning_step('20000000-0000-4000-8704-00000000000b', 'in_D2', 3, 'notified', 'x')$$,
                 '22023', null, '[T-704] an invoice of another workspace is refused');
select is(app.record_dunning_step('20000000-0000-4000-8704-00000000000d', 'in_D3', 7, 'notified', 'x'), 'paid',
          '[T-704][M04.main] an invoice paid meanwhile ends the schedule without a step');
reset role;
select is((select payload from app.jobs where idempotency_key = 'payment_failed:in_D2:3'),
          '{"day": 3, "stopped": false, "template": "payment_failed", "payment_event_id": "evt_d2a"}'::jsonb,
          '[T-704][M04.main] a notified step queues one payment_failed email, ids only');
select is((select status from app.workspaces where id = '20000000-0000-4000-8704-00000000000d'), 'dunning',
          '[T-704][M04.main] days 0 to 7 restrict nothing: the workspace stays in dunning');
select pg_temp.as_service();
set local role service_role;
select is((select count(*)::int from app.dunning_due() where stripe_invoice_id = 'in_D2'), 0,
          '[T-704][M04.main] a recorded day is not due again');
select is(app.record_dunning_step('20000000-0000-4000-8704-00000000000d', 'in_D1', 14, 'notified', 'job-3'), 'recorded',
          '[T-704][M04.main] day 14 is recorded');
reset role;
select is((select status from app.workspaces where id = '20000000-0000-4000-8704-00000000000d'), 'new_artwork_stopped',
          '[T-704][M04.main] day 14 stops new artworks');
select is((select count(*)::int from app.audit_events where workspace_id = '20000000-0000-4000-8704-00000000000d'
           and kind = 'billing.new_artwork_stopped'), 1, '[T-704][M04.main] day 14 is audited');
select is((select payload->'stopped' from app.jobs where idempotency_key = 'payment_failed:in_D1:14'), 'true'::jsonb,
          '[T-704][M04.main] the day-14 email is told the workspace was stopped');

-- Day 14 stops new artworks only.
select pg_temp.as_user('00000000-0000-4000-8704-0000000000e1');
set local role authenticated;
select throws_ok($$select app.create_product_from_artwork('20000000-0000-4000-8704-00000000000d', 'new.pdf')$$,
                 'P0036', null, '[T-704][M04.main] after day 14 a new artwork is refused (P0036)');
select is((select count(*)::int from app.products where workspace_id = '20000000-0000-4000-8704-00000000000d'), 1,
          '[T-704][M04.must.1] after day 14 every product is still readable');
select is((select count(*)::int from app.reports where workspace_id = '20000000-0000-4000-8704-00000000000d'), 1,
          '[T-704][M04.must.1] after day 14 every report is still readable');
reset role;

-- ─── BE-36 · M04.must.1: nothing is deleted; verification never breaks ──────────────────────────────────────────
select is(public.verify_reference('nv-t704-reference-00000001') ->> 'status', 'current',
          '[T-704][M04.must.1] verify_reference is current after day 14');
set local role anon;
select is(public.verify_reference('nv-t704-reference-00000001') ->> 'status', 'current',
          '[T-704][M04.must.1] a third party (anon) still verifies after day 14');
reset role;
select pg_temp.as_service();
set local role service_role;
select is(app.apply_subscription('20000000-0000-4000-8704-00000000000d',
            '{"customer_id":"cus_D","subscription_id":"sub_D","plan":"basic","term":"monthly","status":"canceled"}',
            'webhook', 'cancel'), 'applied', '[T-704][M04.must.1] the subscription is cancelled after dunning');
reset role;
update app.workspaces set status = 'closed' where id = '20000000-0000-4000-8704-00000000000d';
set local role anon;
select is(public.verify_reference('nv-t704-reference-00000001') ->> 'status', 'current',
          '[T-704][M04.must.1] verify_reference is current after cancellation and closure');
reset role;
select is((select count(*)::int from app.dunning_steps where workspace_id = '20000000-0000-4000-8704-00000000000d'), 2,
          '[T-704][M04.must.1] every dunning step is kept');
select throws_ok($$delete from app.dunning_steps where stripe_invoice_id = 'in_D2'$$, 'P0005', null,
                 '[T-704][M04.must.1] app.dunning_steps rejects delete, even for the owner');
select throws_ok($$update app.dunning_steps set outcome = 'resolved' where stripe_invoice_id = 'in_D2'$$, 'P0005', null,
                 '[T-704][M04.must.1] app.dunning_steps rejects update, even for the owner');
select pg_temp.as_service();
set local role service_role;
select is((select count(*)::int from app.dunning_due() where workspace_id = '20000000-0000-4000-8704-00000000000d'), 0,
          '[T-704] a closed workspace gets no dunning');
select throws_ok($$select app.record_dunning_step('20000000-0000-4000-8704-00000000000d', 'in_D2', 0, 'notified', 'x')$$,
                 '22023', null, '[T-704] nor can a step be recorded for it');
reset role;

-- ─── RLS: only admins of the workspace read its dunning steps ────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-4000-8704-0000000000d1');
set local role authenticated;
select is((select count(*)::int from app.dunning_steps), 2, '[T-704] an admin reads the workspace''s dunning steps');
reset role;
select pg_temp.as_user('00000000-0000-4000-8704-0000000000e1');
set local role authenticated;
select is((select count(*)::int from app.dunning_steps), 0, '[T-704] an editor reads no dunning steps');
reset role;
select pg_temp.as_user('00000000-0000-4000-8704-0000000000b1');
set local role authenticated;
select is((select count(*)::int from app.dunning_steps), 0, '[T-704] another workspace reads no dunning steps');
reset role;

select * from finish();
rollback;
