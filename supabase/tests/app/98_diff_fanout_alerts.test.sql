-- T-901 · J03 impact analysis and alerts (migration 20261111020611). BE-24: alerts come from the applied-rule join
-- (contract 5), never a re-evaluation. BE-39: read state is per person. BE-09: an editorial diff writes nothing.
-- Synthetic rows only, rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(35);
set local client_min_messages = warning;

-- ─── A: Ed (editor), Fay (viewer), Max (viewer scoped to EU-DE). B: Bo (admin). ────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-4000-8901-0000000000e1','ed@a.test'),  ('00000000-0000-4000-8901-0000000000f1','fay@a.test'),
  ('00000000-0000-4000-8901-0000000000d1','max@a.test'), ('00000000-0000-4000-8901-0000000000b1','bo@b.test');
insert into app.people (id, user_id, display_name, email)
select ('10000000' || substr(u.id::text, 9))::uuid, u.id, split_part(u.email, '@', 1), u.email
from auth.users u where u.id::text like '00000000-0000-4000-8901-%';
insert into app.workspaces (id, name) values
  ('20000000-0000-4000-8901-00000000000a','Workspace A'), ('20000000-0000-4000-8901-00000000000b','Workspace B');
insert into app.allowances (workspace_id) values
  ('20000000-0000-4000-8901-00000000000a'), ('20000000-0000-4000-8901-00000000000b');
insert into app.families (id, workspace_id, name) values
  ('30000000-0000-4000-8901-0000000000a1','20000000-0000-4000-8901-00000000000a','Cats'),
  ('30000000-0000-4000-8901-0000000000a2','20000000-0000-4000-8901-00000000000a','Dogs'),
  ('30000000-0000-4000-8901-0000000000b1','20000000-0000-4000-8901-00000000000b','Birds');
insert into app.memberships (workspace_id, person_id, role, scope_family_ids, scope_node_ids) values
  ('20000000-0000-4000-8901-00000000000a','10000000-0000-4000-8901-0000000000e1','editor', null, null),
  ('20000000-0000-4000-8901-00000000000a','10000000-0000-4000-8901-0000000000f1','viewer', null, null),
  ('20000000-0000-4000-8901-00000000000a','10000000-0000-4000-8901-0000000000d1','viewer', null, '{EU-DE}'),
  ('20000000-0000-4000-8901-00000000000b','10000000-0000-4000-8901-0000000000b1','admin', null, null);
-- a1 Cat adult: latest checks apply R in EU-DE and withhold it in EU-SE (affected in both).
-- a2 Dog adult: its checks apply only R2 (not affected).
-- a3 Cat kitten: an earlier check applied R, the latest check in EU-DE does not (not affected: latest check only).
-- a4 Cat senior: applied R but is discontinued (not affected).
-- b1 Bird seed (workspace B): applies R in EU-DE (affected, in B only).
insert into app.products (id, workspace_id, family_id, name, stage, discontinued_at) values
  ('40000000-0000-4000-8901-0000000000a1','20000000-0000-4000-8901-00000000000a','30000000-0000-4000-8901-0000000000a1','Cat adult','active',null),
  ('40000000-0000-4000-8901-0000000000a2','20000000-0000-4000-8901-00000000000a','30000000-0000-4000-8901-0000000000a2','Dog adult','active',null),
  ('40000000-0000-4000-8901-0000000000a3','20000000-0000-4000-8901-00000000000a','30000000-0000-4000-8901-0000000000a1','Cat kitten','active',null),
  ('40000000-0000-4000-8901-0000000000a4','20000000-0000-4000-8901-00000000000a','30000000-0000-4000-8901-0000000000a1','Cat senior','discontinued',now()),
  ('40000000-0000-4000-8901-0000000000b1','20000000-0000-4000-8901-00000000000b','30000000-0000-4000-8901-0000000000b1','Bird seed','active',null);

insert into ref.ruleset_versions (id) values ('T901-V');
insert into ref.rules (rule_key, shape, domain, node_id, title) values
  ('T901.R',  'mandatory_particular', 'mandatory_particulars', 'EU', 'Synthetic T-901 rule'),
  ('T901.R2', 'mandatory_particular', 'mandatory_particulars', 'EU', 'Synthetic T-901 other rule');
