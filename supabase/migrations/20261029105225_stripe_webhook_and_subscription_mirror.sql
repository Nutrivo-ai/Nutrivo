-- T-702 · M04 "Payment events and dunning" (docs/08 §Webhooks, D-18, BE-36). Additive: two job kinds and queues, two
-- service-role RPCs, the daily reconciliation schedule.
--
-- app.record_stripe_event(p_event) is what the stripe-webhook Edge Function calls after it has verified Stripe's
-- signature. It writes the event to app.payment_events once (primary key = Stripe event id; a redelivery stores and
-- queues nothing) and, for the six types docs/08 names, queues a 'billing_sync' job whose payload is the event id
-- only. The worker's billing_sync re-reads the subscription from Stripe (the source of truth, so out-of-order delivery
-- cannot leave an older state behind) and applies it through app.apply_subscription. The daily 'billing_reconcile'
-- job applies every subscription the same way, which repairs a missed or failed delivery.
--
-- app.apply_subscription maps a subscription onto the mirror (app.subscriptions) and app.workspaces.plan / status.
-- Nothing is deleted: a cancelled subscription keeps its mirror row with Stripe's status. The mapping (#62, the
-- conservative reading where docs/08 is silent):
--   active, trialing   → plan from the price; status back to 'active' from 'dunning' or 'new_artwork_stopped'
--   past_due, unpaid   → plan from the price; 'active' becomes 'dunning', which restricts nothing (BE-36 days 0-7).
--                        Day 14 ('new_artwork_stopped') is the dunning schedule's (T-704), never this function's.
--   canceled, incomplete_expired → plan 'free', status unchanged; the mirror's seat and recipe dials are cleared, so
--                        no seat check applies (D-21)
--   incomplete, paused → mirror only; the workspace keeps its plan and status
-- A 'closed' or 'dormant' workspace keeps its status. A terminal state for an older subscription never downgrades a
-- workspace whose mirrored subscription is a different, live one ('stale'), and a second live subscription for a
-- workspace is refused (23505) rather than replacing the first.
--
-- Neither function touches app.reports, app.supersessions or public.verify_reference: verification outlives the
-- subscription (CLAUDE.md non-negotiable 9). Both are executable by service_role only; clients have no route to them.

-- Expand only: the same kinds plus two. Added not valid, then validated, so the lock is not held through the scan.
alter table app.jobs drop constraint jobs_kind_check;
alter table app.jobs add constraint jobs_kind_check
  check (kind in ('extract','check','recheck','bulk_recheck','report','export','notify','session_revoke','diff_fanout',
                  'billing_sync','billing_reconcile')) not valid;
alter table app.jobs validate constraint jobs_kind_check;

do $$
begin
  if to_regnamespace('pgmq') is not null then
    perform pgmq.create(q) from unnest(array['billing_sync','billing_reconcile']) as q;
  end if;
end $$;

-- Clients never reach the billing functions. Execute is service_role's only, and this allowlist is checked first:
-- the service role through PostgREST (the stripe-webhook function), or a direct database session that is not one of
-- PostgREST's (the worker, pg_cron), which carries no JWT claims.
create function private.require_service() returns void
language plpgsql stable set search_path = '' as $$
begin
  if not (auth.role() = 'service_role'
          or (auth.role() is null and session_user not in ('authenticator', 'anon', 'authenticated'))) then
    raise exception 'billing writes come from Stripe through the service role only' using errcode = '42501';
  end if;
end $$;
revoke execute on function private.require_service() from public, anon, authenticated;
grant execute on function private.require_service() to service_role;

