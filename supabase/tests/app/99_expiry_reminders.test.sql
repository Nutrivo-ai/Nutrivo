-- T-803 · H04 expiry reminders: private.enqueue_expiry_reminders (pg_cron, once a day) and app.queue_expiry_reminders
-- (one document_expiring notify job per document and notice, ids only, never twice). Service role only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(14);
set local client_min_messages = warning;

-- ─── H: Hanna (admin) requested a document due in 20 days; another due in 3; one in 90; one quarantined.
-- X: a closed workspace with a document due in 10 days. ─────────────────────────────────────────────────────────
insert into auth.users (id, email) values ('00000000-0000-4000-8803-0000000000a1', 'hanna@h.test');
insert into app.people (id, user_id, display_name, email)
values ('10000000-0000-4000-8803-0000000000a1', '00000000-0000-4000-8803-0000000000a1', 'Hanna', 'hanna@h.test');
insert into app.workspaces (id, name, status) values
  ('20000000-0000-4000-8803-00000000000a', 'Workspace H', 'active'),
  ('20000000-0000-4000-8803-00000000000c', 'Workspace X', 'closed');
insert into app.memberships (workspace_id, person_id, role)
values ('20000000-0000-4000-8803-00000000000a', '10000000-0000-4000-8803-0000000000a1', 'admin');
insert into app.suppliers (id, workspace_id, name)
values ('40000000-0000-4000-8803-0000000000a1', '20000000-0000-4000-8803-00000000000a', 'Nordwild');
insert into app.document_requests (id, workspace_id, supplier_id, doc_type, title, created_by)
values ('50000000-0000-4000-8803-0000000000a1', '20000000-0000-4000-8803-00000000000a',
        '40000000-0000-4000-8803-0000000000a1', 'certificate_of_analysis', 'CoA',
        '10000000-0000-4000-8803-0000000000a1');
insert into app.supplier_documents (id, workspace_id, supplier_id, doc_type, storage_path, file_sha256, valid_to,
                                    uploaded_via, scan_status, request_id) values
  ('60000000-0000-4000-8803-0000000000a1', '20000000-0000-4000-8803-00000000000a', '40000000-0000-4000-8803-0000000000a1',
   'certificate_of_analysis', 'p', 's', current_date + 20, 'supplier_link', 'clean',
   '50000000-0000-4000-8803-0000000000a1'),
  ('60000000-0000-4000-8803-0000000000a2', '20000000-0000-4000-8803-00000000000a', null,
   'gmp_certificate', 'p', 's', current_date + 3, 'member', 'clean', null),
  ('60000000-0000-4000-8803-0000000000a3', '20000000-0000-4000-8803-00000000000a', null,
   'haccp_plan', 'p', 's', current_date + 90, 'member', 'clean', null),
  ('60000000-0000-4000-8803-0000000000a4', '20000000-0000-4000-8803-00000000000a', null,
   'analysis_report', 'p', 's', current_date + 10, 'member', 'quarantine', null),
  ('60000000-0000-4000-8803-0000000000c1', '20000000-0000-4000-8803-00000000000c', null,
   'gmp_certificate', 'p', 's', current_date + 10, 'member', 'clean', null);

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true) $$;
grant execute on all functions in schema pg_temp to service_role, authenticated;

-- ─── Grants and schedule ─────────────────────────────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('authenticated', 'app.queue_expiry_reminders(text)', 'execute')
          and not has_function_privilege('anon', 'app.queue_expiry_reminders(text)', 'execute')
          and not has_function_privilege('authenticated', 'private.enqueue_expiry_reminders()', 'execute')
          and not has_function_privilege('anon', 'private.enqueue_expiry_reminders()', 'execute')
          and has_function_privilege('service_role', 'app.queue_expiry_reminders(text)', 'execute'),
          '[T-803] the expiry reminder functions are executable by the service role only');
select is((select schedule from cron.job where jobname = 'expiry-reminders'), '23 6 * * *',
          '[T-803] pg_cron queues the expiry-reminders job daily at 06:23 UTC (Sentry monitor expiry-reminders)');
select lives_ok($$insert into app.jobs (kind, idempotency_key) values ('expiry_reminders', 'probe:t803')$$,
                '[T-803] expiry_reminders is a job kind');

select pg_temp.as_user('00000000-0000-4000-8803-0000000000a1');
set local role authenticated;
select throws_ok($$select app.queue_expiry_reminders('x')$$, '42501', null,
                 '[T-803] a member cannot run the producer');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

-- ─── H04.main: one notice per document, at the nearest threshold, ids only ───────────────────────────────────────
select is(private.enqueue_expiry_reminders(), private.enqueue_expiry_reminders(),
          '[T-803][H04.main] the daily job is queued once a day');
select is(app.queue_expiry_reminders('run-1'), '{"queued": 2, "requeued": 0, "already": 0}'::jsonb,
          '[T-803][H04.main] two documents are due a notice');
select is((select array_agg(idempotency_key order by idempotency_key) from app.jobs
           where kind = 'notify' and workspace_id = '20000000-0000-4000-8803-00000000000a'),
          array['doc:60000000-0000-4000-8803-0000000000a1:30', 'doc:60000000-0000-4000-8803-0000000000a2:7'],
          '[T-803][H04.main] 20 days gets the 30-day notice, 3 days the 7-day notice; 90 days and quarantine nothing');
select is((select payload - 'request_id' from app.jobs
           where idempotency_key = 'doc:60000000-0000-4000-8803-0000000000a1:30'),
          '{"template": "document_expiring", "document_id": "60000000-0000-4000-8803-0000000000a1",
            "notice_days": 30, "person_ids": ["10000000-0000-4000-8803-0000000000a1"]}'::jsonb,
          '[T-803][H04.main] the payload holds ids only, the requester as pack owner');
select is((select count(*)::int from app.jobs where workspace_id = '20000000-0000-4000-8803-00000000000c'), 0,
          '[T-803] a closed workspace gets no reminder');
select is(app.queue_expiry_reminders('run-2'), '{"queued": 0, "requeued": 0, "already": 2}'::jsonb,
          '[T-803][H04.main] a second run queues nothing new');
select is((select count(*)::int from app.jobs where kind = 'notify' and idempotency_key like 'doc:60000000-0000-4000-8803-%'),
          2, '[T-803][H04.main] one reminder per document and threshold');
select is((select count(*)::int from app.audit_events where kind = 'document.expiry_notice_queued'
           and workspace_id = '20000000-0000-4000-8803-00000000000a'), 2,
          '[T-803] each queued notice is audited once');
reset role;
-- A failed notice is re-queued by the next run, never lost; nothing else is touched.
update app.jobs set status = 'failed', attempts = 5, last_error = 'document has no display name'
where idempotency_key = 'doc:60000000-0000-4000-8803-0000000000a1:30';
select is(app.queue_expiry_reminders('run-3'), '{"queued": 0, "requeued": 1, "already": 1}'::jsonb,
          '[T-803][H04.main] a failed notice is re-queued by the next run');
select is((select status || ':' || attempts from app.jobs
           where idempotency_key = 'doc:60000000-0000-4000-8803-0000000000a1:30'), 'queued:0',
          '[T-803][H04.main] the same job, queued again with its attempts reset');

select * from finish();
rollback;
