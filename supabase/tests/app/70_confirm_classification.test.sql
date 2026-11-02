-- T-402 · D03: app.confirm_classification. A person confirms or edits the latest classification; every confirmation
-- is a new insert-only row with the person, the time, the label evidence of the values left as suggested, and an
-- audit event. A stale basis, a viewer, another workspace and a value outside the vocabulary are refused.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(24);
set local client_min_messages = warning;

-- A: Ed (editor), Vi (viewer). B: Bo (admin).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8402-0000000000e1','ed@a.test'), ('00000000-0000-4000-8402-0000000000f1','vi@a.test'),
  ('00000000-0000-4000-8402-0000000000b1','bo@b.test');
insert into app.people (id, user_id, display_name, email)
select ('10000000' || substr(u.id::text, 9))::uuid, u.id, split_part(u.email, '@', 1), u.email
from auth.users u where u.id::text like '00000000-0000-4000-8402-%';
insert into app.workspaces (id, name) values
  ('20000000-0000-4000-8402-00000000000a','Workspace A'), ('20000000-0000-4000-8402-00000000000b','Workspace B');
insert into app.memberships (workspace_id, person_id, role) values
  ('20000000-0000-4000-8402-00000000000a','10000000-0000-4000-8402-0000000000e1','editor'),
  ('20000000-0000-4000-8402-00000000000a','10000000-0000-4000-8402-0000000000f1','viewer'),
  ('20000000-0000-4000-8402-00000000000b','10000000-0000-4000-8402-0000000000b1','admin');
insert into app.families (id, workspace_id, name) values
  ('30000000-0000-4000-8402-00000000000a','20000000-0000-4000-8402-00000000000a','Cats');
insert into app.products (id, workspace_id, family_id, name, stage) values
  ('40000000-0000-4000-8402-0000000000a1','20000000-0000-4000-8402-00000000000a','30000000-0000-4000-8402-00000000000a','Cat adult','active'),
  ('40000000-0000-4000-8402-0000000000a2','20000000-0000-4000-8402-00000000000a','30000000-0000-4000-8402-00000000000a','Unclassified','active');
-- The model's suggestion, as the worker writes it: unconfirmed, label evidence per field.
insert into app.classifications (id, workspace_id, product_id, species, life_stage, product_class, citation,
                                 provenance, created_at) values
  ('50000000-0000-4000-8402-0000000000a5','20000000-0000-4000-8402-00000000000a','40000000-0000-4000-8402-0000000000a1',
   'cat','adult','complete',
   '{"basis":"label_text","fields":{"species":{"quote":"Complete feed for adult cats","panel_index":0,"language":"en"},'
   '"life_stage":{"quote":"Complete feed for adult cats","panel_index":0,"language":"en"},'
   '"product_class":{"quote":"Complete feed for adult cats","panel_index":0,"language":"en"}},"empty":{}}',
   'model_judgement', now() - interval '1 hour');

create temp table t_ids (name text primary key, id uuid);
grant all on t_ids to authenticated;
create function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

select ok(not has_function_privilege('anon', 'app.confirm_classification(uuid,uuid,text,text,text,text,text)', 'execute')
          and has_function_privilege('authenticated', 'app.confirm_classification(uuid,uuid,text,text,text,text,text)', 'execute'),
          '[T-402] app.confirm_classification is executable by authenticated users and never by anon');

-- ─── D03.main: the editor confirms the suggestion as it stands ──────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-4000-8402-0000000000e1');
set local role authenticated;
insert into t_ids values ('confirmed', app.confirm_classification('40000000-0000-4000-8402-0000000000a1',
  '50000000-0000-4000-8402-0000000000a5', 'cat', 'adult', 'complete', null, null));
reset role;
select ok((select provenance = 'person' and confirmed_by = '10000000-0000-4000-8402-0000000000e1'
                  and confirmed_at is not null and species = 'cat' and life_stage = 'adult' and product_class = 'complete'
             from app.classifications where id = (select id from t_ids where name = 'confirmed')),
          '[D03.main] a person confirms: a new row with the person, the time and the values');
select is((select citation::jsonb #>> '{fields,species,quote}' from app.classifications
            where id = (select id from t_ids where name = 'confirmed')),
          'Complete feed for adult cats', '[D03.main] the label evidence of each value left as suggested is kept');
select is((select citation::jsonb -> 'edited' from app.classifications
            where id = (select id from t_ids where name = 'confirmed')),
          '[]'::jsonb, '[D03.main] nothing edited is recorded as nothing edited');
select ok((select confirmed_at is null and provenance = 'model_judgement' from app.classifications
            where id = '50000000-0000-4000-8402-0000000000a5'),
          '[D03.main] the suggestion itself is never updated (insert-only)');
select is((select count(*)::int from app.audit_events where kind = 'classification.confirmed'
            and object_id = (select id::text from t_ids where name = 'confirmed')
            and actor_id = '10000000-0000-4000-8402-0000000000e1'
            and before ->> 'species' = 'cat' and after ->> 'basis' = '50000000-0000-4000-8402-0000000000a5'),
          1, '[D03.main] the confirmation is audited with before and after');
select is((select id from app.classifications where product_id = '40000000-0000-4000-8402-0000000000a1'
            order by created_at desc, id desc limit 1),
          (select id from t_ids where name = 'confirmed'), '[D03.must.2] the confirmation is now the latest classification');

