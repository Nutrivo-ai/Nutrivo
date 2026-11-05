-- T-305 · the extraction follow-ups from #41 (D01). Additive: a publication member, one private helper, a redefinition of
-- private.enqueue with the same signature and grants, and one RPC. Tests: supabase/tests/app/47_jobs_realtime_retry.test.sql.

-- ─── 1 · app.jobs joins the supabase_realtime publication ───────────────────────────────────────────────────────
-- The web subscribes to Postgres changes on app.jobs filtered by its job's id (docs/04). Realtime authorizes each
-- change against the subscriber's claims with the table's own RLS (read_member: members of the job's workspace), so
-- another workspace never receives a job. Realtime does not apply RLS to DELETE events (it sends the deleted row's
-- primary key to every subscriber of the table), so app.jobs rows are never deleted while the table is published;
-- a retention job would first need to change that (docs/04). Guarded: a database without the publication (plain Postgres in CI tools)
-- still migrates.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'app' and tablename = 'jobs') then
    alter publication supabase_realtime add table app.jobs;
  end if;
end $$;

-- ─── 2 · request_id from the request into job payloads (docs/17) ────────────────────────────────────────────────
-- PostgREST exposes the request's headers as the setting request.headers (lower-case names). The web sends its
-- request_id as x-request-id; it is kept only when it is a plain token, as the web's resolveRequestId and
-- app.request_report do, so a caller cannot put arbitrary text into payloads, logs or Sentry tags. Outside a request
-- (pg_cron, the worker, psql) there is no header and the result is null.
create function private.request_id() returns text
language plpgsql stable set search_path = '' as $$
declare v_headers text := nullif(current_setting('request.headers', true), ''); v_rid text;
begin
  if v_headers is null then return null; end if;
  begin
    v_rid := v_headers::jsonb ->> 'x-request-id';
  exception when others then
    return null;
  end;
  return case when v_rid ~ '^[A-Za-z0-9-]{8,64}$' then v_rid end;
end $$;
revoke all on function private.request_id() from public, anon, authenticated;
grant execute on function private.request_id() to service_role;

-- Same body as 20261008000005, plus the request_id: a payload that names its own request_id keeps it (request_report,
-- request_export pass it explicitly); otherwise the request's x-request-id is added when it is a plain token. Payloads
-- stay ids only. create or replace keeps the #179 grants: never authenticated, so every caller is security definer.
create or replace function private.enqueue(p_kind text, p_ws uuid, p_key text, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_job uuid; v_rid text; v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if not v_payload ? 'request_id' then
    v_rid := private.request_id();
    if v_rid is not null then v_payload := v_payload || jsonb_build_object('request_id', v_rid); end if;
  end if;
  insert into app.jobs (kind, workspace_id, idempotency_key, payload, requested_by)
  values (p_kind, p_ws, p_key, v_payload, private.person_id())
  on conflict (idempotency_key) do nothing
  returning id into v_job;
  if v_job is null then
    select j.id into v_job from app.jobs j where j.idempotency_key = p_key;
    return v_job;
  end if;
  if to_regnamespace('pgmq') is not null then
    execute format('select pgmq.send(%L, %L::jsonb)', p_kind, jsonb_build_object('job_id', v_job)::text);
  end if;
  return v_job;
end $$;
revoke execute on function private.enqueue(text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function private.enqueue(text, uuid, text, jsonb) to service_role;

-- ─── 3 · app.retry_extraction: a person retries a failed extraction (docs/18 "user sees retry") ─────────────────
-- Who: whoever may register artwork for the product (private.can_edit_product); anyone else, another workspace and an
-- unknown artwork are 42501, so an artwork's existence never leaks. One artwork version has one extract job (key
-- extract:<artwork_version_id>), and a retry reuses it: only a failed job is reset to queued with attempts 0, its
-- error and progress cleared and the request's request_id, then sent a fresh pgmq message and audited
-- extraction.retried with the error it had. A queued, running, succeeded or cancelled job is returned unchanged, so
-- a second click queues nothing. The job id stays the same, so the web's Realtime subscription keeps working. The
-- worker's extract handler is idempotent per run key, so a retry never writes a run twice. A retry is not a new
-- artwork: it never consumes the allowance (BE-32) and dunning never stops it (BE-36).
create function app.retry_extraction(p_artwork uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_av app.artwork_versions; v_job app.jobs; v_rid text;
begin
  select * into v_av from app.artwork_versions av where av.id = p_artwork;
  if not found or not private.can_edit_product(v_av.product_id) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  select * into v_job from app.jobs j
  where j.idempotency_key = 'extract:' || v_av.id::text and j.kind = 'extract' and j.workspace_id = v_av.workspace_id
  for update;
  if not found then
    raise exception 'this artwork has no extraction to retry' using errcode = 'P0002';
  end if;
  if v_job.status <> 'failed' then
    return v_job.id;
  end if;
  v_rid := private.request_id();
  update app.jobs j
  set status = 'queued', attempts = 0, last_error = null, progress = '{}'::jsonb, updated_at = now(),
      payload = (j.payload - 'request_id')
                || case when v_rid is null then '{}'::jsonb else jsonb_build_object('request_id', v_rid) end
  where j.id = v_job.id;
  if to_regnamespace('pgmq') is not null then
    execute format('select pgmq.send(%L, %L::jsonb)', 'extract', jsonb_build_object('job_id', v_job.id)::text);
  end if;
  perform private.write_audit(v_av.workspace_id, 'extraction.retried', 'job', v_job.id::text,
                              jsonb_build_object('status', v_job.status, 'attempts', v_job.attempts,
                                                 'last_error', v_job.last_error),
                              jsonb_build_object('status', 'queued', 'artwork_version_id', v_av.id));
  return v_job.id;
end $$;
revoke execute on function app.retry_extraction(uuid) from public, anon;
grant execute on function app.retry_extraction(uuid) to authenticated;
