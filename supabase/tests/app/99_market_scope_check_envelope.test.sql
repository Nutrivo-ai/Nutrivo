-- Incident #274: app.request_check and app.request_envelope respect market scope (migration
-- 20261118092101_market_scope_check_envelope.sql, founder decision on #274 of 18 Nov 2026). Synthetic rows only,
-- rolled back; never regulatory content.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(50);
set local client_min_messages = warning;

-- ─── A: Ed (editor), Vic (viewer), Fay (editor scoped to family A2), Dana (editor scoped to EU-DK), Sid (editor
-- scoped to EU-DE), Pia (editor scoped to EU-FR, where the product is not sold), Eve (editor scoped to the region EU),
-- Ned (editor, membership ended). B: Bo (admin). ─────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-4000-8274-0000000000e1','ed@a.test'),  ('00000000-0000-4000-8274-0000000000f1','vic@a.test'),
  ('00000000-0000-4000-8274-0000000000e2','fay@a.test'), ('00000000-0000-4000-8274-0000000000e3','sid@a.test'),
  ('00000000-0000-4000-8274-0000000000e4','pia@a.test'), ('00000000-0000-4000-8274-0000000000e5','eve@a.test'),
  ('00000000-0000-4000-8274-0000000000e6','dana@a.test'), ('00000000-0000-4000-8274-0000000000d1','ned@a.test'),
  ('00000000-0000-4000-8274-0000000000b1','bo@b.test');
insert into app.people (id, user_id, display_name, email)
select ('10000000' || substr(u.id::text, 9))::uuid, u.id, split_part(u.email, '@', 1), u.email
from auth.users u where u.id::text like '00000000-0000-4000-8274-%';
insert into app.workspaces (id, name) values
  ('20000000-0000-4000-8274-00000000000a','Workspace A'), ('20000000-0000-4000-8274-00000000000b','Workspace B');
insert into app.families (id, workspace_id, name) values
  ('30000000-0000-4000-8274-00000000000a','20000000-0000-4000-8274-00000000000a','Family A'),
  ('30000000-0000-4000-8274-0000000000a2','20000000-0000-4000-8274-00000000000a','Family A2');
insert into app.memberships (workspace_id, person_id, role, ended_at) values
  ('20000000-0000-4000-8274-00000000000a','10000000-0000-4000-8274-0000000000d1','editor', now() - interval '1 day');
insert into app.memberships (workspace_id, person_id, role, scope_family_ids, scope_node_ids) values
  ('20000000-0000-4000-8274-00000000000a','10000000-0000-4000-8274-0000000000e1','editor',null,null),
  ('20000000-0000-4000-8274-00000000000a','10000000-0000-4000-8274-0000000000f1','viewer',null,null),
  ('20000000-0000-4000-8274-00000000000a','10000000-0000-4000-8274-0000000000e2','editor','{30000000-0000-4000-8274-0000000000a2}',null),
  ('20000000-0000-4000-8274-00000000000a','10000000-0000-4000-8274-0000000000e6','editor',null,'{EU-DK}'),
  ('20000000-0000-4000-8274-00000000000a','10000000-0000-4000-8274-0000000000e3','editor',null,'{EU-DE}'),
  ('20000000-0000-4000-8274-00000000000a','10000000-0000-4000-8274-0000000000e4','editor',null,'{EU-FR}'),
  ('20000000-0000-4000-8274-00000000000a','10000000-0000-4000-8274-0000000000e5','editor',null,'{EU}'),
  ('20000000-0000-4000-8274-00000000000b','10000000-0000-4000-8274-0000000000b1','admin',null,null);