-- ─── An edit: the person changes the life stage; the edited value rests on the person, not the label ───────────
select pg_temp.as_user('00000000-0000-4000-8402-0000000000e1');
set local role authenticated;
insert into t_ids values ('edited', app.confirm_classification('40000000-0000-4000-8402-0000000000a1',
  (select id from t_ids where name = 'confirmed'), 'cat', 'senior', 'complete', null, 'parnut'));
reset role;
select is((select citation::jsonb -> 'edited' from app.classifications where id = (select id from t_ids where name = 'edited')),
          '["life_stage", "parnut_status"]'::jsonb, 'an edit names the fields the person changed');
select ok((select citation::jsonb #> '{fields,life_stage}' is null
                  and citation::jsonb #>> '{fields,species,quote}' = 'Complete feed for adult cats'
             from app.classifications where id = (select id from t_ids where name = 'edited')),
          'an edited value carries no label evidence; an unchanged one keeps its label evidence');
select is((select life_stage || '/' || parnut_status from app.classifications where id = (select id from t_ids where name = 'edited')),
          'senior/parnut', 'a person sets a value the suggestion left empty');

-- ─── Refusals ───────────────────────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-4000-8402-0000000000e1');
set local role authenticated;
select throws_ok($$ select app.confirm_classification('40000000-0000-4000-8402-0000000000a1',
  '50000000-0000-4000-8402-0000000000a5', 'cat', 'adult', 'complete', null, null) $$,
  'P0045', null, 'a stale basis is refused (P0045): never overwrite a newer classification');
select throws_ok($$ select app.confirm_classification('40000000-0000-4000-8402-0000000000a1',
  (select id from t_ids where name = 'edited'), 'hamster', null, null, null, null) $$,
  '22023', null, 'a species outside the vocabulary is refused');
select throws_ok($$ select app.confirm_classification('40000000-0000-4000-8402-0000000000a1',
  (select id from t_ids where name = 'edited'), 'cat', 'kitten', null, null, null) $$,
  '22023', null, 'a life stage outside the vocabulary is refused');
select throws_ok($$ select app.confirm_classification('40000000-0000-4000-8402-0000000000a1',
  (select id from t_ids where name = 'edited'), 'cat', null, 'snack', null, null) $$,
  '22023', null, 'a product class outside the vocabulary is refused');
select throws_ok($$ select app.confirm_classification('40000000-0000-4000-8402-0000000000a1',
  (select id from t_ids where name = 'edited'), 'cat', null, null, 'daily ration', null) $$,
  '22023', null, 'intended use has no vocabulary yet, so any value is refused');
select throws_ok($$ select app.confirm_classification('40000000-0000-4000-8402-0000000000a1',
  (select id from t_ids where name = 'edited'), 'cat', null, null, null, 'not_parnut') $$,
  '22023', null, 'PARNUT status is only ever positive (Q3 on #44): not_parnut is refused');
select throws_ok($$ select app.confirm_classification('40000000-0000-4000-8402-0000000000a2',
  '50000000-0000-4000-8402-0000000000a5', 'cat', null, null, null, null) $$,
  'P0045', null, 'a basis that is not this product''s latest classification is refused');
-- A product with no classification yet: the person classifies it from nothing (basis null).
insert into t_ids values ('fresh', app.confirm_classification('40000000-0000-4000-8402-0000000000a2', null,
  'dog', null, 'treat', null, null));
reset role;
select ok((select confirmed_at is not null and citation::jsonb -> 'edited' = '["species", "product_class"]'::jsonb
             from app.classifications where id = (select id from t_ids where name = 'fresh')),
          'a product with no classification is classified by a person from nothing');

select pg_temp.as_user('00000000-0000-4000-8402-0000000000f1');
set local role authenticated;
select throws_ok($$ select app.confirm_classification('40000000-0000-4000-8402-0000000000a1',
  (select id from t_ids where name = 'edited'), 'cat', null, null, null, null) $$,
  '42501', null, 'a viewer cannot confirm');
reset role;
select pg_temp.as_user('00000000-0000-4000-8402-0000000000b1');
set local role authenticated;
select throws_ok($$ select app.confirm_classification('40000000-0000-4000-8402-0000000000a1',
  (select id from t_ids where name = 'edited'), 'cat', null, null, null, null) $$,
  '42501', null, 'an admin of another workspace cannot confirm');
select is((select count(*)::int from app.classifications where workspace_id = '20000000-0000-4000-8402-00000000000a'),
          0, 'another workspace reads none of A''s classifications (RLS)');
reset role;
select pg_temp.as_user('00000000-0000-4000-8402-0000000000f1');
set local role authenticated;
select is((select count(*)::int from app.classifications where workspace_id = '20000000-0000-4000-8402-00000000000a'),
          4, 'a viewer of A reads its classifications');
select throws_ok($$ insert into app.classifications (workspace_id, product_id, citation, provenance)
  values ('20000000-0000-4000-8402-00000000000a','40000000-0000-4000-8402-0000000000a1','x','person') $$,
  '42501', null, 'no client writes a classification directly: only through the RPC');
reset role;

-- A person whose account is tombstoned is nobody: refused, so no confirmation is ever written without a person.
update app.people set tombstoned_at = now() where id = '10000000-0000-4000-8402-0000000000e1';
select pg_temp.as_user('00000000-0000-4000-8402-0000000000e1');
set local role authenticated;
select throws_ok($$ select app.confirm_classification('40000000-0000-4000-8402-0000000000a1',
  (select id from t_ids where name = 'edited'), 'cat', null, null, null, null) $$,
  '42501', null, 'a tombstoned person cannot confirm, even with a membership left open');
reset role;

select * from finish();
rollback;
