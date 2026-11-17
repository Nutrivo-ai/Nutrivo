-- T-904 (#232) · The alert sweep evaluates only diffs whose effective date newly arrived (migration
-- 20261117074026). A stale 'coming' alert is evaluated on its first due sweep and never again; a missed day is still
-- caught up; repeating a day evaluates and writes nothing; the in_force row still needs contract 5 (J03.must.1).
-- Synthetic rows only, rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(17);
set local client_min_messages = warning;

insert into app.workspaces (id, name) values ('20000000-0000-4000-8904-00000000000a','Workspace A');
insert into app.allowances (workspace_id) values ('20000000-0000-4000-8904-00000000000a');
insert into app.families (id, workspace_id, name) values
  ('30000000-0000-4000-8904-0000000000a1','20000000-0000-4000-8904-00000000000a','Cats');
-- p1 Cat adult: its latest check no longer applies S's rule, so S's 'coming' alert is stale.
-- p2 Cat kitten: its latest check applies M's and L's rule.
insert into app.products (id, workspace_id, family_id, name, stage) values
  ('40000000-0000-4000-8904-0000000000a1','20000000-0000-4000-8904-00000000000a','30000000-0000-4000-8904-0000000000a1','Cat adult','active'),
  ('40000000-0000-4000-8904-0000000000a2','20000000-0000-4000-8904-00000000000a','30000000-0000-4000-8904-0000000000a1','Cat kitten','active');

insert into ref.ruleset_versions (id) values ('T904-V');
insert into ref.rules (rule_key, shape, domain, node_id, title) values
  ('T904.S', 'mandatory_particular', 'mandatory_particulars', 'EU', 'Synthetic T-904 stale rule'),
  ('T904.M', 'mandatory_particular', 'mandatory_particulars', 'EU', 'Synthetic T-904 rule');
-- S took effect 5 days ago, M 3 days ago (a day the sweep will miss), L yesterday.
insert into ref.rule_diffs (id, ruleset_version, rule_key, from_version, to_version, effect_type, effective_from) values
  ('80000000-0000-4000-8904-0000000000d5','T904-V','T904.S', 1, 2, 'tightened_threshold', current_date - 5),
  ('80000000-0000-4000-8904-0000000000d3','T904-V','T904.M', 1, 2, 'tightened_threshold', current_date - 3),
  ('80000000-0000-4000-8904-0000000000d1','T904-V','T904.M', 2, 3, 'prescribed_wording', current_date - 1);

insert into app.checks (workspace_id, product_id, node_id, ruleset_version, label_state, applied_rule_keys,
                        withheld_rule_keys, at) values
  ('20000000-0000-4000-8904-00000000000a','40000000-0000-4000-8904-0000000000a1','EU-DE','T904-V','action','{T904.S}','{}', now() - interval '10 days'),
  ('20000000-0000-4000-8904-00000000000a','40000000-0000-4000-8904-0000000000a1','EU-DE','T904-V','action','{T904.M}','{}', now() - interval '6 days'),
  ('20000000-0000-4000-8904-00000000000a','40000000-0000-4000-8904-0000000000a2','EU-DE','T904-V','action','{T904.M}','{}', now() - interval '6 days');

-- The 'coming' rows stand for fan-outs before each date.
insert into app.alerts (workspace_id, rule_diff_id, product_id, node_id, phase, effect_type, effective_from) values
  ('20000000-0000-4000-8904-00000000000a','80000000-0000-4000-8904-0000000000d5','40000000-0000-4000-8904-0000000000a1',
   'EU-DE','coming','tightened_threshold', current_date - 5),
  ('20000000-0000-4000-8904-00000000000a','80000000-0000-4000-8904-0000000000d3','40000000-0000-4000-8904-0000000000a2',
   'EU-DE','coming','tightened_threshold', current_date - 3),
  ('20000000-0000-4000-8904-00000000000a','80000000-0000-4000-8904-0000000000d1','40000000-0000-4000-8904-0000000000a2',
   'EU-DE','coming','prescribed_wording', current_date - 1);

create function pg_temp.in_force(diff text) returns int language sql as $$
  select count(*)::int from app.alerts where rule_diff_id = diff::uuid and phase = 'in_force';
$$;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ─── The first due sweep evaluates the stale diff once ──────────────────────────────────────────────────────────
select is(app.run_alert_sweep(current_date - 5) - array['day', 'notify_jobs'],
          '{"since": null, "diffs": 1, "in_force": 0}'::jsonb,
          '[T-904] with no earlier sweep the window is open: the stale diff is evaluated on its first due sweep');