-- K: sold in Denmark and Sweden, as in #274's reproduction. P: sold in Germany and Sweden. N: no markets yet. All
-- have artwork.
insert into app.products (id, workspace_id, family_id, name, stage, species, life_stage, format) values
  ('40000000-0000-4000-8274-00000000000a','20000000-0000-4000-8274-00000000000a','30000000-0000-4000-8274-00000000000a',
   'Adult dog','active','dog','adult','dry'),
  ('40000000-0000-4000-8274-00000000000b','20000000-0000-4000-8274-00000000000a','30000000-0000-4000-8274-00000000000a',
   'Cat','active','cat','adult','dry'),
  ('40000000-0000-4000-8274-00000000000c','20000000-0000-4000-8274-00000000000a','30000000-0000-4000-8274-00000000000a',
   'No markets','active','dog','adult','dry');
insert into app.product_nodes (product_id, node_id, workspace_id) values
  ('40000000-0000-4000-8274-00000000000a','EU-DE','20000000-0000-4000-8274-00000000000a'),
  ('40000000-0000-4000-8274-00000000000a','EU-SE','20000000-0000-4000-8274-00000000000a'),
  ('40000000-0000-4000-8274-00000000000b','EU-DK','20000000-0000-4000-8274-00000000000a'),
  ('40000000-0000-4000-8274-00000000000b','EU-SE','20000000-0000-4000-8274-00000000000a');
insert into app.artwork_versions (workspace_id, product_id, version, file_sha256, storage_path, is_new_artwork)
select '20000000-0000-4000-8274-00000000000a', p, 1, md5(p::text),
       '20000000-0000-4000-8274-00000000000a/' || p || '/a.pdf', true
from unnest(array['40000000-0000-4000-8274-00000000000a','40000000-0000-4000-8274-00000000000b',
                  '40000000-0000-4000-8274-00000000000c']::uuid[]) p;
insert into ref.ruleset_versions (id, released_at) values ('T274-V', now() + interval '1 second');

create temp table t (name text primary key, id uuid);
grant all on t to authenticated;
create function pg_temp.as_user(p_sub text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8274-0000000000' || p_sub,
                                                            'role', 'authenticated')::text, true)
$$;
create function pg_temp.jobs_of(p_kind text) returns int language sql as $$
  select count(*)::int from app.jobs where workspace_id = '20000000-0000-4000-8274-00000000000a' and kind = p_kind
$$;
create function pg_temp.id(p_name text) returns uuid language sql as $$ select id from t where name = p_name $$;
grant execute on all functions in schema pg_temp to authenticated;

-- ─── Grants ─────────────────────────────────────────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('authenticated', 'private.markets_in_scope(uuid)', 'execute')
          and not has_function_privilege('anon', 'private.markets_in_scope(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'private.request_markets(uuid,text[])', 'execute')
          and not has_function_privilege('anon', 'private.request_markets(uuid,text[])', 'execute')
          and not has_function_privilege('authenticated', 'private.market_scope_unrestricted(uuid)', 'execute')
          and not has_function_privilege('anon', 'private.market_scope_unrestricted(uuid)', 'execute'),
          '[#274] the market helpers are not callable by clients');
select ok(has_function_privilege('authenticated', 'app.request_check(uuid,text[])', 'execute')
          and not has_function_privilege('anon', 'app.request_check(uuid,text[])', 'execute')
          and has_function_privilege('authenticated', 'app.request_envelope(uuid)', 'execute')
          and not has_function_privilege('anon', 'app.request_envelope(uuid)', 'execute'),
          '[#274] the replaced RPCs keep their grants: authenticated, never anon');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where (n.nspname, p.proname) in (('app','request_check'),('app','request_envelope'),
                                            ('private','markets_in_scope'),('private','request_markets'),
                                            ('private','market_scope_unrestricted'))),
          '[#274] every replaced or new function is security definer with an empty search_path');

-- ─── request_check: a viewer and a member of another family are refused, whatever they name ───────────────────
select pg_temp.as_user('f1');
set local role authenticated;
select throws_ok($$select app.request_check('40000000-0000-4000-8274-00000000000a')$$, '42501', null,
                 '[#274] request_check: a viewer is refused (no list)');
