-- T-903 · J05 scoped re-check (BE-25, BE-42) and I05 supersession (BE-30). docs/workflows/J05.md, I05.md.
-- Additive only (expand): one unique index and one guard trigger on app.supersessions, two RPCs. No new table, no new
-- client grant. app.supersessions is insert-only (BE-05) and keeps its T-409 scope trigger and read policy.
--
-- The flow:
-- 1. A release writes its rule diffs and queues diff_fanout for each material one (T-204, T-901). The worker's
--    diff_fanout job writes the alerts (app.fan_out_rule_diff), then calls app.supersede_for_rule_diff: every report
--    whose checks applied or withheld the diff's rule under an earlier ruleset, and every certificate of such a report,
--    gets one app.supersessions row for the diff. Never for an editorial diff (BE-30), and superseded is a status of
--    its own, never 'invalid': public.verify_reference answers current or superseded only (unchanged).
-- 2. Staff call app.request_scoped_recheck(diff): one 'recheck' job per recipe (product) that contract 5 names, with
--    the markets it names (BE-42: one event per recipe). The worker re-evaluates only the rules whose ruleset member
--    changed, on those markets' panels, and carries every other outcome forward (BE-25; worker/handlers/recheck.py).
--
-- Re-checks use contract 5 (app.affected_objects), as alerts do: the latest check of each product × market, products
-- not discontinued. Supersession reads every issued report's own pinned checks instead, since a report relied on the
-- rule when it was issued whatever has been checked since. A rule no earlier check applied or withheld (a brand-new
-- obligation) names nothing in either, so it re-checks and supersedes nothing (default; founder question on #75).

-- ─── Supersessions: once per artefact × diff, only from a material diff ─────────────────────────────────────────
create unique index supersessions_once on app.supersessions (artefact_type, artefact_id, rule_diff_id);

-- A supersession that names a diff takes it from a material one (I05.must.1 in the schema itself), and its rule_key
-- and ruleset_version are the diff's. app.supersede_for_rule_diff, the only producer, always names the diff; a row
-- without one (a service-role writer such as the I04 verification tests) is not checked against a diff.
create function private.supersession_diff_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_d ref.rule_diffs;
begin
  if new.rule_diff_id is null then
    return new;
  end if;
  select * into v_d from ref.rule_diffs rd where rd.id = new.rule_diff_id;
  if not found then
    raise exception 'rule diff % does not exist', new.rule_diff_id using errcode = '23514';
  end if;
  if v_d.effect_type = 'editorial' then
    raise exception 'an editorial diff never supersedes a document (BE-30)' using errcode = '23514';
  end if;
  if new.rule_key is distinct from v_d.rule_key or new.ruleset_version is distinct from v_d.ruleset_version then
    raise exception 'a supersession''s rule and ruleset are its diff''s' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger supersessions_diff_guard before insert on app.supersessions
  for each row execute function private.supersession_diff_guard();

-- ─── 1 · app.supersede_for_rule_diff: the documents a material diff supersedes ──────────────────────────────────
-- Service role only (the worker's diff_fanout job, after the alerts). An unknown diff is P0002; an editorial diff
-- writes nothing and says so. A report is affected when one of its checks applied or withheld the diff's rule and the
-- report pins a ruleset released before the diff's (a report on the diff's ruleset or later already reflects it);
-- each certificate of an affected report is superseded with it. Idempotent (supersessions_once). Audited
-- 'artefact.superseded' once per workspace with new rows, pinned to the diff's ruleset.
-- Returns {rule_diff_id, effect_type, reports, certificates}: the rows this call wrote.
create function app.supersede_for_rule_diff(p_rule_diff uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_d ref.rule_diffs; v_released timestamptz; v_reports int := 0; v_certs int := 0; v_ws record;
begin
  if not private.is_service_caller() then
    raise exception 'supersessions are written by the worker only' using errcode = '42501';
  end if;
  select * into v_d from ref.rule_diffs rd where rd.id = p_rule_diff;
  if not found then
    raise exception 'rule diff % does not exist', p_rule_diff using errcode = 'P0002';
  end if;
  if v_d.effect_type = 'editorial' then
    return jsonb_build_object('rule_diff_id', v_d.id, 'effect_type', v_d.effect_type, 'reports', 0,
                              'certificates', 0, 'skipped', 'editorial');
  end if;
  select rv.released_at into v_released from ref.ruleset_versions rv where rv.id = v_d.ruleset_version;

  for v_ws in
    with affected as (
      select r.id, r.workspace_id from app.reports r
      join ref.ruleset_versions rrv on rrv.id = r.ruleset_version
      where rrv.released_at < v_released
        and exists (select 1 from app.checks c
                    where c.id = any(r.check_ids)
                      and (c.applied_rule_keys @> array[v_d.rule_key]
                           or c.withheld_rule_keys @> array[v_d.rule_key]))),
    artefacts as (
      select 'report'::text as artefact_type, a.id, a.workspace_id from affected a
      union all
      select 'certificate', ce.id, ce.workspace_id from app.certificates ce join affected a on a.id = ce.report_id),
    ins as (
      insert into app.supersessions (workspace_id, artefact_type, artefact_id, rule_key, rule_diff_id, ruleset_version)
      select x.workspace_id, x.artefact_type, x.id, v_d.rule_key, v_d.id, v_d.ruleset_version from artefacts x
      on conflict (artefact_type, artefact_id, rule_diff_id) do nothing
      returning workspace_id, artefact_type)
    select ins.workspace_id, count(*) filter (where ins.artefact_type = 'report')::int as reports,
           count(*) filter (where ins.artefact_type = 'certificate')::int as certificates
    from ins group by ins.workspace_id order by ins.workspace_id
  loop
    v_reports := v_reports + v_ws.reports;
    v_certs := v_certs + v_ws.certificates;
    perform private.write_audit(v_ws.workspace_id, 'artefact.superseded', 'rule_diff', v_d.id::text, null,
                                jsonb_build_object('reports', v_ws.reports, 'certificates', v_ws.certificates,
                                                   'effect_type', v_d.effect_type, 'rule_key', v_d.rule_key),
                                v_d.ruleset_version);
  end loop;
  return jsonb_build_object('rule_diff_id', v_d.id, 'effect_type', v_d.effect_type, 'reports', v_reports,
                            'certificates', v_certs);
end $$;

-- ─── 2 · app.request_scoped_recheck: one recheck job per recipe that contract 5 names ───────────────────────────
-- Staff only (private.require_staff: 42501). An unknown diff is P0002; an editorial diff queues nothing and says so.
-- One 'recheck' job per product named by app.affected_objects, payload {product_id, node_ids, rule_diff_id} (ids
-- only), key recheck:<diff>:<product>, so a repeated request returns the same jobs and queues none. The job's scope
-- (product and markets) is set by the T-409 trigger from the payload. Audited 'recheck.requested' per workspace
-- with newly queued jobs (a repeated request writes no audit row).
-- Returns {rule_diff_id, ruleset_version, effect_type, jobs: [{workspace_id, product_id, node_ids, job_id}]}.
create function app.request_scoped_recheck(p_rule_diff uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_person uuid := private.require_staff(); v_d ref.rule_diffs; v_p record; v_job uuid; v_key text;
        v_jobs jsonb := '[]'; v_ws uuid; v_n int := 0;
begin
  select * into v_d from ref.rule_diffs rd where rd.id = p_rule_diff;
  if not found then
    raise exception 'rule diff % does not exist', p_rule_diff using errcode = 'P0002';
  end if;
  if v_d.effect_type = 'editorial' then
    return jsonb_build_object('rule_diff_id', v_d.id, 'ruleset_version', v_d.ruleset_version,
                              'effect_type', v_d.effect_type, 'jobs', '[]'::jsonb, 'skipped', 'editorial');
  end if;

  for v_p in
    select ao.workspace_id, ao.product_id, array_agg(ao.node_id order by ao.node_id) as node_ids
    from app.affected_objects(v_d.id) ao
    group by ao.workspace_id, ao.product_id
    order by ao.workspace_id, ao.product_id
  loop
    if v_ws is distinct from v_p.workspace_id then
      if v_ws is not null and v_n > 0 then
        perform private.write_audit(v_ws, 'recheck.requested', 'rule_diff', v_d.id::text, null,
                                    jsonb_build_object('recipes', v_n, 'rule_key', v_d.rule_key), v_d.ruleset_version);
      end if;
      v_ws := v_p.workspace_id;
      v_n := 0;
    end if;
    v_key := 'recheck:' || v_d.id::text || ':' || v_p.product_id::text;
    if not exists (select 1 from app.jobs j where j.idempotency_key = v_key) then
      v_n := v_n + 1;                 -- audited: newly queued recipes only
    end if;
    v_job := private.enqueue('recheck', v_p.workspace_id, v_key,
                             jsonb_build_object('product_id', v_p.product_id, 'node_ids', to_jsonb(v_p.node_ids),
                                                'rule_diff_id', v_d.id));
    v_jobs := v_jobs || jsonb_build_object('workspace_id', v_p.workspace_id, 'product_id', v_p.product_id,
                                           'node_ids', to_jsonb(v_p.node_ids), 'job_id', v_job);
  end loop;
  if v_ws is not null and v_n > 0 then
    perform private.write_audit(v_ws, 'recheck.requested', 'rule_diff', v_d.id::text, null,
                                jsonb_build_object('recipes', v_n, 'rule_key', v_d.rule_key), v_d.ruleset_version);
  end if;
  return jsonb_build_object('rule_diff_id', v_d.id, 'ruleset_version', v_d.ruleset_version,
                            'effect_type', v_d.effect_type, 'jobs', v_jobs);
end $$;

-- ─── Grants ──────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function app.supersede_for_rule_diff(uuid), app.request_scoped_recheck(uuid),
                       private.supersession_diff_guard()
  from public, anon, authenticated;
grant execute on function app.supersede_for_rule_diff(uuid) to service_role;
grant execute on function app.request_scoped_recheck(uuid) to authenticated, service_role;
