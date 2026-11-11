-- T-1002 · E02 Compute the compliance envelope: app.request_envelope, app.envelope_nodes, the envelope guards and
-- insert-only enforcement (migration 20261111020715). Synthetic rows only, rolled back; never regulatory content.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(27);
set local client_min_messages = warning;

-- ─── A: Ed (editor), Vic (viewer), Dee (viewer scoped to EU-DE). B: Bo (admin). ────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-4000-8102-0000000000e1','ed@a.test'), ('00000000-0000-4000-8102-0000000000f1','vic@a.test'),
  ('00000000-0000-4000-8102-0000000000d1','dee@a.test'), ('00000000-0000-4000-8102-0000000000b1','bo@b.test');
insert into app.people (id, user_id, display_name, email)
select ('10000000' || substr(u.id::text, 9))::uuid, u.id, split_part(u.email, '@', 1), u.email
from auth.users u where u.id::text like '00000000-0000-4000-8102-%';
insert into app.workspaces (id, name) values
  ('20000000-0000-4000-8102-00000000000a','Workspace A'), ('20000000-0000-4000-8102-00000000000b','Workspace B');
insert into app.families (id, workspace_id, name) values
  ('30000000-0000-4000-8102-00000000000a','20000000-0000-4000-8102-00000000000a','Family A'),
  ('30000000-0000-4000-8102-00000000000b','20000000-0000-4000-8102-00000000000b','Family B');
insert into app.memberships (workspace_id, person_id, role, scope_node_ids) values
  ('20000000-0000-4000-8102-00000000000a','10000000-0000-4000-8102-0000000000e1','editor', null),
  ('20000000-0000-4000-8102-00000000000a','10000000-0000-4000-8102-0000000000f1','viewer', null),
  ('20000000-0000-4000-8102-00000000000a','10000000-0000-4000-8102-0000000000d1','viewer', '{EU-DE}'),
  ('20000000-0000-4000-8102-00000000000b','10000000-0000-4000-8102-0000000000b1','admin', null);
insert into app.products (id, workspace_id, family_id, name, stage, species, life_stage, format) values
  ('40000000-0000-4000-8102-00000000000a','20000000-0000-4000-8102-00000000000a','30000000-0000-4000-8102-00000000000a',
   'Senior brief','brief','dog','senior','wet'),
  ('40000000-0000-4000-8102-00000000000c','20000000-0000-4000-8102-00000000000a','30000000-0000-4000-8102-00000000000a',
   'No markets','brief','dog',null,null);
insert into app.product_nodes (product_id, node_id, workspace_id) values
  ('40000000-0000-4000-8102-00000000000a','EU-DE','20000000-0000-4000-8102-00000000000a'),
  ('40000000-0000-4000-8102-00000000000a','EU-AT','20000000-0000-4000-8102-00000000000a');

-- Ruleset T1002-V (released last): EU-AT fully encoded; EU-DE with the composition domain not encoded.
insert into ref.ruleset_versions (id, released_at) values ('T1002-V', now() + interval '1 second');
insert into ref.coverage_gaps (gap_id, node_id, domain, reason_code, description) values
  ('GAP-T1002-DE-COMP','EU-DE','composition','not_encoded','Synthetic test gap');
insert into ref.coverage_nodes (ruleset_version, node_id, domain, state, rules_encoded, gap_id)
select 'T1002-V', n, d,
       case when n = 'EU-DE' and d = 'composition' then 'not_encoded' else 'complete' end,
       case when n = 'EU-DE' and d = 'composition' then 0 else 1 end,
       case when n = 'EU-DE' and d = 'composition' then 'GAP-T1002-DE-COMP' end
from unnest(array['EU-DE','EU-AT']) n,
     unnest(array['mandatory_particulars','composition','claims_wording','type_geometry','language','registration']) d;

create temp table t_ids (name text primary key, id uuid);
grant all on t_ids to authenticated;
create function pg_temp.as_user(p_sub text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true)
$$;

-- ─── Tables: RLS, grants, insert-only ──────────────────────────────────────────────────────────────────────────
select ok((select relrowsecurity from pg_class where oid = 'app.envelope_nodes'::regclass),
          '[T-1002] RLS is enabled on app.envelope_nodes');
select ok(not has_table_privilege('authenticated', 'app.envelope_nodes', 'insert, update, delete')
          and not has_table_privilege('authenticated', 'app.envelopes', 'insert, update, delete')
          and not has_table_privilege('authenticated', 'app.envelope_items', 'insert, update, delete')
          and not has_table_privilege('anon', 'app.envelope_nodes', 'select'),
          '[T-1002] no client write grants on the envelope tables, and nothing for anon');
