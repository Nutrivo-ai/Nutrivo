-- T-1103 · security sweep (#81). Proven by supabase/tests/app/99_security_sweep.test.sql.
--
-- 1. app.issue_certificate (BE-29, I03) checked membership, the grant, aal2 and the market's open_actions only. It now
--    also requires, before anything is written:
--    - the product in the signer's scope (else the same P0002 as an unknown report) and the node in their market scope
--      (else P0291, as with no grant);
--    - after the grant: the report names this market (22023);
--    - after aal2: the report cites the market's latest check, on the same artwork_sha and ruleset_version (P0294), so
--      an old report is never certified because a later check (new artwork, ruleset, classification or formula) made the
--      market Clear; the report has no Not assessed items, and
--      every check it cites for the market is clear with no action finding (P0293); the market displays Clear, so
--      unknown or blocked registration is never certified (P0293, non-negotiables 3 and 8).
-- 2. app.certificates read policy had product scope only; it now also applies node_in_scope, as
--    private.supersession_visible does.
-- 3. storage policy member_upload_artwork checked the role on the workspace folder only; it now requires
--    private.can_edit_product on the product folder, and that product in the workspace folder.
-- 4. Rate limits on RPCs (docs/11 M11, docs/18 Overload): private.enqueue, which every RPC that queues work or email
--    calls once its permission checks pass, counts the new jobs a signed-in person requests per job kind, per person
--    and per workspace, over a sliding hour (private.rate_limits, private.rate_counters), and refuses past the limit
--    with P0049 and the seconds to wait in the hint. The whole RPC rolls back, so nothing is queued or sent. The worker,
--    pg_cron and the service role are never limited, and a request answered by an existing job (same idempotency key)
--    is not counted. A requeue of a finished job (retry_extraction, request_envelope) counts through a trigger on app.jobs.

-- ─── 1 · issue_certificate ─────────────────────────────────────────────────────────────────────────────────────
create or replace function app.issue_certificate(p_report uuid, p_node text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_r app.reports; v_person uuid := private.person_id(); v_grant uuid; v_open int; v_state text;
        v_latest record; v_cited int; v_bad int;
        v_prev text; v_hash text; v_id uuid := gen_random_uuid();
begin
  select * into v_r from app.reports r where r.id = p_report;
  if not found or not private.is_member(v_r.workspace_id) or not private.can_see_product(v_r.product_id) then
    raise exception 'report not found' using errcode = 'P0002';
  end if;
  if p_node is null or not private.node_in_scope(v_r.workspace_id, p_node) then
    raise exception 'BE-29: no signing grant for %', p_node using errcode = 'P0291';
  end if;
  select g.id into v_grant from app.signing_grants g
  where g.workspace_id = v_r.workspace_id and g.person_id = v_person and g.node_id = p_node and g.revoked_at is null;
  if v_grant is null then raise exception 'BE-29: no signing grant for %', p_node using errcode = 'P0291'; end if;
  if v_r.node_id is distinct from p_node then
    raise exception 'BE-29: this report is not a report for %', p_node using errcode = '22023';
  end if;
  if not private.aal2() then
    raise exception 'BE-29: signing requires two-factor authentication' using errcode = 'P0292';
  end if;
  -- The report must be what the market's latest check judged: same artwork, same ruleset.
  select c.id, c.artwork_sha, c.ruleset_version into v_latest from app.checks c
  where c.product_id = v_r.product_id and c.node_id = p_node order by c.at desc, c.id desc limit 1;
  if v_latest is null or not (v_latest.id = any(v_r.check_ids)) or v_latest.artwork_sha is distinct from v_r.artwork_sha
     or v_latest.ruleset_version is distinct from v_r.ruleset_version then
    raise exception 'BE-29: this report is not the latest check of %: issue a new report first', p_node
      using errcode = 'P0294';
  end if;
  -- Everything the report cites for this market is clear, with no open action and nothing withheld.
  select count(*), count(*) filter (where c.label_state <> 'clear'
                                      or exists (select 1 from app.check_findings f
                                                 where f.check_id = c.id and f.state in ('action','not_assessed')))
    into v_cited, v_bad
  from app.checks c where c.id = any(v_r.check_ids) and c.node_id = p_node;
  if v_r.has_not_assessed or v_cited = 0 or v_bad > 0 then
    raise exception 'BE-29: the report has open or not assessed findings on %; only a clear report can be signed', p_node
      using errcode = 'P0293';
  end if;
  select pn.open_actions, pn.display_state into v_open, v_state from app.product_nodes pn
  where pn.product_id = v_r.product_id and pn.node_id = p_node;
  if coalesce(v_open, 0) > 0 then
    raise exception 'BE-29: % open findings on % must be resolved before signing', v_open, p_node using errcode = 'P0293';
  end if;
  if v_state is distinct from 'clear' then
    raise exception 'BE-29: % is %, not clear: only a clear market can be signed', p_node, coalesce(v_state, 'not_assessed')
      using errcode = 'P0293';
  end if;
  perform pg_advisory_xact_lock(hashtext('certificate-chain:' || v_r.workspace_id::text));
  select c.hash into v_prev from app.certificates c where c.workspace_id = v_r.workspace_id
  order by c.signed_at desc, c.id desc limit 1;
  v_hash := encode(extensions.digest(coalesce(v_prev, '') || v_id::text || v_r.id::text || p_node || v_person::text
                                     || v_r.ruleset_version || v_r.artwork_sha, 'sha256'), 'hex');
  insert into app.certificates (id, workspace_id, report_id, product_id, node_id, signer_id, grant_id, prev_hash, hash)
  values (v_id, v_r.workspace_id, v_r.id, v_r.product_id, p_node, v_person, v_grant, v_prev, v_hash);
  perform private.write_audit(v_r.workspace_id, 'certificate.issued', 'certificate', v_id::text, null,
                              jsonb_build_object('node', p_node, 'hash', v_hash), v_r.ruleset_version);
  return v_id;
end $$;
revoke all on function app.issue_certificate(uuid, text) from public, anon;
grant execute on function app.issue_certificate(uuid, text) to authenticated, service_role;

-- ─── 2 · certificates follow market scope ──────────────────────────────────────────────────────────────────────
drop policy read_scoped on app.certificates;
create policy read_scoped on app.certificates for select to authenticated
  using (private.can_see_product(product_id) and private.node_in_scope(workspace_id, node_id));

-- ─── 3 · artwork uploads follow family scope ───────────────────────────────────────────────────────────────────
-- <workspace>/<product>/<file>: the product must be in that workspace and editable by the caller. A path whose first
-- two folders are not uuids is refused (false), never an error.
create function private.can_upload_artwork(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  with f as (select storage.foldername(p_name) as d)
  select coalesce((
    select exists (select 1 from app.products pr
                   where pr.id = f.d[2]::uuid and pr.workspace_id = f.d[1]::uuid)
           and private.can_edit_product(f.d[2]::uuid)
    from f
    where f.d[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and f.d[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'), false)
$$;
revoke all on function private.can_upload_artwork(text) from public, anon;
grant execute on function private.can_upload_artwork(text) to authenticated, service_role;

do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists member_upload_artwork on storage.objects';
    execute $p$create policy member_upload_artwork on storage.objects for insert to authenticated
      with check (bucket_id = 'artwork' and private.can_upload_artwork(name))$p$;
  end if;
end $$;

-- ─── 4 · rate limits on RPCs ───────────────────────────────────────────────────────────────────────────────────
-- Per job kind, per hour. A kind not listed is not limited. Defaults pending a founder answer on #81.
create table private.rate_limits (
  kind          text primary key,
  per_person    int not null check (per_person > 0),
  per_workspace int not null check (per_workspace > 0),
  window_s      int not null default 3600 check (window_s between 60 and 86400)
);
insert into private.rate_limits (kind, per_person, per_workspace) values
  ('check',    300, 1500),   -- request_check: a person re-checking a 300-recipe portfolio in an hour
  ('extract',  300, 1500),   -- register_artwork, retry_extraction
  ('report',   120,  600),   -- request_report
  ('envelope',  60,  300),   -- request_envelope
  ('export',    10,   30),   -- request_export: a full export is heavy
  ('notify',    60,  200);   -- invite_member, request_document, create_share: email

-- One row per kind × subject (a person or a workspace) × fixed window; the limiter reads the current and the previous
-- window, weighting the previous by the part of it still inside the sliding hour.
create table private.rate_counters (
  kind         text not null,
  subject      uuid not null,
  window_start timestamptz not null,
  hits         int not null default 0,
  primary key (kind, subject, window_start)
);
revoke all on private.rate_limits, private.rate_counters from public, anon, authenticated;
grant all on private.rate_limits, private.rate_counters to service_role;

-- Seconds until a request refused at p_elapsed_s into the current window would be allowed. Allowed means
-- (hits before it) + 1 + floor(previous window's hits × the part of the previous window still inside the hour) ≤ limit.
-- p_cur counts the refused request. When the current window alone is full, the earliest is just after it ends (every
-- accepted request was within the limit, so the next window then allows one); otherwise it is when the previous
-- window's weight has fallen far enough.
create function private.rate_retry_after(p_cur int, p_prev int, p_limit int, p_window_s int, p_elapsed_s numeric)
returns int
language sql immutable set search_path = '' as $$
  select greatest(1, ceil(case
    when p_limit - p_cur < 0 or coalesce(p_prev, 0) = 0 then p_window_s - p_elapsed_s + 1
    else p_window_s * (1 - (p_limit - p_cur + 1)::numeric / p_prev) - p_elapsed_s + 1
  end))::int
$$;
revoke all on function private.rate_retry_after(int, int, int, int, numeric) from public, anon;
grant execute on function private.rate_retry_after(int, int, int, int, numeric) to authenticated, service_role;

create function private.take_rate(p_kind text, p_subject uuid, p_limit int, p_window_s int) returns void
language plpgsql security definer set search_path = '' as $$
declare v_now timestamptz := clock_timestamp(); v_win interval := make_interval(secs => p_window_s);
        v_start timestamptz; v_cur int; v_prev int; v_weight numeric;
begin
  v_start := date_bin(v_win, v_now, timestamptz '2000-01-01');
  insert into private.rate_counters as rc (kind, subject, window_start, hits) values (p_kind, p_subject, v_start, 1)
  on conflict (kind, subject, window_start) do update set hits = rc.hits + 1
  returning hits into v_cur;
  select hits into v_prev from private.rate_counters
  where kind = p_kind and subject = p_subject and window_start = v_start - v_win;
  v_weight := 1 - extract(epoch from (v_now - v_start)) / p_window_s;
  if v_cur + floor(coalesce(v_prev, 0) * v_weight) > p_limit then
    raise exception 'too many % requests: try again later', p_kind
      using errcode = 'P0049',
            hint = json_build_object('kind', p_kind, 'retry_after_s',
                     private.rate_retry_after(v_cur, coalesce(v_prev, 0), p_limit, p_window_s,
                                              extract(epoch from (v_now - v_start))))::text;
  end if;
end $$;
revoke all on function private.take_rate(text, uuid, int, int) from public, anon, authenticated;
grant execute on function private.take_rate(text, uuid, int, int) to service_role;

-- The limiter: only a new job requested by a signed-in person (an authenticated JWT) counts.
create function private.rate_limit_job(p_kind text, p_ws uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_l private.rate_limits; v_person uuid;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then return; end if;
  select * into v_l from private.rate_limits where kind = p_kind;
  if not found then return; end if;
  v_person := private.person_id();
  if v_person is not null then perform private.take_rate(p_kind, v_person, v_l.per_person, v_l.window_s); end if;
  if p_ws is not null then perform private.take_rate(p_kind, p_ws, v_l.per_workspace, v_l.window_s); end if;
end $$;
revoke all on function private.rate_limit_job(text, uuid) from public, anon, authenticated;
grant execute on function private.rate_limit_job(text, uuid) to service_role;

create or replace function private.enqueue(p_kind text, p_ws uuid, p_key text, p_payload jsonb)
returns uuid
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
  -- T-1103: past the limit the RPC rolls back, job and all. The allowance-used email is the system's, not the
  -- person's request, so it never counts against them.
  if p_key not like 'allowance:%' then perform private.rate_limit_job(p_kind, p_ws); end if;
  if to_regnamespace('pgmq') is not null then
    execute format('select pgmq.send(%L, %L::jsonb)', p_kind, jsonb_build_object('job_id', v_job)::text);
  end if;
  return v_job;
end $$;
revoke all on function private.enqueue(text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function private.enqueue(text, uuid, text, jsonb) to service_role;

-- A requeue (app.retry_extraction, app.request_envelope on a finished job) sets an existing job back to queued without
-- private.enqueue: it counts as a new request of that kind.
create function private.rate_limit_requeue() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.rate_limit_job(new.kind, new.workspace_id);
  return null;
end $$;
revoke all on function private.rate_limit_requeue() from public, anon, authenticated;
create trigger rate_limit_requeue after update of status on app.jobs
  for each row when (old.status in ('failed', 'cancelled', 'succeeded') and new.status = 'queued')
  execute function private.rate_limit_requeue();

-- Counters older than two days are purged once a day by a worker job, which runs inside the Sentry cron check-in
-- 'rate-counter-purge' (docs/17): pg_cron queues the job (02:53 UTC, keyed by the UTC date), the worker calls
-- app.purge_rate_counters.
alter table app.jobs drop constraint jobs_kind_check;
alter table app.jobs add constraint jobs_kind_check
  check (kind in ('extract','check','recheck','bulk_recheck','report','export','notify','session_revoke','diff_fanout',
                  'billing_sync','billing_reconcile','recipe_overage','dunning','scan','expiry_reminders',
                  'envelope','rate_purge')) not valid;
alter table app.jobs validate constraint jobs_kind_check;
do $$
begin
  if to_regnamespace('pgmq') is not null then
    perform pgmq.create('rate_purge');
  end if;
end $$;

create function app.purge_rate_counters(p_ref text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  perform private.require_service();
  delete from private.rate_counters where window_start < now() - interval '2 days';
  get diagnostics v_n = row_count;
  return jsonb_build_object('deleted', v_n);
end $$;
revoke all on function app.purge_rate_counters(text) from public, anon, authenticated;
grant execute on function app.purge_rate_counters(text) to service_role;

create function private.enqueue_rate_purge() returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_service();
  return private.enqueue('rate_purge', null, 'rate_purge:' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD'), '{}'::jsonb);
end $$;
revoke all on function private.enqueue_rate_purge() from public, anon, authenticated;
grant execute on function private.enqueue_rate_purge() to service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('rate-counter-purge', '53 2 * * *', 'select private.enqueue_rate_purge()');
  else
    raise notice 'pg_cron is not available: the daily rate-counter purge is not scheduled';
  end if;
end $$;
