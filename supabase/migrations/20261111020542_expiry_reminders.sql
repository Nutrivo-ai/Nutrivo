-- T-803 · H04 expiry reminders: the producer for the T-602 notify template 'document_expiring' (Template 04).
-- Additive only (expand): one job kind and queue, two service-role functions and a daily pg_cron schedule.
--
-- Once a day pg_cron queues one 'expiry_reminders' job (06:23 UTC, keyed by the UTC date). The worker runs it inside
-- the Sentry cron check-in 'expiry-reminders' (docs/17) and calls app.queue_expiry_reminders, which queues one
-- notify job per document and notice: {template:'document_expiring', document_id, notice_days, person_ids}, keyed
-- doc:<id>:<days>, so a document gets each of the 60, 30 and 7-day notices at most once however often this runs.
-- The notice is the nearest threshold still ahead: a document 25 days from expiry gets the 30-day notice; a missed
-- day never sends the 60-day notice late. Payloads hold ids only.
--
-- Which documents: the current clean row (scan_status 'clean', nothing promoted from it) with a valid_to 0 to 60 days
-- away, in a workspace that is not closed or dormant, unless a newer clean document of the same workspace, type,
-- product and supplier runs later (it has been replaced). person_ids are the pack owners (#70 Q1, default until a
-- founder answers): the person who requested the document and the people who recorded a registration citing it.
-- The notify job narrows them to active members and adds the admins on the 7-day notice (docs/04-contracts.md).
-- Registrations' own expiry dates get no reminder here (#70 Q2): no template or notification kind exists for them.

-- ─── Job kind 'expiry_reminders' (expand) ────────────────────────────────────────────────────────────────────────
alter table app.jobs drop constraint jobs_kind_check;
alter table app.jobs add constraint jobs_kind_check
  check (kind in ('extract','check','recheck','bulk_recheck','report','export','notify','session_revoke','diff_fanout',
                  'billing_sync','billing_reconcile','recipe_overage','dunning','scan','expiry_reminders')) not valid;
alter table app.jobs validate constraint jobs_kind_check;

do $$
begin
  if to_regnamespace('pgmq') is not null then
    perform pgmq.create('expiry_reminders');
  end if;
end $$;

-- ─── The notices due today, queued once each ─────────────────────────────────────────────────────────────────────
create function app.queue_expiry_reminders(p_ref text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record; v_job uuid; v_before int; v_queued int := 0; v_already int := 0;
        v_today date := (now() at time zone 'UTC')::date;   -- the notify job counts days in UTC too
begin
  perform private.require_service();
  for r in
    select d.id, d.workspace_id, d.valid_to,
           (select min(t) from unnest(array[7, 30, 60]) t where d.valid_to - v_today <= t) as notice_days,
           coalesce((select array_agg(distinct o order by o)
                       from (select q.created_by as o from app.document_requests q
                              where q.id = d.request_id and q.workspace_id = d.workspace_id
                             union
                             select g.recorded_by from app.registrations g
                              where g.evidence_doc_id = d.id and g.workspace_id = d.workspace_id) owners
                      where o is not null), '{}'::uuid[]) as person_ids
    from app.supplier_documents d
    join app.workspaces w on w.id = d.workspace_id and w.status not in ('closed', 'dormant')
    where d.scan_status = 'clean'
      and d.valid_to between v_today and v_today + 60
      and not exists (select 1 from app.supplier_documents p where p.promoted_from = d.id)
      and not exists (select 1 from app.supplier_documents n
                      where n.workspace_id = d.workspace_id and n.id <> d.id and n.scan_status = 'clean'
                        and n.doc_type = d.doc_type
                        and n.product_id is not distinct from d.product_id
                        and n.supplier_id is not distinct from d.supplier_id
                        and n.valid_to > d.valid_to)
    order by d.valid_to, d.id
  loop
    select count(*) into v_before from app.jobs j
    where j.idempotency_key = 'doc:' || r.id::text || ':' || r.notice_days::text;
    v_job := private.enqueue('notify', r.workspace_id, 'doc:' || r.id::text || ':' || r.notice_days::text,
                             jsonb_build_object('template', 'document_expiring', 'document_id', r.id,
                                                'notice_days', r.notice_days, 'person_ids', to_jsonb(r.person_ids)));
    if v_before = 0 then
      v_queued := v_queued + 1;
      perform private.write_audit(r.workspace_id, 'document.expiry_notice_queued', 'supplier_document', r.id::text,
                                  null, jsonb_build_object('notice_days', r.notice_days, 'valid_to', r.valid_to,
                                                           'job_id', v_job, 'ref', left(p_ref, 255)));
    else
      v_already := v_already + 1;
    end if;
  end loop;
  return jsonb_build_object('queued', v_queued, 'already', v_already);
end $$;
revoke execute on function app.queue_expiry_reminders(text) from public, anon, authenticated;
grant execute on function app.queue_expiry_reminders(text) to service_role;

-- ─── The daily schedule (docs/17 Sentry cron monitor 'expiry-reminders') ─────────────────────────────────────────
create function private.enqueue_expiry_reminders() returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_service();
  return private.enqueue('expiry_reminders', null,
                         'expiry_reminders:' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD'), '{}'::jsonb);
end $$;
revoke execute on function private.enqueue_expiry_reminders() from public, anon, authenticated;
grant execute on function private.enqueue_expiry_reminders() to service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('expiry-reminders', '23 6 * * *', 'select private.enqueue_expiry_reminders()');
  else
    raise notice 'pg_cron is not available: the daily expiry-reminders job is not scheduled';
  end if;
end $$;
