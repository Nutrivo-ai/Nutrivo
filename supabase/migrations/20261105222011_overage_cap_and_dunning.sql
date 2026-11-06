-- T-704 · BE-34 (overage capped at 1.5x list, then the next plan) and BE-36 (the dunning schedule that never deletes).
-- docs/08 §Overage and §Dunning, D-03, D-18. Additive only (expand): four nullable mirror columns, one insert-only
-- table, two job kinds and queues, three service-role RPCs, a daily pg_cron schedule, and two functions replaced with
-- their signatures unchanged (private.require_recipe_room, app.apply_subscription).
--
-- BE-34. Stripe is the source of truth (D-18): the worker's snapshot now carries, from Stripe's own prices, the plan's
-- recipes before add-ons, the net recurring amount of every item, the recipe add-on's unit amount and the plan
-- product's overage_cap metadata (T-701, from config/pricing.ts). A new recipe past the paid recipes is allowed only
-- while the recurring amount plus the extra recipes stays within the cap; it then queues 'recipe_overage', whose
-- worker raises the recipe add-on in Stripe (checking the cap again against Stripe) and re-applies the mirror. Past
-- the cap it is P0034 with the next plan, as before: never a larger invoice. Where #65 is silent the conservative
-- reading is taken (#65 Q1-Q4): every recurring item counts toward the cap; an annual term has no overage (D-03 gives
-- monthly figures only); while the new columns are null (a mirror not yet re-synced) the T-401 refusal holds.
--
-- BE-36. Day 0 is the first invoice.payment_failed event for a Stripe invoice. Days 0, 3 and 7 notify (and on 3 and 7
-- retry the payment), with no restriction; day 14 moves 'dunning' to 'new_artwork_stopped', which the existing P0036
-- checks turn into "no new artworks" and nothing else. A paid invoice ends the schedule; the return to 'active' stays
-- app.apply_subscription's (T-702). pg_cron queues one 'dunning' job a day (07:41 UTC, docs/17); the worker re-reads each invoice from
-- Stripe, acts, and records the step through app.record_dunning_step, idempotent per invoice and day.
--
-- Nothing here touches app.reports, app.supersessions or public.verify_reference: billing, dunning and closure never
-- affect verification (CLAUDE.md non-negotiable 9). Nothing is deleted.

-- ─── Mirror columns (expand) ─────────────────────────────────────────────────────────────────────────────────────
alter table app.subscriptions
  add column plan_recipes       int    check (plan_recipes >= 0),
  add column amount_per_period  bigint check (amount_per_period >= 0),
  add column recipe_unit_amount bigint check (recipe_unit_amount >= 0),
  add column overage_cap        bigint check (overage_cap >= 0);
comment on column app.subscriptions.plan_recipes is 'BE-34: recipes the plan includes before add-ons (Stripe product metadata)';
comment on column app.subscriptions.amount_per_period is 'BE-34: net minor units of every recurring item per term (Stripe prices)';
comment on column app.subscriptions.recipe_unit_amount is 'BE-34: net minor units of one recipe add-on for this plan and term';
comment on column app.subscriptions.overage_cap is 'BE-34: monthly cap in minor units (1.5x list, D-03); null means no overage';

-- ─── Job kinds (expand) ───────────────────────────────────────────────────────────────────────────────────────────
alter table app.jobs drop constraint jobs_kind_check;
alter table app.jobs add constraint jobs_kind_check
  check (kind in ('extract','check','recheck','bulk_recheck','report','export','notify','session_revoke','diff_fanout',
                  'billing_sync','billing_reconcile','recipe_overage','dunning')) not valid;
alter table app.jobs validate constraint jobs_kind_check;

do $$
begin
  if to_regnamespace('pgmq') is not null then
    perform pgmq.create(q) from unnest(array['recipe_overage','dunning']) as q;
  end if;
end $$;

