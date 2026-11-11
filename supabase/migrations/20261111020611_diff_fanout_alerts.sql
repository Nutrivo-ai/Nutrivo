-- T-901 · J03 impact analysis and alerts. BE-24 (alerts name recipes through the applied-rule join, contract 5),
-- BE-39 (read state is per person), BE-09 (an editorial diff never reaches alerts). docs/workflows/J03.md.
-- Additive only (expand): three indexes on app.alerts, contract 5 corrected with its signature unchanged, three
-- service-role RPCs, one authenticated RPC and a daily
-- pg_cron schedule. app.alerts and app.alert_reads already exist (0003) with RLS and their read policies (0004,
-- market scope in 20261103130000); no new table, no new client grant.
--
-- The flow:
-- 1. app.release_ruleset queues one diff_fanout job per non-editorial diff (T-204). The worker calls
--    app.fan_out_rule_diff, which writes one alert per row of app.affected_objects (contract 5: a join over the
--    latest check's applied and withheld rule keys per product × market, never a re-evaluation). phase is 'coming'
--    while the diff's effective_from is after the UTC day, else 'in_force'; the dates are the diff's.
-- 2. pg_cron queues one diff_fanout sweep job a day (07:23 UTC, key diff_fanout:sweep:<day>). The worker calls
--    app.run_alert_sweep, which (a) writes the 'in_force' row of each 'coming' alert whose date has arrived and that
--    contract 5 still names (a new row: nothing is updated) and (b) queues one notify 'rule_changed' job per diff × workspace that has alerts, key
--    rule_changed:<diff>:<workspace>: Template 03's "per material change, batched daily, never hourly". The second
--    phase never sends a second email (same key). Both defaults are a founder question on #72.
-- 3. app.mark_alerts_read records the caller's own read of alerts they can read (BE-39): one row per person.
--
-- Idempotent throughout: a diff × product × market gets its first alert once (whatever the day it is fanned out on),
-- its in_force row once (unique index), and each notify job once (app.jobs.idempotency_key).

-- ─── Indexes ─────────────────────────────────────────────────────────────────────────────────────────────────────
create unique index alerts_one_per_phase on app.alerts (rule_diff_id, product_id, node_id, phase);
create index alerts_workspace_created on app.alerts (workspace_id, created_at desc);   -- the inbox (T-902)
create index alerts_coming_due on app.alerts (effective_from) where phase = 'coming';  -- the daily sweep

-- ─── Contract 5, corrected: a check with no job is the latest only by itself ────────────────────────────────────
-- Same signature, same security invoker. The latest check of a product × market is the newest row, and the checks of
-- the same job (one per language panel) are latest with it. 0005 matched the job with `is not distinct from`, so when
-- the newest check had no job_id every jobless check of that product × market counted as latest and an older check
-- that applied the rule still named the recipe. The worker always sets job_id, so this changes nothing for its checks.
create or replace function app.affected_objects(p_rule_diff uuid)
returns table (workspace_id uuid, product_id uuid, node_id text)
language sql stable security invoker set search_path = '' as $$
  with d as (select rd.rule_key from ref.rule_diffs rd where rd.id = p_rule_diff),
  latest as (
    select distinct on (c.product_id, c.node_id) c.id, c.product_id, c.node_id, c.job_id
    from app.checks c order by c.product_id, c.node_id, c.at desc, c.id)
  select distinct c.workspace_id, c.product_id, c.node_id
  from latest l
  join app.checks c on c.product_id = l.product_id and c.node_id = l.node_id
                   and (c.id = l.id or (l.job_id is not null and c.job_id = l.job_id))
  join app.products pr on pr.id = c.product_id and pr.stage <> 'discontinued'
  cross join d
  where c.applied_rule_keys @> array[d.rule_key] or c.withheld_rule_keys @> array[d.rule_key]
$$;

-- ─── The phase of a diff on a day ────────────────────────────────────────────────────────────────────────────────
-- A diff with no effective_from applies from its release, so it is in force.
create function private.alert_phase(p_effective_from date, p_day date) returns text
language sql immutable set search_path = '' as $$
  select case when p_effective_from is not null and p_effective_from > p_day then 'coming' else 'in_force' end
$$;

-- ─── 1 · app.fan_out_rule_diff: one diff onto the products that applied or withheld its rule ────────────────────
-- Service role only (the worker's diff_fanout job). An unknown diff is P0002. An editorial diff writes nothing and
-- says so (BE-09: app.release_ruleset never queues one, and app.alerts refuses its effect type anyway). Audited
-- 'alerts.fanned_out' once per workspace that got new alerts, pinned to the diff's ruleset.
-- Returns {rule_diff_id, effect_type, alerts, workspaces: [{workspace_id, alerts}]}: the alerts this call wrote.
create function app.fan_out_rule_diff(p_rule_diff uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_d ref.rule_diffs; v_day date := (now() at time zone 'UTC')::date; v_ws record;
        v_total int := 0; v_list jsonb := '[]';
begin
  if not private.is_service_caller() then
    raise exception 'alerts are written by the worker only' using errcode = '42501';
  end if;
  select * into v_d from ref.rule_diffs rd where rd.id = p_rule_diff;
  if not found then
    raise exception 'rule diff % does not exist', p_rule_diff using errcode = 'P0002';
  end if;
  if v_d.effect_type = 'editorial' then
    return jsonb_build_object('rule_diff_id', v_d.id, 'effect_type', v_d.effect_type, 'alerts', 0,
                              'workspaces', '[]'::jsonb, 'skipped', 'editorial');
  end if;

  for v_ws in
    with ins as (
      insert into app.alerts (workspace_id, rule_diff_id, product_id, node_id, phase, effect_type, effective_from,
                              sell_through_until)
      select ao.workspace_id, v_d.id, ao.product_id, ao.node_id, private.alert_phase(v_d.effective_from, v_day),
             v_d.effect_type, v_d.effective_from, v_d.sell_through_until
      from app.affected_objects(v_d.id) ao
      where not exists (select 1 from app.alerts a
                        where a.rule_diff_id = v_d.id and a.product_id = ao.product_id and a.node_id = ao.node_id)
      on conflict (rule_diff_id, product_id, node_id, phase) do nothing
      returning workspace_id)
    select ins.workspace_id, count(*)::int as n from ins group by ins.workspace_id order by ins.workspace_id
  loop
    v_total := v_total + v_ws.n;
    v_list := v_list || jsonb_build_object('workspace_id', v_ws.workspace_id, 'alerts', v_ws.n);
    perform private.write_audit(v_ws.workspace_id, 'alerts.fanned_out', 'rule_diff', v_d.id::text, null,
                                jsonb_build_object('alerts', v_ws.n, 'effect_type', v_d.effect_type,
                                                   'rule_key', v_d.rule_key,
                                                   'phase', private.alert_phase(v_d.effective_from, v_day)),
                                v_d.ruleset_version);
  end loop;
  return jsonb_build_object('rule_diff_id', v_d.id, 'effect_type', v_d.effect_type, 'alerts', v_total,
                            'workspaces', v_list);
end $$;

-- ─── 2 · app.run_alert_sweep: the daily pass (phase change, then the batched rule_changed emails) ───────────────
-- Service role only (the worker's diff_fanout sweep job). Repeating a day changes nothing.
-- Returns {day, in_force, notify_jobs}: the in_force rows and notify jobs this call wrote.
create function app.run_alert_sweep(p_day date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_in_force int; v_jobs int := 0; v_pair record;
begin
  if not private.is_service_caller() then
    raise exception 'the alert sweep is run by the worker only' using errcode = '42501';
  end if;
  if p_day is null or p_day > (now() at time zone 'UTC')::date then
    raise exception 'the sweep day must be today or earlier' using errcode = '22023';
  end if;

  -- Only where contract 5 still names the product × market: a recipe re-checked since the fan-out (a reformulation
  -- that no longer applies or withholds the rule) or discontinued gets no in_force alert (BE-24, J03.must.1).
  with due as (
    select distinct a.rule_diff_id from app.alerts a
    where a.phase = 'coming' and a.effective_from <= p_day
      and not exists (select 1 from app.alerts f where f.rule_diff_id = a.rule_diff_id and f.product_id = a.product_id
                        and f.node_id = a.node_id and f.phase = 'in_force')),
  still as (
    select d.rule_diff_id, ao.product_id, ao.node_id
    from due d cross join lateral app.affected_objects(d.rule_diff_id) ao)
  insert into app.alerts (workspace_id, rule_diff_id, product_id, node_id, phase, effect_type, effective_from,
                          sell_through_until)
  select a.workspace_id, a.rule_diff_id, a.product_id, a.node_id, 'in_force', a.effect_type, a.effective_from,
         a.sell_through_until
  from app.alerts a
  join still s on s.rule_diff_id = a.rule_diff_id and s.product_id = a.product_id and s.node_id = a.node_id
  where a.phase = 'coming' and a.effective_from <= p_day
  on conflict (rule_diff_id, product_id, node_id, phase) do nothing;
  get diagnostics v_in_force = row_count;

  for v_pair in
    select distinct a.rule_diff_id, a.workspace_id from app.alerts a
    where not exists (select 1 from app.jobs j
                      where j.idempotency_key = 'rule_changed:' || a.rule_diff_id::text || ':' || a.workspace_id::text)
    order by a.rule_diff_id, a.workspace_id
  loop
    perform private.enqueue('notify', v_pair.workspace_id,
                            'rule_changed:' || v_pair.rule_diff_id::text || ':' || v_pair.workspace_id::text,
                            jsonb_build_object('template', 'rule_changed', 'rule_diff_id', v_pair.rule_diff_id));
    v_jobs := v_jobs + 1;
  end loop;
  return jsonb_build_object('day', p_day, 'in_force', v_in_force, 'notify_jobs', v_jobs);
end $$;

-- pg_cron's entry point: one sweep job per UTC day.
create function private.enqueue_alert_sweep() returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_day text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD');
begin
  if not private.is_service_caller() then
    raise exception 'the alert sweep is queued by pg_cron only' using errcode = '42501';
  end if;
  return private.enqueue('diff_fanout', null, 'diff_fanout:sweep:' || v_day, jsonb_build_object('sweep', v_day));
end $$;

-- ─── 3 · app.mark_alerts_read: the caller's own read state (BE-39) ──────────────────────────────────────────────
-- Authenticated. Every alert must be one the caller can read under app.alerts' policy (product and market scope),
-- else 42501 for the whole call and nothing is written, so an alert's existence never leaks. Writes one
-- app.alert_reads row per alert for private.person_id() only; an alert already read keeps its first read_at.
-- Returns the number of alerts newly marked read. Not audited: read state is a person's own marker, not a change to
-- workspace data, and app.alert_reads is itself the record.
create function app.mark_alerts_read(p_alerts uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare v_person uuid := private.person_id(); v_n int;
begin
  if v_person is null then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if p_alerts is null or cardinality(p_alerts) = 0 then
    return 0;
  end if;
  if cardinality(p_alerts) > 500 then
    raise exception 'at most 500 alerts at a time' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_alerts) x(id)
             where not exists (select 1 from app.alerts a
                               where a.id = x.id and private.can_see_product(a.product_id)
                                 and private.node_in_scope(a.workspace_id, a.node_id))) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  insert into app.alert_reads (alert_id, person_id)
  select distinct x.id, v_person from unnest(p_alerts) x(id)
  on conflict (alert_id, person_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ─── Grants ──────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function app.fan_out_rule_diff(uuid), app.run_alert_sweep(date), private.enqueue_alert_sweep(),
                       app.mark_alerts_read(uuid[]), private.alert_phase(date, date)
  from public, anon, authenticated;
grant execute on function app.fan_out_rule_diff(uuid), app.run_alert_sweep(date), private.enqueue_alert_sweep(),
                          private.alert_phase(date, date)
  to service_role;
grant execute on function app.mark_alerts_read(uuid[]) to authenticated;

-- ─── Schedule ────────────────────────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('alert-sweep', '23 7 * * *', 'select private.enqueue_alert_sweep()');
  else
    raise notice 'pg_cron is not available: the daily alert sweep is not scheduled';
  end if;
end $$;