select is(pg_temp.in_force('80000000-0000-4000-8904-0000000000d5'), 0,
          '[T-904] a stale coming alert still gets no in_force row (J03.must.1)');

select is(app.run_alert_sweep(current_date - 4) - array['day', 'notify_jobs'],
          jsonb_build_object('since', current_date - 5, 'diffs', 0, 'in_force', 0),
          '[T-904] the next sweep does not evaluate the stale diff again');

-- p1 is re-checked and applies S's rule again: contract 5 would now name it, so an in_force row on a later sweep
-- would show the stale diff was evaluated again.
insert into app.checks (workspace_id, product_id, node_id, ruleset_version, label_state, applied_rule_keys,
                        withheld_rule_keys, at) values
  ('20000000-0000-4000-8904-00000000000a','40000000-0000-4000-8904-0000000000a1','EU-DE','T904-V','action','{T904.S}','{}', now());

-- ─── A missed day is caught up (current_date - 3 is never swept on its day) ─────────────────────────────────────
select is(app.run_alert_sweep(current_date - 2) - array['day', 'notify_jobs'],
          jsonb_build_object('since', current_date - 4, 'diffs', 1, 'in_force', 1),
          '[T-904] a missed day is caught up: the window runs from the last completed sweep');
select is(pg_temp.in_force('80000000-0000-4000-8904-0000000000d3'), 1,
          '[T-904] the alert whose date fell on the missed day gets its in_force row');
select is(pg_temp.in_force('80000000-0000-4000-8904-0000000000d5'), 0,
          '[T-904] a stale diff is not re-evaluated on later sweeps, even once contract 5 names its recipe again');
select is(pg_temp.in_force('80000000-0000-4000-8904-0000000000d1'), 0,
          '[T-904] an alert whose date is after the sweep day is not evaluated');

-- ─── Repeating a day, and a late retry of an earlier day, write nothing ─────────────────────────────────────────
select is(app.run_alert_sweep(current_date - 2) - 'day',
          jsonb_build_object('since', current_date - 2, 'diffs', 0, 'in_force', 0, 'notify_jobs', 0),
          '[T-904] repeating a day evaluates nothing and writes nothing');
select is(app.run_alert_sweep(current_date - 3) - 'day',
          jsonb_build_object('since', current_date - 4, 'diffs', 0, 'in_force', 0, 'notify_jobs', 0),
          '[T-904] a late sweep of a missed day looks back from its own day and writes nothing twice');

-- ─── The next day's sweep picks up only the newly arrived diff ──────────────────────────────────────────────────
select is(app.run_alert_sweep(current_date) - array['day', 'notify_jobs'],
          jsonb_build_object('since', current_date - 2, 'diffs', 1, 'in_force', 1),
          '[T-904] a later sweep evaluates only the diff whose date newly arrived');
select is(pg_temp.in_force('80000000-0000-4000-8904-0000000000d1'), 1,
          '[T-904] the newly arrived alert gets its in_force row');
select is((select count(*)::int from app.alerts where phase = 'coming'
           and rule_diff_id::text like '80000000-0000-4000-8904-%'), 3,
          '[T-904] the coming rows stay: phase changes are new rows');
select is((select array_agg(day order by day) from private.alert_sweeps where day >= current_date - 5),
          array[current_date - 5, current_date - 4, current_date - 3, current_date - 2, current_date],
          '[T-904] each completed sweep records its day once');

-- ─── The watermark is insert-only and private ───────────────────────────────────────────────────────────────────
select throws_ok($$update private.alert_sweeps set swept_at = now()$$, 'P0005', null,
                 '[T-904] a recorded sweep is never updated (BE-05)');
select throws_ok($$delete from private.alert_sweeps$$, 'P0005', null,
                 '[T-904] a recorded sweep is never deleted (BE-05)');
select ok(not has_table_privilege('authenticated', 'private.alert_sweeps', 'select')
          and not has_table_privilege('anon', 'private.alert_sweeps', 'select'),
          '[T-904] clients cannot read the sweep watermark');
select ok(not has_function_privilege('authenticated', 'app.run_alert_sweep(date)', 'execute')
          and not has_function_privilege('anon', 'app.run_alert_sweep(date)', 'execute'),
          '[T-904] only the service role runs the sweep');

select * from finish();
rollback;
