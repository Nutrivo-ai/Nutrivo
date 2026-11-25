-- T-604 · I02, D-30 (#180 Q7): app.create_share caps email shares at 50 per workspace per UTC day, refused with P0050.
-- Link shares are never counted, yesterday's email shares are not counted, and another workspace has its own 50.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(14);
set local client_min_messages = warning;

-- ─── A: Carl (editor). B: Bea (editor). ──────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-4000-8604-0000000000c1','carl@a.test'), ('00000000-0000-4000-8604-0000000000b1','bea@b.test');
insert into app.people (id, user_id, display_name, email)
select ('10000000' || substr(u.id::text, 9))::uuid, u.id, split_part(u.email, '@', 1), u.email
from auth.users u where u.id::text like '00000000-0000-4000-8604-%';
insert into app.workspaces (id, name) values
  ('20000000-0000-4000-8604-00000000000a','Workspace A'), ('20000000-0000-4000-8604-00000000000b','Workspace B');
insert into app.families (id, workspace_id, name) values
  ('30000000-0000-4000-8604-00000000000a','20000000-0000-4000-8604-00000000000a','Family A'),
  ('30000000-0000-4000-8604-00000000000b','20000000-0000-4000-8604-00000000000b','Family B');
insert into app.memberships (workspace_id, person_id, role) values
  ('20000000-0000-4000-8604-00000000000a','10000000-0000-4000-8604-0000000000c1','editor'),
  ('20000000-0000-4000-8604-00000000000b','10000000-0000-4000-8604-0000000000b1','editor');
insert into app.products (id, workspace_id, family_id, name) values
  ('40000000-0000-4000-8604-00000000000a','20000000-0000-4000-8604-00000000000a','30000000-0000-4000-8604-00000000000a','Product A'),
  ('40000000-0000-4000-8604-00000000000b','20000000-0000-4000-8604-00000000000b','30000000-0000-4000-8604-00000000000b','Product B');
insert into app.reports (id, workspace_id, product_id, node_id, ref, check_ids, ruleset_version, artwork_sha, has_not_assessed) values
  ('50000000-0000-4000-8604-00000000000a','20000000-0000-4000-8604-00000000000a','40000000-0000-4000-8604-00000000000a','EU-SE',
   'nv-t604-reference-000000000a','{}','0000.00-empty','sha-t604-a',false),
  ('50000000-0000-4000-8604-00000000000b','20000000-0000-4000-8604-00000000000b','40000000-0000-4000-8604-00000000000b','EU-SE',
   'nv-t604-reference-000000000b','{}','0000.00-empty','sha-t604-b',false);

-- Three email shares of A made just before 00:00 UTC today: yesterday's, so they do not count.
insert into app.shares (workspace_id, product_id, report_id, token_hash, channel, recipient, created_by, created_at)
select '20000000-0000-4000-8604-00000000000a', '40000000-0000-4000-8604-00000000000a',
       '50000000-0000-4000-8604-00000000000a', extensions.gen_random_bytes(32), 'email', 'old' || g || '@x.test',
       '10000000-0000-4000-8604-0000000000c1', date_trunc('day', now(), 'UTC') - make_interval(secs => g)
from generate_series(1, 3) g;

create temp table t (name text primary key, v jsonb);
grant all on t to authenticated;
create function pg_temp.as_user(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true)
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- ─── Carl makes five link shares, then 49 email shares ────────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-4000-8604-0000000000c1');
set local role authenticated;
select is((select count(*)::int from generate_series(1, 5) g,
                lateral app.create_share('50000000-0000-4000-8604-00000000000a', 'link', null, g) s),
          5, '[T-604] five link shares are made first');
select is((select count(*)::int from generate_series(1, 49) g,
                lateral app.create_share('50000000-0000-4000-8604-00000000000a', 'email', 'buyer' || g || '@x.test', 30) s),
          49, '[T-604] 49 email shares are made');

-- ─── The 50th succeeds, the 51st is refused with P0050 ────────────────────────────────────────────────────────
select lives_ok($$ select app.create_share('50000000-0000-4000-8604-00000000000a', 'email', 'fiftieth@x.test', null) $$,
                '[T-604] the 50th email share of a workspace in a UTC day succeeds (link shares and yesterday''s are not counted)');
select throws_ok($$ select app.create_share('50000000-0000-4000-8604-00000000000a', 'email', 'fifty-first@x.test', 30) $$,
                 'P0050', 'this workspace has sent 50 email shares today: try again after 00:00 UTC',
                 '[T-604] the 51st email share of the day is refused with P0050');
do $$
begin
  perform app.create_share('50000000-0000-4000-8604-00000000000a', 'email', 'fifty-first@x.test', 30);
exception when sqlstate 'P0050' then
  declare v_hint text;
  begin
    get stacked diagnostics v_hint = pg_exception_hint;
    insert into t values ('hint', v_hint::jsonb);
  end;
end $$;
select lives_ok($$ select app.create_share('50000000-0000-4000-8604-00000000000a', 'link', null, 30) $$,
                '[T-604] link shares are not capped: a link share still succeeds after the email cap is reached');
reset role;

select is((select v from t where name = 'hint'),
          jsonb_build_object('limit', 50, 'resets_at', date_trunc('day', now(), 'UTC') + interval '1 day'),
          '[T-604] the refusal''s hint names the limit and the next 00:00 UTC');
select is((select count(*)::int from app.shares where workspace_id = '20000000-0000-4000-8604-00000000000a'
             and channel = 'email' and created_at >= date_trunc('day', now(), 'UTC')),
          50, '[T-604] exactly 50 email shares of A exist for today');
select is((select count(*)::int from app.shares where recipient = 'fifty-first@x.test'), 0,
          '[T-604] the refused share left no row');
select is((select count(*)::int from app.jobs where workspace_id = '20000000-0000-4000-8604-00000000000a'
             and kind = 'notify'), 50,
          '[T-604] one notify job per accepted email share, none for the refused one');
select is((select count(*)::int from app.audit_events where workspace_id = '20000000-0000-4000-8604-00000000000a'
             and kind = 'share.created' and after ->> 'recipient' = 'fifty-first@x.test'), 0,
          '[T-604] the refused share is not audited as created');
select is((select count(*)::int from app.shares where workspace_id = '20000000-0000-4000-8604-00000000000a'
             and channel = 'link'), 6, '[T-604] the link shares were all made');

-- ─── Another workspace is independent ────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-4000-8604-0000000000b1');
set local role authenticated;
select lives_ok($$ select app.create_share('50000000-0000-4000-8604-00000000000b', 'email', 'buyer@b.test', 30) $$,
                '[T-604] another workspace''s email share is not counted against A''s 50');
reset role;
select is((select count(*)::int from app.shares where workspace_id = '20000000-0000-4000-8604-00000000000b'
             and channel = 'email'), 1, '[T-604] B''s email share was made');

select ok(exists (select 1 from pg_indexes where schemaname = 'app' and indexname = 'shares_email_per_day'),
          '[T-604] the per-day count reads an index of email shares by workspace and time');

select * from finish();
rollback;
