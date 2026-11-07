-- T-408 · I01: app.request_report(p_check, p_request_id), the producer of the worker's 'report' job (T-405, #47).
-- Additive: one RPC. Tests: supabase/tests/app/45_request_report.test.sql.
--
-- Who may request (answers pending on #188, conservative defaults): an active person with an editor-class role
-- (admin, portfolio_manager, editor; external members included) who sees the check's product (private.can_see_product,
-- family scope) and its market (private.node_in_scope). Viewers, other workspaces, members scoped to another market
-- and an unknown check are all 42501, so a check's existence never leaks.
--
-- One check, one job (#188 Q1): the key is 'report:<check_id>'. A check is immutable, so a repeat request returns the
-- check's job whatever its status, queues nothing and writes no audit; the worker mints one reference per job, so the
-- check keeps one document (BE-26). A failed job stays the check's job until a retry policy is decided (#188 Q3).
-- The payload holds ids only, exactly what worker/src/nutrivo_worker/handlers/report.py reads: {check_id} and the
-- web's request_id, kept only when it is a plain token. Security definer: #179 revoked private.enqueue and
-- private.write_audit from authenticated.
create function app.request_report(p_check uuid, p_request_id text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_c app.checks; v_key text; v_job uuid; v_rid text;
begin
  select * into v_c from app.checks c where c.id = p_check;
  if not found or private.person_id() is null
     or not private.can_see_product(v_c.product_id)
     or not private.node_in_scope(v_c.workspace_id, v_c.node_id)
     or not private.has_role(v_c.workspace_id, '{admin,portfolio_manager,editor}') then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  v_key := 'report:' || v_c.id::text;
  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));
  select j.id into v_job from app.jobs j
  where j.idempotency_key = v_key and j.kind = 'report' and j.workspace_id = v_c.workspace_id;
  if v_job is not null then
    return v_job;
  end if;
  v_rid := case when p_request_id ~ '^[A-Za-z0-9-]{8,64}$' then p_request_id end;
  v_job := private.enqueue('report', v_c.workspace_id, v_key,
                           jsonb_build_object('check_id', v_c.id)
                           || case when v_rid is null then '{}'::jsonb else jsonb_build_object('request_id', v_rid) end);
  perform private.write_audit(v_c.workspace_id, 'report.requested', 'job', v_job::text, null,
                              jsonb_build_object('check_id', v_c.id, 'product_id', v_c.product_id,
                                                 'node_id', v_c.node_id, 'language', v_c.language),
                              v_c.ruleset_version);
  return v_job;
end $$;
revoke execute on function app.request_report(uuid, text) from public, anon;
grant execute on function app.request_report(uuid, text) to authenticated;