select ok(not has_function_privilege('anon', 'app.request_envelope(uuid)', 'execute')
          and has_function_privilege('authenticated', 'app.request_envelope(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'private.envelope_inputs_hash(uuid, text[])', 'execute'),
          '[T-1002] authenticated may call app.request_envelope; anon may not; the hash helper is private');

-- ─── E02.main: Ed requests the envelope; the same inputs return the cached job ─────────────────────────────────
select pg_temp.as_user('00000000-0000-4000-8102-0000000000e1');
set local role authenticated;
insert into t_ids select 'job1', app.request_envelope('40000000-0000-4000-8102-00000000000a');
insert into t_ids select 'job2', app.request_envelope('40000000-0000-4000-8102-00000000000a');
select throws_ok($$select app.request_envelope('40000000-0000-4000-8102-00000000000c')$$, '22023', null,
                 '[E02.main] a product with no markets has nothing to compute an envelope for');
select is(app.set_intended_claims('40000000-0000-4000-8102-00000000000a', 'de', array['Für ältere Hunde']), 1,
          '[E02.main] the editor changes an input: an intended claim in German');
insert into t_ids select 'job3', app.request_envelope('40000000-0000-4000-8102-00000000000a');
reset role;

select is((select id from t_ids where name = 'job2'), (select id from t_ids where name = 'job1'),
          '[E02.main] the same inputs return the same job, so the cached envelope (inputs_hash)');
select isnt((select id from t_ids where name = 'job3'), (select id from t_ids where name = 'job1'),
            '[E02.main] a changed input (an intended claim) is a new inputs_hash and a new job');
select ok((select kind = 'envelope' and payload ->> 'ruleset_version' = 'T1002-V'
                  and payload -> 'node_ids' = '["EU-AT","EU-DE"]'::jsonb
                  and payload ->> 'inputs_hash' = private.envelope_inputs_hash('40000000-0000-4000-8102-00000000000a',
                                                                               '{EU-AT,EU-DE}')
                  and payload ->> 'formula_digest' = '-'
                  and idempotency_key = 'envelope:40000000-0000-4000-8102-00000000000a:T1002-V:'
                                        || (payload ->> 'inputs_hash')
             from app.jobs where id = (select id from t_ids where name = 'job3')),
          '[E02.main] the job pins the latest released ruleset, the markets and the inputs_hash; ids and digests only');
select is((select count(*)::int from app.audit_events where kind = 'envelope.requested'
             and object_id = '40000000-0000-4000-8102-00000000000a'
             and actor_id = '10000000-0000-4000-8102-0000000000e1'), 3,
          '[E02.main] each request is audited envelope.requested');

-- Vic (viewer) and Bo (another workspace) may not request one.
select pg_temp.as_user('00000000-0000-4000-8102-0000000000f1');
set local role authenticated;
select throws_ok($$select app.request_envelope('40000000-0000-4000-8102-00000000000a')$$, '42501', null,
                 '[E02.main] a viewer cannot request an envelope');
reset role;
select pg_temp.as_user('00000000-0000-4000-8102-0000000000b1');
set local role authenticated;
select throws_ok($$select app.request_envelope('40000000-0000-4000-8102-00000000000a')$$, '42501', null,
                 '[E02.main] another workspace cannot request an envelope');
reset role;

-- The worker (service role) writes the envelope: items first, then the markets.
insert into app.envelopes (id, workspace_id, product_id, ruleset_version, inputs_hash, job_id, formula_digest, node_ids)
select '60000000-0000-4000-8102-0000000000e1', '20000000-0000-4000-8102-00000000000a',
       '40000000-0000-4000-8102-00000000000a', 'T1002-V', payload ->> 'inputs_hash', id, '-', '{EU-AT,EU-DE}'
from app.jobs where id = (select id from t_ids where name = 'job3');
insert into app.envelope_items (workspace_id, product_id, envelope_id, node_id, language, kind, rule_key, rule_version,
                                gap_id, provenance, reason_code, citation, payload) values
  ('20000000-0000-4000-8102-00000000000a','40000000-0000-4000-8102-00000000000a','60000000-0000-4000-8102-0000000000e1',
   'EU-AT','de','requirement','T1002.R1',1,null,'deterministic_rule',null,'Test art. 1','{"wordings": ["Testwort"]}'),
  ('20000000-0000-4000-8102-00000000000a','40000000-0000-4000-8102-00000000000a','60000000-0000-4000-8102-0000000000e1',
   'EU-DE','de','requirement','T1002.R1',1,null,'deterministic_rule',null,'Test art. 1','{"wordings": ["Testwort"]}'),
  ('20000000-0000-4000-8102-00000000000a','40000000-0000-4000-8102-00000000000a','60000000-0000-4000-8102-0000000000e1',
   'EU-DE',null,'not_assessed',null,null,'GAP-T1002-DE-COMP','not_assessed','not_encoded',null,'{}');

-- ─── E02.must.1: anything not encoded is withheld with its gap, never Clear ─────────────────────────────────────
select throws_ok($$insert into app.envelope_nodes (workspace_id, product_id, envelope_id, node_id, state)
                   values ('20000000-0000-4000-8102-00000000000a','40000000-0000-4000-8102-00000000000a',
                           '60000000-0000-4000-8102-0000000000e1','EU-DE','clear')$$,
                 'P0021', null, '[E02.must.1] a market with an encoding gap is never clear in its envelope');
select lives_ok($$insert into app.envelope_nodes (workspace_id, product_id, envelope_id, node_id, state, withheld)
                  values ('20000000-0000-4000-8102-00000000000a','40000000-0000-4000-8102-00000000000a',
                          '60000000-0000-4000-8102-0000000000e1','EU-DE','not_assessed', 1)$$,
                '[E02.must.1] the same market is written not_assessed');
select lives_ok($$insert into app.envelope_nodes (workspace_id, product_id, envelope_id, node_id, state)
                  values ('20000000-0000-4000-8102-00000000000a','40000000-0000-4000-8102-00000000000a',
                          '60000000-0000-4000-8102-0000000000e1','EU-AT','clear')$$,
                '[E02.must.1] a fully encoded market with nothing withheld can be clear as briefed');
select throws_ok($$insert into app.envelope_items (workspace_id, product_id, envelope_id, node_id, kind, rule_key,
                                                 rule_version, provenance)
                   values ('20000000-0000-4000-8102-00000000000a','40000000-0000-4000-8102-00000000000a',
                           '60000000-0000-4000-8102-0000000000e1','EU-AT','not_assessed','T1002.R2',1,'not_assessed')$$,
                 '23514', null, '[E02.must.1] a withheld item always carries its reason code');
select throws_ok($$insert into app.envelope_items (workspace_id, product_id, envelope_id, node_id, kind, provenance,
                                                 reason_code)
                   values ('20000000-0000-4000-8102-00000000000a','40000000-0000-4000-8102-00000000000a',
                           '60000000-0000-4000-8102-0000000000e1','EU-AT','not_assessed','not_assessed','not_encoded')$$,
                 '23514', null, '[E02.must.1] a withheld item names its gap_id or rule_key');
select throws_ok($$insert into app.envelope_items (workspace_id, product_id, envelope_id, node_id, kind, rule_key,
                                                 rule_version, provenance)
                   values ('20000000-0000-4000-8102-00000000000a','40000000-0000-4000-8102-00000000000a',
                           '60000000-0000-4000-8102-0000000000e1','EU-AT','permitted','T1002.R3',1,'model_judgement')$$,
                 '23514', null, '[E02.must.1] the model produces no envelope item (non-negotiable 6)');
select throws_ok($$insert into app.envelope_items (workspace_id, product_id, envelope_id, node_id, kind, rule_key,
                                                 rule_version, provenance)
                   values ('20000000-0000-4000-8102-00000000000a','40000000-0000-4000-8102-00000000000a',
                           '60000000-0000-4000-8102-0000000000e1','EU-FR','permitted','T1002.R3',1,'deterministic_rule')$$,
                 '23514', null, '[T-1002] an item names only a market the envelope was computed for');

-- ─── E02.must.2: nutrient adequacy stays out of scope ──────────────────────────────────────────────────────────
select ok((select 'nutrient_adequacy' = any(out_of_scope) from app.envelopes
           where id = '60000000-0000-4000-8102-0000000000e1'),
          '[E02.must.2] every envelope records nutrient adequacy as out of scope');
select throws_ok($$insert into app.envelopes (workspace_id, product_id, ruleset_version, inputs_hash, out_of_scope)
                   values ('20000000-0000-4000-8102-00000000000a','40000000-0000-4000-8102-00000000000a',
                           'T1002-V','x','{}')$$,
                 '23514', null, '[E02.must.2] an envelope that would answer nutrient adequacy is refused');

-- ─── Insert-only ───────────────────────────────────────────────────────────────────────────────────────────────
select throws_ok($$update app.envelope_nodes set state = 'clear'$$, 'P0005', null,
                 '[T-1002] envelope markets are insert-only, even for the table owner');
select throws_ok($$delete from app.envelope_items$$, 'P0005', null, '[T-1002] envelope items are insert-only');
select throws_ok($$update app.envelopes set inputs_hash = 'y'$$, 'P0005', null, '[T-1002] envelopes are insert-only');

-- ─── Reads: by product and market scope only ───────────────────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-4000-8102-0000000000f1');
set local role authenticated;
select is((select count(*)::int from app.envelope_nodes), 2, '[E02.main] a viewer reads the envelope''s markets');
select is((select count(*)::int from app.envelope_items), 3, '[E02.main] and its items');
reset role;
select pg_temp.as_user('00000000-0000-4000-8102-0000000000d1');
set local role authenticated;
select results_eq($$select node_id from app.envelope_nodes$$, $$values ('EU-DE'::text)$$,
                  '[T-1002] a viewer scoped to EU-DE reads only that market''s row');
reset role;
select pg_temp.as_user('00000000-0000-4000-8102-0000000000b1');
set local role authenticated;
select is((select count(*)::int from app.envelope_nodes) + (select count(*)::int from app.envelope_items)
          + (select count(*)::int from app.envelopes), 0,
          '[T-1002] another workspace reads none of the envelope');
reset role;

select * from finish();
rollback;