insert into ref.rule_diffs (id, ruleset_version, rule_key, from_version, to_version, effect_type, effective_from,
                            sell_through_until) values
  ('80000000-0000-4000-8901-0000000000d1','T901-V','T901.R', 1, 2, 'tightened_threshold', '2099-01-01', '2099-06-30'),
  ('80000000-0000-4000-8901-0000000000d2','T901-V','T901.R', 2, 3, 'editorial', null, null),
  ('80000000-0000-4000-8901-0000000000d3','T901-V','T901.R2', 1, 2, 'new_obligation', null, null),
  ('80000000-0000-4000-8901-0000000000d4','T901-V','T901.R2', 2, 3, 'prescribed_wording', current_date - 1, null);

insert into app.checks (workspace_id, product_id, node_id, ruleset_version, label_state, applied_rule_keys,
                        withheld_rule_keys, at) values
  ('20000000-0000-4000-8901-00000000000a','40000000-0000-4000-8901-0000000000a1','EU-DE','T901-V','action','{T901.R}','{}', now()),
  ('20000000-0000-4000-8901-00000000000a','40000000-0000-4000-8901-0000000000a1','EU-SE','T901-V','not_assessed','{}','{T901.R}', now()),
  ('20000000-0000-4000-8901-00000000000a','40000000-0000-4000-8901-0000000000a2','EU-DE','T901-V','action','{T901.R2}','{}', now()),
  ('20000000-0000-4000-8901-00000000000a','40000000-0000-4000-8901-0000000000a3','EU-DE','T901-V','action','{T901.R}','{}', now() - interval '2 days'),
  ('20000000-0000-4000-8901-00000000000a','40000000-0000-4000-8901-0000000000a3','EU-DE','T901-V','action','{T901.R2}','{}', now()),
  ('20000000-0000-4000-8901-00000000000a','40000000-0000-4000-8901-0000000000a4','EU-DE','T901-V','action','{T901.R}','{}', now()),
  ('20000000-0000-4000-8901-00000000000b','40000000-0000-4000-8901-0000000000b1','EU-DE','T901-V','action','{T901.R}','{}', now());

create function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;

-- ─── J03.main · fan-out ──────────────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_service();
select is((app.fan_out_rule_diff('80000000-0000-4000-8901-0000000000d1') ->> 'alerts')::int, 3,
          '[J03.main] a material diff fans out to every product × market whose latest check applied or withheld its rule');
select is((select count(*)::int from app.audit_events where kind = 'alerts.fanned_out'
           and object_id = '80000000-0000-4000-8901-0000000000d1'), 2,
          '[J03.main] the fan-out is audited once per workspace that got alerts');
select is((select string_agg(phase || ' ' || effect_type || ' ' || effective_from || ' ' || sell_through_until, ', ')
           from (select distinct phase, effect_type, effective_from, sell_through_until from app.alerts
                 where rule_diff_id = '80000000-0000-4000-8901-0000000000d1') x),
          'coming tightened_threshold 2099-01-01 2099-06-30',
          '[J03.main] an alert is coming before its effective date and carries the diff''s effect and both dates');
select is((app.fan_out_rule_diff('80000000-0000-4000-8901-0000000000d1') ->> 'alerts')::int, 0,
          '[J03.main] fanning the same diff out again writes nothing');
select is((select count(*)::int from app.alerts where rule_diff_id = '80000000-0000-4000-8901-0000000000d1'), 3,
          '[J03.main] a repeated fan-out leaves one alert per product × market');
select is(app.fan_out_rule_diff('80000000-0000-4000-8901-0000000000d2') ->> 'skipped', 'editorial',
          '[J03.main] an editorial diff is skipped (BE-09)');
select is((select count(*)::int from app.alerts where rule_diff_id = '80000000-0000-4000-8901-0000000000d2'), 0,
          '[J03.main] an editorial diff writes no alert (BE-09)');
select is(app.fan_out_rule_diff('80000000-0000-4000-8901-0000000000d3') ->> 'alerts', '2',
          '[J03.main] a diff with no effective date fans out');