select throws_ok($$select app.request_check('40000000-0000-4000-8274-00000000000a', '{EU-DE}')$$, '42501', null,
                 '[#274] request_check: a viewer is refused (explicit list)');
reset role;
select pg_temp.as_user('e2');
set local role authenticated;
select throws_ok($$select app.request_check('40000000-0000-4000-8274-00000000000a')$$, '42501', null,
                 '[#274] request_check: an editor scoped to another family is refused (no list)');
select throws_ok($$select app.request_check('40000000-0000-4000-8274-00000000000a', '{EU-DE}')$$, '42501', null,
                 '[#274] request_check: an editor scoped to another family is refused (explicit list)');
reset role;

-- ─── #274's reproduction: Dana (EU-DK) on K (EU-DK, EU-SE) ─────────────────────────────────────────────────────
select pg_temp.as_user('e6');
set local role authenticated;
select throws_ok($$select app.request_check('40000000-0000-4000-8274-00000000000b', '{EU-SE}')$$, '42501', null,
                 '[#274] request_check: an EU-DK-scoped editor naming EU-SE is refused');
select throws_ok($$select app.request_check('40000000-0000-4000-8274-00000000000b', '{ZZ-NOT-A-MARKET}')$$, '42501', null,
                 '[#274] request_check: an EU-DK-scoped editor naming a node outside the scope is refused');
insert into t select 'dana_check', app.request_check('40000000-0000-4000-8274-00000000000b');
select throws_ok($$select app.request_envelope('40000000-0000-4000-8274-00000000000b')$$, '42501', null,
                 '[#274] request_envelope: an EU-DK-scoped editor is refused for a product also sold in EU-SE');
select is((select count(*)::int from app.jobs where id = pg_temp.id('dana_check')), 1,
          '[#274] request_check: the EU-DK-scoped editor reads the check job they queued');
reset role;
select is((select node_ids from app.jobs where id = pg_temp.id('dana_check')), '{EU-DK}'::text[],
          '[#274] request_check with no list: the EU-DK-scoped editor queues only EU-DK');
select is((select count(*)::int from app.jobs where workspace_id = '20000000-0000-4000-8274-00000000000a'
                                                and product_id = '40000000-0000-4000-8274-00000000000b'), 1,
          '[#274] reproduction: of the four calls, only the in-scope check queued a job');

-- ─── request_check as Sid (EU-DE) on P: their market only, and never a part of a list ──────────────────────────
select pg_temp.as_user('e3');
set local role authenticated;
insert into t select 'sid_check', app.request_check('40000000-0000-4000-8274-00000000000a');
insert into t select 'sid_check_de', app.request_check('40000000-0000-4000-8274-00000000000a', '{EU-DE}');
select throws_ok($$select app.request_check('40000000-0000-4000-8274-00000000000a', '{EU-DE,EU-SE}')$$, '42501', null,
                 '[#274] request_check: one out-of-scope market refuses the whole list');
select throws_ok($$select app.request_check('40000000-0000-4000-8274-00000000000c')$$, '42501', null,
                 '[#274] request_check: a scoped editor gets 42501 for a product with no markets too, so hidden markets do not show');
select is((select count(*)::int from app.jobs where id = pg_temp.id('sid_check')), 1,
          '[#274] request_check: a market-scoped editor reads the check job they requested');
reset role;
select is((select payload -> 'node_ids' from app.jobs where id = pg_temp.id('sid_check')), '["EU-DE"]'::jsonb,
          '[#274] request_check: the payload names only the in-scope market');
select ok((select idempotency_key like '%:EU-DE:%' from app.jobs where id = pg_temp.id('sid_check')),
          '[#274] request_check: the idempotency key names only the in-scope market');
select is(pg_temp.id('sid_check_de'), pg_temp.id('sid_check'),
          '[#274] request_check: naming the in-scope market explicitly is the same job as no list');
select is((select count(*)::int from app.jobs where workspace_id = '20000000-0000-4000-8274-00000000000a'
                                                and kind = 'check' and product_id = '40000000-0000-4000-8274-00000000000a'), 1,
          '[#274] request_check: no refused call queued anything, not even part of a list');