-- ─── BE-34: room for one more recipe ─────────────────────────────────────────────────────────────────────────────
create or replace function private.require_recipe_room(ws uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_s app.subscriptions; v_live int; v_extra int; v_next text;
begin
  perform pg_advisory_xact_lock(hashtextextended('nutrivo.recipes:' || ws::text, 0));
  select * into v_s from app.subscriptions s where s.workspace_id = ws;
  if v_s.recipes_included is null then
    return;                                   -- Free, Advanced, or no live subscription: no recipe limit
  end if;
  v_live := private.live_recipes(ws);
  if v_live < v_s.recipes_included then
    return;                                   -- a recipe already paid for
  end if;
  v_extra := v_live + 1 - v_s.recipes_included;
  -- Only a paying subscription takes overage: in dunning (past_due, unpaid) the recipe would be added to an invoice
  -- nobody is paying, so it is refused like any recipe past the cap (T-704 review).
  if v_s.status in ('active', 'trialing') and v_s.term = 'monthly' and v_s.overage_cap is not null
     and v_s.recipe_unit_amount is not null
     and v_s.amount_per_period is not null
     and v_s.amount_per_period + v_extra::bigint * v_s.recipe_unit_amount <= v_s.overage_cap then
    -- Overage within the cap: the worker raises the recipe add-on in Stripe. One job per transaction; the handler is
    -- idempotent (it sets the quantity the live count needs), so two jobs never charge twice.
    perform private.enqueue('recipe_overage', ws, 'recipe_overage:' || ws::text || ':' || txid_current()::text || ':' || (v_live + 1)::text,
                            '{}'::jsonb);
    return;
  end if;
  v_next := case v_s.plan when 'basic' then 'standard' else 'advanced' end;
  raise exception 'BE-34: the % plan has no room for another recipe within its overage cap; the next plan adds more',
                  v_s.plan
    using errcode = 'P0034',
          hint = jsonb_build_object('plan', v_s.plan, 'recipes_included', v_s.recipes_included,
                                    'overage_cap', v_s.overage_cap, 'term', v_s.term,
                                    'next_plan', v_next)::text;
end $$;
revoke execute on function private.require_recipe_room(uuid) from public, anon, authenticated;
grant execute on function private.require_recipe_room(uuid) to service_role;

-- ─── The mirror, now with the BE-34 amounts (same signature, same mapping as T-702) ─────────────────────────────
create or replace function private.snapshot_amount(p_snapshot jsonb, p_key text) returns bigint
language plpgsql immutable set search_path = '' as $$
declare v jsonb := p_snapshot -> p_key;
begin
  if v is null or jsonb_typeof(v) = 'null' then return null; end if;
  if jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^[0-9]{1,15}$' then
    raise exception 'snapshot % is not a whole, non-negative amount', p_key using errcode = '22023';
  end if;
  return (v #>> '{}')::bigint;
end $$;
revoke execute on function private.snapshot_amount(jsonb, text) from public, anon, authenticated;
grant execute on function private.snapshot_amount(jsonb, text) to service_role;

create or replace function app.apply_subscription(p_ws uuid, p_snapshot jsonb, p_source text, p_ref text) returns text
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
  v_plan_recipes bigint;
  v_amount bigint;
  v_unit bigint;
  v_cap bigint;
begin
  perform private.require_service();
  -- The same per-workspace lock as private.require_recipe_room, taken first: a cap check never reads a mirror that is
  -- changing under it (T-704 review).
  perform pg_advisory_xact_lock(hashtextextended('nutrivo.recipes:' || p_ws::text, 0));
  if p_source not in ('webhook', 'reconcile', 'overage') then
    raise exception 'unknown source %', p_source using errcode = '22023';
  end if;
  if coalesce(v_sub, '') !~ '^sub_[A-Za-z0-9_]+$' or coalesce(p_snapshot->>'customer_id', '') !~ '^cus_[A-Za-z0-9_]+$'
     or v_plan is null or v_plan not in ('basic', 'standard', 'advanced')
     or v_status is null or v_status not in ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due',
                                             'canceled', 'unpaid', 'paused')
     or coalesce(p_snapshot->>'term', 'monthly') not in ('monthly', 'annual') then
    raise exception 'not a Nutrivo subscription snapshot' using errcode = '22023';
  end if;
  v_plan_recipes := private.snapshot_amount(p_snapshot, 'plan_recipes');
  v_amount := private.snapshot_amount(p_snapshot, 'amount_per_period');
  v_unit := private.snapshot_amount(p_snapshot, 'recipe_unit_amount');
  v_cap := private.snapshot_amount(p_snapshot, 'overage_cap');
  if v_plan_recipes > 100000 then
    raise exception 'snapshot plan_recipes out of range' using errcode = '22023';
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
    raise exception 'workspace already has a different live subscription' using errcode = '23505';
  end if;

  insert into app.subscriptions as s (workspace_id, stripe_customer_id, stripe_subscription_id, plan, term, status,
                                      regions, editor_seats, recipes_included, current_period_end, updated_at,
                                      plan_recipes, amount_per_period, recipe_unit_amount, overage_cap)
  values (p_ws, p_snapshot->>'customer_id', v_sub, v_plan, p_snapshot->>'term', v_status,
          coalesce(v_old.regions, '{}'),
          case when v_live then (p_snapshot->>'editor_seats')::int end,
          case when v_live then (p_snapshot->>'recipes_included')::int end,
          (p_snapshot->>'current_period_end')::timestamptz, now(),
          case when v_live then v_plan_recipes::int end,
          case when v_live then v_amount end,
          case when v_live then v_unit end,
          case when v_live then v_cap end)
  on conflict (workspace_id) do update
    set stripe_customer_id = excluded.stripe_customer_id, stripe_subscription_id = excluded.stripe_subscription_id,
        plan = excluded.plan, term = excluded.term, status = excluded.status,
        editor_seats = excluded.editor_seats, recipes_included = excluded.recipes_included,
        current_period_end = excluded.current_period_end,
        plan_recipes = excluded.plan_recipes, amount_per_period = excluded.amount_per_period,
        recipe_unit_amount = excluded.recipe_unit_amount, overage_cap = excluded.overage_cap,
        updated_at = case when (s.stripe_customer_id, s.stripe_subscription_id, s.plan, s.term, s.status,
                                s.editor_seats, s.recipes_included, s.current_period_end,
                                s.plan_recipes, s.amount_per_period, s.recipe_unit_amount, s.overage_cap)
                               is not distinct from
                               (excluded.stripe_customer_id, excluded.stripe_subscription_id, excluded.plan,
                                excluded.term, excluded.status, excluded.editor_seats, excluded.recipes_included,
                                excluded.current_period_end, excluded.plan_recipes, excluded.amount_per_period,
                                excluded.recipe_unit_amount, excluded.overage_cap)
                          then s.updated_at else now() end
  returning * into v_new;

  v_ws_plan := case when v_live then v_plan
                    when v_status in ('canceled', 'incomplete_expired') then 'free'
                    else v_ws.plan end;
  v_ws_status := case when v_ws.status in ('closed', 'dormant') then v_ws.status
                      when v_status in ('active', 'trialing') then 'active'
                      when v_status in ('past_due', 'unpaid') and v_ws.status = 'active' then 'dunning'
                      -- A cancelled subscription whose invoices are all settled leaves dunning, so a Free workspace is
                      -- never left stopped by a debt that no longer exists (T-704 review).
                      when v_status in ('canceled', 'incomplete_expired')
                           and v_ws.status in ('dunning', 'new_artwork_stopped')
                           and not exists (select 1 from private.dunning_failures() f where f.workspace_id = p_ws)
                        then 'active'
                      else v_ws.status end;
  if (v_ws_plan, v_ws_status) is distinct from (v_ws.plan, v_ws.status) then
    update app.workspaces set plan = v_ws_plan, status = v_ws_status where id = p_ws;
  end if;

  if (v_ws_plan, v_ws_status) is not distinct from (v_ws.plan, v_ws.status)
     and v_old.workspace_id is not null and v_new.updated_at = v_old.updated_at then
    return 'unchanged';
  end if;
  perform private.write_audit(p_ws, 'billing.subscription_synced', 'subscription', v_sub,
    jsonb_build_object('plan', v_ws.plan, 'status', v_ws.status, 'subscription_status', v_old.status,
                       'recipes_included', v_old.recipes_included, 'amount_per_period', v_old.amount_per_period),
    jsonb_build_object('plan', v_ws_plan, 'status', v_ws_status, 'subscription_status', v_status,
                       'recipes_included', v_new.recipes_included, 'amount_per_period', v_new.amount_per_period,
                       'source', p_source, 'ref', left(p_ref, 255)));
  return 'applied';
end $$;
revoke execute on function app.apply_subscription(uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function app.apply_subscription(uuid, jsonb, text, text) to service_role;

-- What the recipe_overage worker needs, read under the lock's same rules: the live count and the mirror.
create function app.recipe_overage_context(p_ws uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  perform private.require_service();
  select jsonb_build_object('workspace_id', s.workspace_id, 'stripe_subscription_id', s.stripe_subscription_id,
                            'plan', s.plan, 'term', s.term, 'status', s.status,
                            'live_recipes', private.live_recipes(p_ws), 'plan_recipes', s.plan_recipes,
                            'recipes_included', s.recipes_included, 'amount_per_period', s.amount_per_period,
                            'recipe_unit_amount', s.recipe_unit_amount, 'overage_cap', s.overage_cap)
    into v
  from app.subscriptions s where s.workspace_id = p_ws;
  return v;
end $$;
revoke execute on function app.recipe_overage_context(uuid) from public, anon, authenticated;
grant execute on function app.recipe_overage_context(uuid) to service_role;

-- ─── BE-36: the dunning log (insert-only) ────────────────────────────────────────────────────────────────────────
create table app.dunning_steps (
  workspace_id      uuid not null references app.workspaces(id),
  stripe_invoice_id text not null check (stripe_invoice_id ~ '^in_[A-Za-z0-9_]{1,250}$'),
  day               smallint not null check (day in (0, 3, 7, 14)),
  failed_at         timestamptz not null,           -- day 0: the invoice's first invoice.payment_failed event
  outcome           text not null check (outcome in ('notified', 'resolved')),
  job_ref           text,
  created_at        timestamptz not null default now(),
  primary key (stripe_invoice_id, day)
);
create index dunning_steps_workspace on app.dunning_steps (workspace_id, created_at desc);
comment on table app.dunning_steps is 'BE-36: one row per dunning step taken for a Stripe invoice; insert-only';

alter table app.dunning_steps enable row level security;
create policy read_admin on app.dunning_steps for select to authenticated
  using (private.has_role(workspace_id, '{admin}'));
revoke all on app.dunning_steps from anon, authenticated;
grant select on app.dunning_steps to authenticated;
grant all on app.dunning_steps to service_role;
revoke update, delete, truncate on app.dunning_steps from authenticated, service_role, anon;
create trigger insert_only_row before update or delete on app.dunning_steps
  for each row execute function private.reject_mutation();
create trigger insert_only_truncate before truncate on app.dunning_steps
  for each statement execute function private.reject_mutation();

-- The dunning reads look invoices up by type and Stripe object id (insert-only table: an index only adds).
create index payment_events_type_object on app.payment_events (type, ((payload->'data'->'object'->>'id')));

-- Open payment failures: the first invoice.payment_failed per Stripe invoice that has no invoice.paid event.
create function private.dunning_failures() returns table (workspace_id uuid, stripe_invoice_id text, failed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select f.workspace_id, f.invoice_id, min(f.at)
  from (select e.workspace_id, e.payload->'data'->'object'->>'id' as invoice_id,
               coalesce(to_timestamp(case when (e.payload->>'created') ~ '^[0-9]{1,12}$'
                                          then (e.payload->>'created')::bigint end), e.received_at) as at
        from app.payment_events e
        where e.type = 'invoice.payment_failed' and e.workspace_id is not null) f
  where f.invoice_id ~ '^in_[A-Za-z0-9_]{1,250}$'
    and not exists (select 1 from app.payment_events p
                    where p.type = 'invoice.paid' and p.payload->'data'->'object'->>'id' = f.invoice_id)
  group by f.workspace_id, f.invoice_id
$$;
revoke execute on function private.dunning_failures() from public, anon, authenticated;
grant execute on function private.dunning_failures() to service_role;

-- The steps due now: per open invoice, the latest day that has passed, unless that day or a later one is recorded.
-- Only the latest is returned, so a worker that was down for a week sends one email, not three (and a skipped day 3
-- or 7 is also a skipped retry: built behaviour, docs/08).
create function app.dunning_due() returns table (workspace_id uuid, stripe_invoice_id text, day int,
                                                 failed_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_service();
  return query
  select f.workspace_id, f.stripe_invoice_id, d.day, f.failed_at
  from private.dunning_failures() f
  join app.workspaces w on w.id = f.workspace_id and w.status not in ('closed', 'dormant')
  -- Only while the mirrored subscription is still owed and live: after a cancellation nothing is retried, emailed or
  -- stopped (#65 Q9).
  join app.subscriptions sub on sub.workspace_id = f.workspace_id and sub.status in ('past_due', 'unpaid')
  cross join lateral (select max(x) as day from unnest(array[0, 3, 7, 14]) x
                      where f.failed_at + make_interval(days => x) <= now()) d
  where d.day is not null
    and not exists (select 1 from app.dunning_steps s
                    where s.stripe_invoice_id = f.stripe_invoice_id and s.day >= d.day)
  order by f.failed_at, f.stripe_invoice_id;
end $$;
revoke execute on function app.dunning_due() from public, anon, authenticated;
grant execute on function app.dunning_due() to service_role;

-- Record a step once. 'notified' queues the payment_failed email and, on day 14, stops new artworks ('dunning' →
-- 'new_artwork_stopped') and nothing else; 'resolved' means Stripe says the invoice no longer needs paying, and
-- changes nothing.
create function app.record_dunning_step(p_ws uuid, p_invoice text, p_day int, p_outcome text, p_ref text)
returns text
language plpgsql security definer set search_path = '' as $$
declare v_failed timestamptz; v_rows int; v_status text; v_event text; v_job uuid; v_stopped boolean := false;
begin
  perform private.require_service();
  if p_day is null or p_day not in (0, 3, 7, 14) or p_outcome is null or p_outcome not in ('notified', 'resolved') then
    raise exception 'not a dunning step' using errcode = '22023';
  end if;
  select f.failed_at into v_failed from private.dunning_failures() f
  where f.workspace_id = p_ws and f.stripe_invoice_id = p_invoice;
  if v_failed is null then
    if exists (select 1 from app.dunning_steps s
               where s.workspace_id = p_ws and s.stripe_invoice_id = p_invoice and s.day = p_day) then
      return 'duplicate';
    end if;
    if exists (select 1 from app.payment_events e
               where e.workspace_id = p_ws and e.type = 'invoice.payment_failed'
                 and e.payload->'data'->'object'->>'id' = p_invoice)
       and exists (select 1 from app.payment_events e
                   where e.type = 'invoice.paid' and e.payload->'data'->'object'->>'id' = p_invoice) then
      return 'paid';                            -- invoice.paid arrived meanwhile: the schedule has ended
    end if;
    raise exception 'no open payment failure for this invoice in this workspace' using errcode = '22023';
  end if;
  if exists (select 1 from app.workspaces w where w.id = p_ws and w.status in ('closed', 'dormant')) then
    raise exception 'a closed or dormant workspace gets no dunning' using errcode = '22023';
  end if;
  if v_failed + make_interval(days => p_day) > now() then
    raise exception 'dunning day % is not due yet', p_day using errcode = '22023';
  end if;
  insert into app.dunning_steps (workspace_id, stripe_invoice_id, day, failed_at, outcome, job_ref)
  values (p_ws, p_invoice, p_day, v_failed, p_outcome, left(p_ref, 255))
  on conflict (stripe_invoice_id, day) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return 'duplicate';
  end if;
  select w.status into v_status from app.workspaces w where w.id = p_ws for update;
  if p_day = 14 and p_outcome = 'notified' and v_status = 'dunning'
     and exists (select 1 from app.subscriptions sub where sub.workspace_id = p_ws
                 and sub.status in ('past_due', 'unpaid')) then
    v_stopped := true;
    update app.workspaces set status = 'new_artwork_stopped' where id = p_ws;
    perform private.write_audit(p_ws, 'billing.new_artwork_stopped', 'workspace', p_ws::text,
                                jsonb_build_object('status', v_status),
                                jsonb_build_object('status', 'new_artwork_stopped', 'stripe_invoice_id', p_invoice));
  end if;
  v_stopped := v_stopped or v_status = 'new_artwork_stopped';   -- the email says what is true after this step
  if p_outcome = 'notified' then
    -- The email goes through the notify job (Template payment_failed), once per invoice and day; the payload names
    -- the latest stored failure event, whose invoice carries the amount and the payer, and the day: ids only.
    select e.stripe_event_id into v_event from app.payment_events e
    where e.workspace_id = p_ws and e.type = 'invoice.payment_failed' and e.payload->'data'->'object'->>'id' = p_invoice
    order by e.received_at desc, e.stripe_event_id desc limit 1;
    v_job := private.enqueue('notify', p_ws, 'payment_failed:' || p_invoice || ':' || p_day::text,
                             jsonb_build_object('template', 'payment_failed', 'payment_event_id', v_event,
                                                'day', p_day, 'stopped', v_stopped));
  end if;
  perform private.write_audit(p_ws, 'billing.dunning_step', 'payment_invoice', p_invoice, null,
                              jsonb_build_object('day', p_day, 'outcome', p_outcome, 'ref', left(p_ref, 255),
                                                 'notify_job_id', v_job));
  return 'recorded';
end $$;
revoke execute on function app.record_dunning_step(uuid, text, int, text, text) from public, anon, authenticated;
grant execute on function app.record_dunning_step(uuid, text, int, text, text) to service_role;

-- ─── The daily schedule (docs/17 Sentry cron monitor 'dunning') ──────────────────────────────────────────────────
create function private.enqueue_dunning() returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_service();
  return private.enqueue('dunning', null,
                         'dunning:' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD'), '{}'::jsonb);
end $$;
revoke execute on function private.enqueue_dunning() from public, anon, authenticated;
grant execute on function private.enqueue_dunning() to service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('dunning', '41 7 * * *', 'select private.enqueue_dunning()');
  else
    raise notice 'pg_cron is not available: the daily dunning job is not scheduled';
  end if;
end $$;