select is((select array_agg(distinct phase) from app.alerts where rule_diff_id = '80000000-0000-4000-8901-0000000000d3'),
          array['in_force'], '[J03.main] a diff with no effective date is in force');
select throws_ok($$select app.fan_out_rule_diff('80000000-0000-4000-8901-0000000000ff')$$, 'P0002', null,
                 '[J03.main] an unknown diff is P0002');

-- ─── J03.must.1 · alerts name recipes through the applied-rule join ─────────────────────────────────────────────
select is((select string_agg(f.name || '/' || pr.name || '/' || a.node_id, ', ' order by f.name, pr.name, a.node_id)
           from app.alerts a join app.products pr on pr.id = a.product_id join app.families f on f.id = pr.family_id
           where a.rule_diff_id = '80000000-0000-4000-8901-0000000000d1'),
          'Birds/Bird seed/EU-DE, Cats/Cat adult/EU-DE, Cats/Cat adult/EU-SE',
          '[J03.must.1] alerts name exactly the recipes whose latest check applied or withheld the rule');
select ok(not exists (select 1 from app.alerts where rule_diff_id = '80000000-0000-4000-8901-0000000000d1'
                      and product_id = '40000000-0000-4000-8901-0000000000a2'),
          '[J03.must.1] a product that never applied the rule gets no alert');
select ok(not exists (select 1 from app.alerts where rule_diff_id = '80000000-0000-4000-8901-0000000000d1'
                      and product_id = '40000000-0000-4000-8901-0000000000a3'),
          '[J03.must.1] only the latest check counts: a rule applied by an earlier check names no recipe');
select ok(not exists (select 1 from app.alerts where rule_diff_id = '80000000-0000-4000-8901-0000000000d1'
                      and product_id = '40000000-0000-4000-8901-0000000000a4'),
          '[J03.must.1] a discontinued product gets no alert');
select is((select array_agg(a.workspace_id = pr.workspace_id) from app.alerts a join app.products pr on pr.id = a.product_id),
          (select array_agg(true) from app.alerts),
          '[J03.must.1] every alert is in its product''s workspace');

-- ─── J03.main · the daily sweep: phase change and the batched rule_changed jobs ──────────────────────────────────
-- d4 took effect yesterday; its 'coming' row stands for one fanned out before that day.
insert into app.alerts (workspace_id, rule_diff_id, product_id, node_id, phase, effect_type, effective_from) values
  ('20000000-0000-4000-8901-00000000000a','80000000-0000-4000-8901-0000000000d4','40000000-0000-4000-8901-0000000000a2',
   'EU-DE','coming','prescribed_wording', current_date - 1);
select is(app.run_alert_sweep(current_date) - 'day',
          '{"in_force": 1, "notify_jobs": 4}'::jsonb,
          '[J03.main] the sweep writes the in_force row of an arrived alert and one notify job per diff × workspace');
select is((select count(*)::int from app.alerts where rule_diff_id = '80000000-0000-4000-8901-0000000000d4'
           and phase = 'coming'), 1, '[J03.main] the coming row stays: the phase change is a new row');
select is((select count(*)::int from app.alerts where rule_diff_id = '80000000-0000-4000-8901-0000000000d4'
           and phase = 'in_force' and effective_from = current_date - 1), 1,
          '[J03.main] the in_force row carries the diff''s date');
select is((select string_agg(j.workspace_id::text || ' ' || (j.payload ->> 'template') || ' ' || (j.payload ->> 'rule_diff_id'), ', '
                             order by j.workspace_id)
           from app.jobs j where j.kind = 'notify'
             and j.idempotency_key like 'rule_changed:80000000-0000-4000-8901-0000000000d1:%'),
          '20000000-0000-4000-8901-00000000000a rule_changed 80000000-0000-4000-8901-0000000000d1, '
          '20000000-0000-4000-8901-00000000000b rule_changed 80000000-0000-4000-8901-0000000000d1',
          '[J03.main] each affected workspace gets its own rule_changed job for the diff');
select is(app.run_alert_sweep(current_date) - 'day', '{"in_force": 0, "notify_jobs": 0}'::jsonb,
          '[J03.main] repeating the sweep writes nothing and queues no second email');
