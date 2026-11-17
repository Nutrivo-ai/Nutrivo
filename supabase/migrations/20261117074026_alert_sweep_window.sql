-- T-904 (#232) · The alert sweep evaluates only the diffs whose effective date newly arrived.
--
-- Before: app.run_alert_sweep built its due set from every 'coming' alert with effective_from <= the day and no
-- in_force row. A stale 'coming' alert (its recipe re-checked without the rule, or discontinued) never gets an
-- in_force row (J03.must.1, BE-24), so it stayed due and every daily sweep ran contract 5 (app.affected_objects,
-- a scan of app.checks) for its diff again, forever.
--
-- Now: each completed sweep records its day in private.alert_sweeps (insert-only, one row per day, written in the
-- sweep's own transaction, so a row means the sweep committed). A sweep for p_day evaluates only the 'coming' alerts
-- whose effective_from is after the latest recorded sweep day on or before p_day, and on or before p_day:
--   · a stale alert is evaluated once, on the first sweep its date falls in, and left alone after;
--   · a missed day is caught up, because the window starts at the last completed sweep, not at yesterday;
--   · repeating a day evaluates nothing (the window is empty) and writes nothing;
--   · with no sweep recorded yet (the first sweep after this migration) the window has no lower bound: every
--     arrived alert is evaluated once, as before.
-- The in_force correctness is unchanged: an in_force row is written only where contract 5 still names the
-- product × market, as a new row, once (alerts_one_per_phase). The notify step is unchanged.
-- Expand only: the function keeps its signature; its result gains `since` and `diffs` (the worker logs the result).

create table private.alert_sweeps (
  day      date primary key,
  swept_at timestamptz not null default now()
);
revoke all on private.alert_sweeps from public, anon, authenticated;
grant select, insert on private.alert_sweeps to service_role;
create trigger insert_only_row before update or delete on private.alert_sweeps
  for each row execute function private.reject_mutation();
create trigger insert_only_truncate before truncate on private.alert_sweeps
  for each statement execute function private.reject_mutation();

-- Service role only (the worker's diff_fanout sweep job). Repeating a day changes nothing.
-- Returns {day, since, diffs, in_force, notify_jobs}: the window's exclusive lower bound (null when no earlier sweep
-- is recorded), the diffs whose contract 5 it evaluated, and the in_force rows and notify jobs this call wrote.
create or replace function app.run_alert_sweep(p_day date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_in_force int; v_jobs int := 0; v_pair record; v_since date; v_diffs int;
begin
  if not private.is_service_caller() then
    raise exception 'the alert sweep is run by the worker only' using errcode = '42501';
  end if;
  if p_day is null or p_day > (now() at time zone 'UTC')::date then
    raise exception 'the sweep day must be today or earlier' using errcode = '22023';
  end if;

  -- The last completed sweep on or before this day. A sweep for an earlier day run late (a retry) only looks back
  -- from its own day, so it never skips a date a later sweep has not covered.
  select max(s.day) into v_since from private.alert_sweeps s where s.day <= p_day;

  -- Only where contract 5 still names the product × market: a recipe re-checked since the fan-out (a reformulation
  -- that no longer applies or withholds the rule) or discontinued gets no in_force alert (BE-24, J03.must.1).
  -- Only diffs whose date newly arrived in (v_since, p_day] are evaluated (alerts_coming_due serves the range).
  with due as (
    select distinct a.rule_diff_id from app.alerts a
    where a.phase = 'coming' and a.effective_from <= p_day
      and (v_since is null or a.effective_from > v_since)
      and not exists (select 1 from app.alerts f where f.rule_diff_id = a.rule_diff_id and f.product_id = a.product_id
                        and f.node_id = a.node_id and f.phase = 'in_force')),
  still as (
    select d.rule_diff_id, ao.product_id, ao.node_id
    from due d cross join lateral app.affected_objects(d.rule_diff_id) ao),
  ins as (
    insert into app.alerts (workspace_id, rule_diff_id, product_id, node_id, phase, effect_type, effective_from,
                            sell_through_until)
    select a.workspace_id, a.rule_diff_id, a.product_id, a.node_id, 'in_force', a.effect_type, a.effective_from,
           a.sell_through_until
    from app.alerts a
    join still s on s.rule_diff_id = a.rule_diff_id and s.product_id = a.product_id and s.node_id = a.node_id
    where a.phase = 'coming' and a.effective_from <= p_day
      and (v_since is null or a.effective_from > v_since)
    on conflict (rule_diff_id, product_id, node_id, phase) do nothing
    returning 1)
  select (select count(*)::int from due), (select count(*)::int from ins) into v_diffs, v_in_force;

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

  insert into private.alert_sweeps (day) values (p_day) on conflict (day) do nothing;
  return jsonb_build_object('day', p_day, 'since', v_since, 'diffs', v_diffs, 'in_force', v_in_force,
                            'notify_jobs', v_jobs);
end $$;

revoke all on function app.run_alert_sweep(date) from public, anon, authenticated;
grant execute on function app.run_alert_sweep(date) to service_role;