-- ─── request_check as Pia (EU-FR): none of the product's markets is theirs ──────────────────────────────────────
select pg_temp.as_user('e4');
set local role authenticated;
select throws_ok($$select app.request_check('40000000-0000-4000-8274-00000000000a')$$, '42501', null,
                 '[#274] request_check with no list: no market of the product in scope is 42501, never an empty job');
select throws_ok($$select app.request_check('40000000-0000-4000-8274-00000000000a', '{EU-FR}')$$, '22023', null,
                 '[#274] request_check: an in-scope node that is not a market of the product is 22023');
reset role;

-- ─── request_check as Ed (unscoped): as before for the product's markets; anything else is 22023 ──────────────
select pg_temp.as_user('e1');
set local role authenticated;
insert into t select 'ed_check', app.request_check('40000000-0000-4000-8274-00000000000a');
insert into t select 'ed_check_se', app.request_check('40000000-0000-4000-8274-00000000000a', '{EU-SE}');
select is(app.request_check('40000000-0000-4000-8274-00000000000a', '{EU-SE,EU-DE,EU-SE}'), pg_temp.id('ed_check'),
          '[#274] request_check: a reordered list with a duplicate is the same job as the same markets with no list');
select throws_ok($$select app.request_check('40000000-0000-4000-8274-00000000000a', '{ZZ-NOT-A-MARKET}')$$, '22023', null,
                 '[#274] request_check: a node that is not a market of the product is refused (22023)');
select throws_ok($$select app.request_check('40000000-0000-4000-8274-00000000000a', '{EU-DE,EU-DK}')$$, '22023', null,
                 '[#274] request_check: one node that is not a market of the product refuses the whole list');
select throws_ok($$select app.request_check('40000000-0000-4000-8274-00000000000a', '{}')$$, '22023', null,
                 '[#274] request_check: an empty list names no market (22023)');
select throws_ok($$select app.request_check('40000000-0000-4000-8274-00000000000a', array[null]::text[])$$, '22023', null,
                 '[#274] request_check: a null node is not a market (22023)');
select throws_ok($$select app.request_check('40000000-0000-4000-8274-00000000000c')$$, '22023', null,
                 '[#274] request_check: a product with no markets has nothing to check (22023)');
reset role;
select is((select node_ids from app.jobs where id = pg_temp.id('ed_check')), '{EU-DE,EU-SE}'::text[],
          '[#274] request_check with no list: an unscoped editor still queues every market of the product');
select is((select node_ids from app.jobs where id = pg_temp.id('ed_check_se')), '{EU-SE}'::text[],
          '[#274] request_check: an unscoped editor may name any market of the product');

-- ─── A region scope covers its markets ──────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('e5');
set local role authenticated;
select is(app.request_check('40000000-0000-4000-8274-00000000000a'), pg_temp.id('ed_check'),
          '[#274] request_check: an editor scoped to the region EU checks every market in it (the same job)');
insert into t select 'eve_env', app.request_envelope('40000000-0000-4000-8274-00000000000a');
select is((select count(*)::int from app.jobs where id = pg_temp.id('eve_env')), 1,
          '[#274] request_envelope: an editor scoped to the region EU, which holds every market, may request it');
reset role;
select is(pg_temp.jobs_of('check'), 4, '[#274] request_check: the accepted calls queued four jobs and the refused ones none');
select is((select string_agg(a.after ->> 'node_ids', ' ' order by a.after ->> 'node_ids' collate "C") from app.audit_events a
           where a.workspace_id = '20000000-0000-4000-8274-00000000000a' and a.kind = 'check.requested'),
          '["EU-DE", "EU-SE"] ["EU-DE", "EU-SE"] ["EU-DE", "EU-SE"] ["EU-DE"] ["EU-DE"] ["EU-DK"] ["EU-SE"]',
          '[#274] request_check audits check.requested with the markets of every accepted request, and nothing for a refusal');