select throws_ok($$select app.run_alert_sweep(current_date + 2)$$, '22023', null,
                 '[J03.main] the sweep never runs for a day not yet reached');
select is(private.enqueue_alert_sweep(), private.enqueue_alert_sweep(),
          '[J03.main] pg_cron queues one sweep job per day');
select ok(not exists (select 1 from pg_extension where extname = 'pg_cron')
          or exists (select 1 from cron.job where jobname = 'alert-sweep' and schedule = '23 7 * * *'),
          '[J03.main] the sweep is scheduled daily where pg_cron exists');

-- ─── Only the worker writes alerts ───────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-4000-8901-0000000000e1');
set local role authenticated;
select throws_ok($$select app.fan_out_rule_diff('80000000-0000-4000-8901-0000000000d1')$$, '42501', null,
                 '[J03.main] a member cannot fan a diff out');
select throws_ok($$select app.run_alert_sweep(current_date)$$, '42501', null,
                 '[J03.main] a member cannot run the sweep');

-- ─── J03.must.2 · read state is per person (BE-39) ───────────────────────────────────────────────────────────────
select is(app.mark_alerts_read(array(select id from app.alerts where rule_diff_id = '80000000-0000-4000-8901-0000000000d1')), 2,
          '[J03.must.2] Ed marks the two alerts he can read as read');
select is(app.mark_alerts_read(array(select id from app.alerts where rule_diff_id = '80000000-0000-4000-8901-0000000000d1')), 0,
          '[J03.must.2] marking them again changes nothing');
select throws_ok($$insert into app.alert_reads (alert_id, person_id)
                   select id, '10000000-0000-4000-8901-0000000000f1' from app.alerts limit 1$$, '42501', null,
                 '[J03.must.2] no client writes alert_reads directly');
reset role;

select pg_temp.as_user('00000000-0000-4000-8901-0000000000f1');
set local role authenticated;
select is((select count(*)::int from app.alert_reads), 0,
          '[J03.must.2] Fay, in the same workspace, sees none of Ed''s reads: the alerts are unread for her');
select is(app.mark_alerts_read(array(select id from app.alerts where rule_diff_id = '80000000-0000-4000-8901-0000000000d1'
                                     and node_id = 'EU-DE')), 1,
          '[J03.must.2] Fay marks one alert read for herself');
reset role;
select is((select string_agg(p.display_name || ' ' || a.node_id, ', ' order by p.display_name, a.node_id)
           from app.alert_reads r join app.people p on p.id = r.person_id join app.alerts a on a.id = r.alert_id
           where p.id::text like '10000000-0000-4000-8901-%'),
          'ed EU-DE, ed EU-SE, fay EU-DE', '[J03.must.2] each person''s reads are their own rows');

-- ─── Another workspace reads and marks none of A's alerts ────────────────────────────────────────────────────────
create temp table t901_a_alert as
  select id from app.alerts where workspace_id = '20000000-0000-4000-8901-00000000000a' and node_id = 'EU-SE' limit 1;
grant select on t901_a_alert to authenticated;

select pg_temp.as_user('00000000-0000-4000-8901-0000000000d1');
set local role authenticated;
select throws_ok(format('select app.mark_alerts_read(array[%L]::uuid[])', (select id from t901_a_alert)), '42501', null,
                 '[J03.must.2] a member scoped to EU-DE cannot mark an EU-SE alert read');
reset role;

select pg_temp.as_user('00000000-0000-4000-8901-0000000000b1');
set local role authenticated;
select is((select count(*)::int from app.alerts where workspace_id = '20000000-0000-4000-8901-00000000000a'), 0,
          '[J03.must.2] another workspace''s admin reads none of A''s alerts');
select throws_ok(format('select app.mark_alerts_read(array[%L]::uuid[])', (select id from t901_a_alert)), '42501', null,
                 '[J03.must.2] another workspace''s admin cannot mark A''s alert read');
select is((select count(*)::int from app.alert_reads), 0,
          '[J03.must.2] another workspace''s admin reads none of A''s read state');
reset role;

select * from finish();
rollback;