-- The workspace a Stripe object belongs to. A subscription already mirrored keeps its workspace whatever the object
-- says; otherwise the workspace_id Nutrivo put on it at checkout (T-703 sets client_reference_id and
-- subscription_data.metadata.workspace_id from an admin's own membership), else the mirrored customer.
create function private.stripe_workspace(p_obj jsonb) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_candidate text; v_ws uuid; v_sub text;
begin
  perform private.require_service();
  if p_obj is null or jsonb_typeof(p_obj) <> 'object' then return null; end if;
  v_sub := coalesce(case when p_obj->>'object' = 'subscription' then p_obj->>'id' end,
                    p_obj->>'subscription', p_obj->'parent'->'subscription_details'->>'subscription');
  if v_sub is not null then
    select s.workspace_id into v_ws from app.subscriptions s where s.stripe_subscription_id = v_sub;
    if v_ws is not null then return v_ws; end if;
  end if;
  foreach v_candidate in array array[p_obj->'metadata'->>'workspace_id', p_obj->>'client_reference_id',
                                     p_obj->'subscription_details'->'metadata'->>'workspace_id',
                                     p_obj->'parent'->'subscription_details'->'metadata'->>'workspace_id'] loop
    if v_candidate ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select w.id into v_ws from app.workspaces w where w.id = v_candidate::uuid;
      if v_ws is not null then return v_ws; end if;
    end if;
  end loop;
  if p_obj->>'customer' is not null then
    select s.workspace_id into v_ws from app.subscriptions s where s.stripe_customer_id = p_obj->>'customer';
  end if;
  return v_ws;
end $$;
revoke execute on function private.stripe_workspace(jsonb) from public, anon, authenticated;
grant execute on function private.stripe_workspace(jsonb) to service_role;

create function app.record_stripe_event(p_event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id text := p_event->>'id'; v_type text := p_event->>'type'; v_ws uuid; v_rows int; v_job uuid;
begin
  perform private.require_service();
  if v_id is null or v_id !~ '^evt_[A-Za-z0-9_]{1,250}$' or coalesce(v_type, '') !~ '^[a-z_]+(\.[a-z_]+)+$'
     or jsonb_typeof(p_event->'data'->'object') is distinct from 'object' then
    raise exception 'not a Stripe event' using errcode = '22023';
  end if;
  v_ws := private.stripe_workspace(p_event->'data'->'object');
  insert into app.payment_events (stripe_event_id, workspace_id, type, payload)
  values (v_id, v_ws, v_type, p_event)
  on conflict (stripe_event_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('stored', false, 'duplicate', true);
  end if;
  if v_type in ('checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated',
                'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed') then
    v_job := private.enqueue('billing_sync', v_ws, 'billing_sync:' || v_id, jsonb_build_object('stripe_event_id', v_id));
  end if;
  perform private.write_audit(v_ws, 'billing.event_received', 'payment_event', v_id, null,
                              jsonb_build_object('type', v_type, 'job_id', v_job));
  return jsonb_build_object('stored', true, 'duplicate', false, 'job_id', v_job);
end $$;
revoke execute on function app.record_stripe_event(jsonb) from public, anon, authenticated;
grant execute on function app.record_stripe_event(jsonb) to service_role;

create function app.apply_subscription(p_ws uuid, p_snapshot jsonb, p_source text, p_ref text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_sub text := p_snapshot->>'subscription_id';
  v_status text := p_snapshot->>'status';
  v_plan text := p_snapshot->>'plan';
  v_live boolean;
  v_ws app.workspaces;
  v_old app.subscriptions;
  v_new app.subscriptions;
  v_ws_plan text;
  v_ws_status text;
begin
  perform private.require_service();
  if p_source not in ('webhook', 'reconcile') then
    raise exception 'unknown source %', p_source using errcode = '22023';
  end if;
  if coalesce(v_sub, '') !~ '^sub_[A-Za-z0-9_]+$' or coalesce(p_snapshot->>'customer_id', '') !~ '^cus_[A-Za-z0-9_]+$'
     or v_plan is null or v_plan not in ('basic', 'standard', 'advanced')
     or v_status is null or v_status not in ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due',
                                             'canceled', 'unpaid', 'paused')
     or coalesce(p_snapshot->>'term', 'monthly') not in ('monthly', 'annual') then
    raise exception 'not a Nutrivo subscription snapshot' using errcode = '22023';
  end if;
  select * into v_ws from app.workspaces w where w.id = p_ws for update;
  if v_ws.id is null then raise exception 'workspace not found' using errcode = 'P0002'; end if;
  if exists (select 1 from app.subscriptions s where s.stripe_subscription_id = v_sub and s.workspace_id <> p_ws) then
    raise exception 'subscription is mirrored for another workspace' using errcode = '23505';
  end if;
  select * into v_old from app.subscriptions s where s.workspace_id = p_ws for update;
  v_live := v_status in ('active', 'trialing', 'past_due', 'unpaid');

  if v_old.stripe_subscription_id is not null and v_old.stripe_subscription_id <> v_sub
     and v_old.status in ('active', 'trialing', 'past_due', 'unpaid') then
    if not v_live then
      return 'stale';
    end if;
    -- Two live subscriptions for one workspace is never a normal path (plan changes keep the subscription): refuse,
    -- so the job fails visibly and a person looks, rather than letting the second replace the first.
    raise exception 'workspace already has a different live subscription' using errcode = '23505';
  end if;

  insert into app.subscriptions as s (workspace_id, stripe_customer_id, stripe_subscription_id, plan, term, status,
                                      regions, editor_seats, recipes_included, current_period_end, updated_at)
  values (p_ws, p_snapshot->>'customer_id', v_sub, v_plan, p_snapshot->>'term', v_status,
          coalesce(v_old.regions, '{}'),
          case when v_live then (p_snapshot->>'editor_seats')::int end,
          case when v_live then (p_snapshot->>'recipes_included')::int end,
          (p_snapshot->>'current_period_end')::timestamptz, now())
  on conflict (workspace_id) do update
    set stripe_customer_id = excluded.stripe_customer_id, stripe_subscription_id = excluded.stripe_subscription_id,
        plan = excluded.plan, term = excluded.term, status = excluded.status,
        editor_seats = excluded.editor_seats, recipes_included = excluded.recipes_included,
        current_period_end = excluded.current_period_end,
        updated_at = case when (s.stripe_customer_id, s.stripe_subscription_id, s.plan, s.term, s.status,
                                s.editor_seats, s.recipes_included, s.current_period_end)
                               is not distinct from
                               (excluded.stripe_customer_id, excluded.stripe_subscription_id, excluded.plan,
                                excluded.term, excluded.status, excluded.editor_seats, excluded.recipes_included,
                                excluded.current_period_end)
                          then s.updated_at else now() end
  returning * into v_new;

  v_ws_plan := case when v_live then v_plan
                    when v_status in ('canceled', 'incomplete_expired') then 'free'
                    else v_ws.plan end;
  v_ws_status := case when v_ws.status in ('closed', 'dormant') then v_ws.status
                      when v_status in ('active', 'trialing') then 'active'
                      when v_status in ('past_due', 'unpaid') and v_ws.status = 'active' then 'dunning'
                      else v_ws.status end;
  if (v_ws_plan, v_ws_status) is distinct from (v_ws.plan, v_ws.status) then
    update app.workspaces set plan = v_ws_plan, status = v_ws_status where id = p_ws;
  end if;

  if (v_ws_plan, v_ws_status) is not distinct from (v_ws.plan, v_ws.status)
     and v_old.workspace_id is not null and v_new.updated_at = v_old.updated_at then
    return 'unchanged';
  end if;
  perform private.write_audit(p_ws, 'billing.subscription_synced', 'subscription', v_sub,
    jsonb_build_object('plan', v_ws.plan, 'status', v_ws.status, 'subscription_status', v_old.status),
    jsonb_build_object('plan', v_ws_plan, 'status', v_ws_status, 'subscription_status', v_status,
                       'source', p_source, 'ref', left(p_ref, 255)));
  return 'applied';
end $$;
revoke execute on function app.apply_subscription(uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function app.apply_subscription(uuid, jsonb, text, text) to service_role;

-- Daily reconciliation (docs/08): one 'billing_reconcile' job per UTC day, idempotent by date. pg_cron is enabled
-- where the platform offers it, like pgmq in 0006; the worker's Sentry cron monitor 'stripe-reconcile' alerts when
-- a day's run is missed or fails (docs/17).
create function private.enqueue_billing_reconcile() returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_service();
  return private.enqueue('billing_reconcile', null,
                         'billing_reconcile:' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD'), '{}'::jsonb);
end $$;
revoke execute on function private.enqueue_billing_reconcile() from public, anon, authenticated;
grant execute on function private.enqueue_billing_reconcile() to service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('stripe-reconcile', '17 3 * * *', 'select private.enqueue_billing_reconcile()');
  else
    raise notice 'pg_cron is not available: the daily stripe-reconcile job is not scheduled';
  end if;
end $$;