-- ─── request_envelope: refused unless every market of the product is in scope ─────────────────────────────────
select pg_temp.as_user('f1');
set local role authenticated;
select throws_ok($$select app.request_envelope('40000000-0000-4000-8274-00000000000a')$$, '42501', null,
                 '[#274] request_envelope: a viewer is refused');
reset role;
select pg_temp.as_user('e2');
set local role authenticated;
select throws_ok($$select app.request_envelope('40000000-0000-4000-8274-00000000000a')$$, '42501', null,
                 '[#274] request_envelope: an editor scoped to another family is refused');
reset role;
select pg_temp.as_user('e3');
set local role authenticated;
select throws_ok($$select app.request_envelope('40000000-0000-4000-8274-00000000000a')$$, '42501', null,
                 '[#274] request_envelope: an editor who sees only some of the product''s markets is refused');
select throws_ok($$select app.request_envelope('40000000-0000-4000-8274-00000000000c')$$, '22023', null,
                 '[#274] request_envelope: a product with no markets has none outside the scope, and is 22023 as before');
reset role;
select pg_temp.as_user('e4');
set local role authenticated;
select throws_ok($$select app.request_envelope('40000000-0000-4000-8274-00000000000a')$$, '42501', null,
                 '[#274] request_envelope: an editor with none of the product''s markets in scope is refused');
reset role;
select is(pg_temp.jobs_of('envelope'), 1, '[#274] request_envelope: the refused calls queued nothing');

select pg_temp.as_user('e1');
set local role authenticated;
select is(app.request_envelope('40000000-0000-4000-8274-00000000000a'), pg_temp.id('eve_env'),
          '[#274] request_envelope: an unscoped editor may request it, and gets the same envelope job');
select is((select payload ->> 'inputs_hash' from app.jobs where id = pg_temp.id('eve_env')),
          app.envelope_inputs_hash('40000000-0000-4000-8274-00000000000a'),
          '[#274] envelope_inputs_hash: the envelope is still of every market of the product, as before');
select throws_ok($$select app.request_envelope('40000000-0000-4000-8274-00000000000c')$$, '22023', null,
                 '[#274] request_envelope: a product with no markets is still 22023 for an unscoped editor');
reset role;
select is((select payload -> 'node_ids' from app.jobs where id = pg_temp.id('eve_env')), '["EU-DE", "EU-SE"]'::jsonb,
          '[#274] request_envelope: the payload names every market of the product');
select is((select string_agg(a.after ->> 'node_ids', ' ') from app.audit_events a
           where a.workspace_id = '20000000-0000-4000-8274-00000000000a' and a.kind = 'envelope.requested'),
          '["EU-DE", "EU-SE"] ["EU-DE", "EU-SE"]',
          '[#274] request_envelope audits envelope.requested with its markets, and nothing for a refusal');

-- ─── An ended membership and another workspace are refused ──────────────────────────────────────────────────────
select pg_temp.as_user('d1');
set local role authenticated;
select throws_ok($$select app.request_check('40000000-0000-4000-8274-00000000000a')$$, '42501', null,
                 '[#274] request_check: an editor whose membership ended is refused');
select throws_ok($$select app.request_envelope('40000000-0000-4000-8274-00000000000a')$$, '42501', null,
                 '[#274] request_envelope: an editor whose membership ended is refused');
reset role;
select pg_temp.as_user('b1');
set local role authenticated;
select throws_ok($$select app.request_check('40000000-0000-4000-8274-00000000000a')$$, '42501', null,
                 '[#274] request_check: an admin of another workspace is refused');
select throws_ok($$select app.request_envelope('40000000-0000-4000-8274-00000000000a')$$, '42501', null,
                 '[#274] request_envelope: an admin of another workspace is refused');
select is((select count(*)::int from app.jobs), 0, '[#274] another workspace reads none of these jobs');
reset role;

select * from finish();
rollback;
