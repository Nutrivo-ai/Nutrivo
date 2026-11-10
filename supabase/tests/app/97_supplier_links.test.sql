-- T-802 · H02 (request a document from a supplier) and H03 (supplier uploads through a link): app.request_document,
-- the token guard, app.supplier_request_for_token, app.accept_supplier_upload and app.record_scan_result.
-- Promotion is a new row (founder decision, #69); app.supplier_documents stays insert-only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(56);
set local client_min_messages = warning;

-- ─── A: Alice (admin), Carl (editor), Vera (viewer), Sid (editor scoped to family A2). B: Bob (admin). ──────────────
insert into auth.users (id, email) values
  ('00000000-0000-4000-8802-0000000000a1','alice@a.test'), ('00000000-0000-4000-8802-0000000000c1','carl@a.test'),
  ('00000000-0000-4000-8802-0000000000f1','vera@a.test'),  ('00000000-0000-4000-8802-0000000000e1','sid@a.test'),
  ('00000000-0000-4000-8802-0000000000b1','bob@b.test');
insert into app.people (id, user_id, display_name, email)
select ('10000000' || substr(u.id::text, 9))::uuid, u.id, split_part(u.email, '@', 1), u.email
from auth.users u where u.id::text like '00000000-0000-4000-8802-%';
insert into app.workspaces (id, name) values
  ('20000000-0000-4000-8802-00000000000a','Workspace A'), ('20000000-0000-4000-8802-00000000000b','Workspace B');
insert into app.families (id, workspace_id, name) values
  ('30000000-0000-4000-8802-00000000000a','20000000-0000-4000-8802-00000000000a','Family A'),
  ('30000000-0000-4000-8802-0000000000a2','20000000-0000-4000-8802-00000000000a','Family A2'),
  ('30000000-0000-4000-8802-00000000000b','20000000-0000-4000-8802-00000000000b','Family B');
insert into app.memberships (workspace_id, person_id, role, scope_family_ids) values
  ('20000000-0000-4000-8802-00000000000a','10000000-0000-4000-8802-0000000000a1','admin',null),
  ('20000000-0000-4000-8802-00000000000a','10000000-0000-4000-8802-0000000000c1','editor',null),
  ('20000000-0000-4000-8802-00000000000a','10000000-0000-4000-8802-0000000000f1','viewer',null),
  ('20000000-0000-4000-8802-00000000000a','10000000-0000-4000-8802-0000000000e1','editor','{30000000-0000-4000-8802-0000000000a2}'),
  ('20000000-0000-4000-8802-00000000000b','10000000-0000-4000-8802-0000000000b1','admin',null);
insert into app.products (id, workspace_id, family_id, name) values
  ('40000000-0000-4000-8802-00000000000a','20000000-0000-4000-8802-00000000000a','30000000-0000-4000-8802-00000000000a','Salmon & Rice Adult'),
  ('40000000-0000-4000-8802-00000000000b','20000000-0000-4000-8802-00000000000b','30000000-0000-4000-8802-00000000000b','Product B');
-- A synthetic requirement so a document type is "encoded" inside this transaction only (rolled back).
insert into ref.document_requirements (node_id, doc_type) values ('EU-SE', 't802_test_spec');

create temp table t (name text primary key, v jsonb);
grant all on t to authenticated, service_role;
create function pg_temp.as_user(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true)
$$;
create function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true)
$$;
create function pg_temp.v(p_name text) returns jsonb language sql as $$ select v from t where name = p_name $$;
create function pg_temp.new_token() returns text language sql as $$
  select rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=')
$$;
-- What the worker's notify job does (H02 step 2): mint, store only the hash.
create function pg_temp.issue(p_request uuid) returns text language plpgsql as $$
declare v_token text := pg_temp.new_token();
begin
  update app.document_requests set token_hash = extensions.digest(v_token, 'sha256') where id = p_request;
  return v_token;
end $$;
grant execute on all functions in schema pg_temp to service_role, authenticated;

-- ─── Grants ───────────────────────────────────────────────────────────────────────────────────────────────────────
select ok(has_function_privilege('authenticated', 'app.request_document(uuid,text,text,uuid,text,text,uuid,text)', 'execute')
          and not has_function_privilege('anon', 'app.request_document(uuid,text,text,uuid,text,text,uuid,text)', 'execute'),
          '[T-802] request_document is executable by authenticated users and never by anon');
select ok(not has_function_privilege('authenticated', 'app.supplier_request_for_token(text)', 'execute')
          and not has_function_privilege('anon', 'app.supplier_request_for_token(text)', 'execute')
          and not has_function_privilege('authenticated', 'app.accept_supplier_upload(text,text,text)', 'execute')
          and not has_function_privilege('anon', 'app.accept_supplier_upload(text,text,text)', 'execute')
          and not has_function_privilege('authenticated', 'app.record_scan_result(uuid,text)', 'execute')
          and has_function_privilege('service_role', 'app.supplier_request_for_token(text)', 'execute')
          and has_function_privilege('service_role', 'app.accept_supplier_upload(text,text,text)', 'execute')
          and has_function_privilege('service_role', 'app.record_scan_result(uuid,text)', 'execute'),
          '[T-802] the link functions are executable by the service role only');
select ok(not has_table_privilege('authenticated', 'app.document_requests', 'insert')
          and not has_table_privilege('authenticated', 'app.document_requests', 'update')
          and not has_table_privilege('authenticated', 'app.suppliers', 'insert')
          and not has_table_privilege('authenticated', 'app.supplier_documents', 'insert')
          and not has_table_privilege('anon', 'app.document_requests', 'select'),
          '[T-802] no client writes suppliers, requests or documents, and anon reads none');
select is((select count(*)::int from information_schema.routines where routine_schema = 'public'
           and routine_name in ('request_document','supplier_request_for_token','accept_supplier_upload','record_scan_result')),
          0, '[T-802] nothing is added to the public schema');

-- ─── H02.main ─────────────────────────────────────────────────────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-4000-8802-0000000000c1');
set local role authenticated;
insert into t values ('req1', app.request_document('20000000-0000-4000-8802-00000000000a', '  Current premix specification  ',
  't802_test_spec', null, 'Aldrich Nutrition', '  Specs@Aldrich.TEST ', '40000000-0000-4000-8802-00000000000a', 'req-h02-main-0001'));
reset role;
select ok((select name = 'Aldrich Nutrition' and email = 'specs@aldrich.test' and workspace_id = '20000000-0000-4000-8802-00000000000a'
           from app.suppliers where id = (pg_temp.v('req1') ->> 'supplier_id')::uuid),
          '[H02.main] the supplier is created with a normalised address');
select ok((select title = 'Current premix specification' and doc_type = 't802_test_spec' and token_hash is null
                  and product_id = '40000000-0000-4000-8802-00000000000a' and consumed_at is null and fulfilled_at is null
                  and created_by = '10000000-0000-4000-8802-0000000000c1'
                  and expires_at between now() + interval '13 days 23 hours' and now() + interval '14 days 1 hour'
           from app.document_requests where id = (pg_temp.v('req1') ->> 'request_id')::uuid),
          '[H02.main] the request is stored open, with no token yet, expiring in 14 days');
select ok((select kind = 'notify' and status = 'queued' and idempotency_key = 'docreq:' || (pg_temp.v('req1') ->> 'request_id')
                  and payload = jsonb_build_object('template', 'supplier_request',
                                                   'document_request_id', pg_temp.v('req1') ->> 'request_id',
                                                   'request_id', 'req-h02-main-0001')
           from app.jobs where id = (pg_temp.v('req1') ->> 'job_id')::uuid),
          '[H02.main] one notify job carrying ids only queues the email');
select ok((select actor_id = '10000000-0000-4000-8802-0000000000c1' and after ->> 'recipient' = 'specs@aldrich.test'
                  and after ->> 'doc_type' = 't802_test_spec'
           from app.audit_events where kind = 'document.requested' and object_id = pg_temp.v('req1') ->> 'request_id'),
          '[H02.main] the request is audited');
select pg_temp.as_user('00000000-0000-4000-8802-0000000000a1');
set local role authenticated;
insert into t values ('req2', app.request_document('20000000-0000-4000-8802-00000000000a', 'Certificate of analysis',
  't802_test_spec', null, 'Another name', 'SPECS@aldrich.test'));
reset role;
select is(pg_temp.v('req2') ->> 'supplier_id', pg_temp.v('req1') ->> 'supplier_id',
          '[H02.main] a second request to the same address upserts the same supplier');
select is((select count(*)::int from app.suppliers where workspace_id = '20000000-0000-4000-8802-00000000000a'), 1,
          '[H02.main] and adds no second supplier');
select pg_temp.as_user('00000000-0000-4000-8802-0000000000c1');
set local role authenticated;
insert into t values ('req3', app.request_document('20000000-0000-4000-8802-00000000000a', 'Spec sheet', 't802_test_spec',
  (pg_temp.v('req1') ->> 'supplier_id')::uuid));
select throws_ok($$select app.request_document('20000000-0000-4000-8802-00000000000a', 'x', 'not_encoded', null, 'S', 's@s.test')$$,
                 '22023', null, '[H02.main] a document type that is not encoded is refused');
select throws_ok($$select app.request_document('20000000-0000-4000-8802-00000000000a', 'x', 't802_test_spec', null, 'S', 'not-an-email')$$,
                 '22023', null, '[H02.main] a supplier needs a valid address');
select throws_ok($$select app.request_document('20000000-0000-4000-8802-00000000000a', '', 't802_test_spec', null, 'S', 's@s.test')$$,
                 '22023', null, '[H02.main] a request says what it asks for');
reset role;
select ok(pg_temp.v('req3') ->> 'request_id' is not null, '[H02.main] an existing supplier can be asked again');

select pg_temp.as_user('00000000-0000-4000-8802-0000000000f1');
set local role authenticated;
select throws_ok($$select app.request_document('20000000-0000-4000-8802-00000000000a', 'x', 't802_test_spec', null, 'S', 's@s.test')$$,
                 '42501', null, '[H02.main] a viewer cannot request a document');
reset role;
select pg_temp.as_user('00000000-0000-4000-8802-0000000000e1');
set local role authenticated;
select throws_ok($$select app.request_document('20000000-0000-4000-8802-00000000000a', 'x', 't802_test_spec', null, 'S', 's@s.test',
                   '40000000-0000-4000-8802-00000000000a')$$,
                 '42501', null, '[H02.main] an editor outside the product''s scope cannot request for it');
reset role;
select pg_temp.as_user('00000000-0000-4000-8802-0000000000b1');
set local role authenticated;
select throws_ok($$select app.request_document('20000000-0000-4000-8802-00000000000a', 'x', 't802_test_spec', null, 'S', 's@s.test')$$,
                 '42501', null, '[H02.main] another workspace''s admin cannot request in this workspace');
select throws_ok($$select app.request_document('20000000-0000-4000-8802-00000000000b', 'x', 't802_test_spec',
                   (select (v ->> 'supplier_id')::uuid from t where name = 'req1'))$$,
                 '42501', null, '[H02.main] nor ask another workspace''s supplier');
select is((select count(*)::int from app.document_requests), 0, '[H02.main] another workspace reads no requests');
select is((select count(*)::int from app.suppliers), 0, '[H02.main] nor suppliers');
reset role;
select pg_temp.as_user('00000000-0000-4000-8802-0000000000f1');
set local role authenticated;
select is((select count(*)::int from app.document_requests), 3, '[H02.main] a member of the workspace reads its requests');
reset role;

-- ─── H02.must.1: the raw token is never stored ────────────────────────────────────────────────────────────────────
insert into t values ('tok1', to_jsonb(pg_temp.issue((pg_temp.v('req1') ->> 'request_id')::uuid)));
select ok((select token_hash = extensions.digest(pg_temp.v('tok1') #>> '{}', 'sha256') and octet_length(token_hash) = 32
           from app.document_requests where id = (pg_temp.v('req1') ->> 'request_id')::uuid),
          '[H02.must.1] only the SHA-256 of the token is stored');
select is((select count(*)::int from app.document_requests r
           where position(convert_to(pg_temp.v('tok1') #>> '{}', 'UTF8') in coalesce(r.token_hash, '')) > 0
              or r::text like '%' || (pg_temp.v('tok1') #>> '{}') || '%'), 0,
          '[H02.must.1] the raw token is in no request column');
select is((select count(*)::int from app.jobs j where j.payload::text like '%' || (pg_temp.v('tok1') #>> '{}') || '%'), 0,
          '[H02.must.1] nor in any job payload');
select is((select count(*)::int from app.audit_events a where a::text like '%' || (pg_temp.v('tok1') #>> '{}') || '%'), 0,
          '[H02.must.1] nor in the audit trail');
select throws_ok(format($$update app.document_requests set token_hash = null where id = %L$$, pg_temp.v('req1') ->> 'request_id'),
                 '23514', null, '[H02.must.1] a link cannot be cleared');
select throws_ok(format($$update app.document_requests set doc_type = 'other' where id = %L$$, pg_temp.v('req1') ->> 'request_id'),
                 '23514', null, '[H02.must.1] a request''s scope never changes');
select throws_ok($$insert into app.document_requests (workspace_id, supplier_id, doc_type)
                   values ('20000000-0000-4000-8802-00000000000b', (select (v ->> 'supplier_id')::uuid from t where name = 'req1'), 'x')$$,
                 '23514', null, '[H02.must.1] a request names a supplier of its own workspace');

-- ─── H03.main: describe, upload to quarantine, scan, promote as a new row ─────────────────────────────────────────
select pg_temp.as_service();
set local role service_role;
insert into t values ('open1', app.supplier_request_for_token(pg_temp.v('tok1') #>> '{}'));
reset role;
select ok(pg_temp.v('open1') ->> 'status' = 'open' and pg_temp.v('open1') ->> 'workspace_name' = 'Workspace A'
          and pg_temp.v('open1') ->> 'supplier_name' = 'Aldrich Nutrition'
          and pg_temp.v('open1') ->> 'title' = 'Current premix specification'
          and pg_temp.v('open1') ->> 'request_id' = pg_temp.v('req1') ->> 'request_id',
          '[H03.main] an open link describes its one request');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.v('open1')) k),
          array['expires_at','request_id','status','supplier_name','title','workspace_id','workspace_name'],
          '[H03.main] and nothing else from the workspace');
insert into t values ('path1', to_jsonb('20000000-0000-4000-8802-00000000000a/' || (pg_temp.v('req1') ->> 'request_id') || '/premix-spec.pdf'));
set local role service_role;
insert into t values ('up1', app.accept_supplier_upload(pg_temp.v('tok1') #>> '{}', pg_temp.v('path1') #>> '{}', repeat('ab', 32)));
reset role;
select ok(pg_temp.v('up1') ->> 'status' = 'accepted', '[H03.main] the upload is accepted');
select ok((select workspace_id = '20000000-0000-4000-8802-00000000000a' and supplier_id = (pg_temp.v('req1') ->> 'supplier_id')::uuid
                  and product_id = '40000000-0000-4000-8802-00000000000a' and doc_type = 't802_test_spec'
                  and storage_path = 'quarantine/' || (pg_temp.v('path1') #>> '{}') and scan_status = 'quarantine'
                  and uploaded_via = 'supplier_link' and file_sha256 = repeat('ab', 32)
                  and request_id = (pg_temp.v('req1') ->> 'request_id')::uuid and promoted_from is null
           from app.supplier_documents where id = (pg_temp.v('up1') ->> 'document_id')::uuid),
          '[H03.main] the file lands in quarantine, scoped to the request''s workspace, supplier, product and type');
select ok((select kind = 'scan' and idempotency_key = 'scan:' || (pg_temp.v('up1') ->> 'document_id')
                  and payload = jsonb_build_object('document_id', pg_temp.v('up1') ->> 'document_id')
           from app.jobs where idempotency_key = 'scan:' || (pg_temp.v('up1') ->> 'document_id')),
          '[H03.main] one scan job carrying the document id only');
select ok((select actor_id is null and after ->> 'via' = 'supplier_link'
           from app.audit_events where kind = 'document.uploaded' and object_id = pg_temp.v('up1') ->> 'document_id'),
          '[H03.main] the upload is audited with no member as actor');
set local role service_role;
insert into t values ('scan1', app.record_scan_result((pg_temp.v('up1') ->> 'document_id')::uuid, 'clean'));
reset role;
select ok((select scan_status = 'clean' and promoted_from = (pg_temp.v('up1') ->> 'document_id')::uuid
                  and storage_path = pg_temp.v('path1') #>> '{}' and file_sha256 = repeat('ab', 32)
           from app.supplier_documents where id = (pg_temp.v('scan1') ->> 'document_id')::uuid),
          '[H03.main] a clean scan promotes the file as a new row in the documents bucket');
select ok((select scan_status = 'quarantine' from app.supplier_documents where id = (pg_temp.v('up1') ->> 'document_id')::uuid),
          '[H03.main] the quarantine row stays as history');
select ok((select fulfilled_at is not null and consumed_at is not null and document_id = (pg_temp.v('scan1') ->> 'document_id')::uuid
           from app.document_requests where id = (pg_temp.v('req1') ->> 'request_id')::uuid),
          '[H03.main] the request is marked fulfilled by the promoted document');
set local role service_role;
insert into t values ('scan1b', app.record_scan_result((pg_temp.v('up1') ->> 'document_id')::uuid, 'clean'));
reset role;
select ok(pg_temp.v('scan1b') ->> 'status' = 'already' and pg_temp.v('scan1b') ->> 'document_id' = pg_temp.v('scan1') ->> 'document_id',
          '[H03.main] recording the scan again is idempotent');
select throws_ok(format($$update app.supplier_documents set scan_status = 'clean' where id = %L$$, pg_temp.v('up1') ->> 'document_id'),
                 null, null, '[H03.main] supplier documents stay insert-only');
select pg_temp.as_user('00000000-0000-4000-8802-0000000000f1');
set local role authenticated;
select ok(private.can_read_object('documents', pg_temp.v('path1') #>> '{}'),
          '[H03.main] a member reads the promoted object through its row');
reset role;
select pg_temp.as_user('00000000-0000-4000-8802-0000000000b1');
set local role authenticated;
select ok(not private.can_read_object('documents', pg_temp.v('path1') #>> '{}')
          and (select count(*) from app.supplier_documents) = 0,
          '[H03.main] another workspace reads neither the object nor the rows');
reset role;

-- ─── H03.must.1: one request and nothing else; single use ─────────────────────────────────────────────────────────
select pg_temp.as_service();
set local role service_role;
select is(app.accept_supplier_upload(pg_temp.v('tok1') #>> '{}', pg_temp.v('path1') #>> '{}', repeat('cd', 32)),
          '{"status":"unknown"}'::jsonb, '[H03.must.1] a used link uploads nothing more');
select is(app.supplier_request_for_token(pg_temp.v('tok1') #>> '{}'), '{"status":"unknown"}'::jsonb,
          '[H03.must.1] and describes nothing more');
reset role;
select is((select count(*)::int from app.supplier_documents where request_id = (pg_temp.v('req1') ->> 'request_id')::uuid
           and promoted_from is null), 1, '[H03.must.1] one upload per request');
select throws_ok(format($$update app.document_requests set token_hash = extensions.digest('x', 'sha256') where id = %L$$,
                        pg_temp.v('req1') ->> 'request_id'),
                 '23514', null, '[H03.must.1] a used link can never be re-issued');

insert into t values ('tok2', to_jsonb(pg_temp.issue((pg_temp.v('req2') ->> 'request_id')::uuid)));
insert into t values ('tok3', to_jsonb(pg_temp.issue((pg_temp.v('req3') ->> 'request_id')::uuid)));
set local role service_role;
select throws_ok(format($$select app.accept_supplier_upload(%L, %L, %L)$$, pg_temp.v('tok2') #>> '{}',
                        '20000000-0000-4000-8802-00000000000a/' || (pg_temp.v('req3') ->> 'request_id') || '/x.pdf', repeat('ab', 32)),
                 '22023', null, '[H03.must.1] a link cannot store into another request''s folder');
select throws_ok(format($$select app.accept_supplier_upload(%L, %L, %L)$$, pg_temp.v('tok2') #>> '{}',
                        '20000000-0000-4000-8802-00000000000b/' || (pg_temp.v('req2') ->> 'request_id') || '/x.pdf', repeat('ab', 32)),
                 '22023', null, '[H03.must.1] nor into another workspace');
select throws_ok(format($$select app.accept_supplier_upload(%L, %L, %L)$$, pg_temp.v('tok2') #>> '{}',
                        '20000000-0000-4000-8802-00000000000a/' || (pg_temp.v('req2') ->> 'request_id') || '/../x.pdf', repeat('ab', 32)),
                 '22023', null, '[H03.must.1] nor outside its folder');
reset role;
select ok((select consumed_at is null from app.document_requests where id = (pg_temp.v('req2') ->> 'request_id')::uuid),
          '[H03.must.1] a refused upload does not use the link');

-- A rejected scan: a new rejected row, the request stays used and unfulfilled.
set local role service_role;
insert into t values ('up3', app.accept_supplier_upload(pg_temp.v('tok3') #>> '{}',
  '20000000-0000-4000-8802-00000000000a/' || (pg_temp.v('req3') ->> 'request_id') || '/spec.pdf', repeat('ef', 32)));
insert into t values ('scan3', app.record_scan_result((pg_temp.v('up3') ->> 'document_id')::uuid, 'rejected'));
reset role;
select ok((select scan_status = 'rejected' and storage_path like 'quarantine/%'
           from app.supplier_documents where id = (pg_temp.v('scan3') ->> 'document_id')::uuid)
          and (select consumed_at is not null and fulfilled_at is null and document_id is null
               from app.document_requests where id = (pg_temp.v('req3') ->> 'request_id')::uuid),
          '[H03.must.1] an infected file is recorded rejected, never promoted, and the link stays used');

-- ─── H03.fail.1: expired, used, unknown or malformed: the same generic answer ─────────────────────────────────────
insert into t values ('tok4', to_jsonb(pg_temp.new_token()));
insert into app.document_requests (workspace_id, supplier_id, doc_type, title, token_hash, expires_at, created_at)
values ('20000000-0000-4000-8802-00000000000a', (pg_temp.v('req1') ->> 'supplier_id')::uuid, 't802_test_spec', 'Old',
        extensions.digest(pg_temp.v('tok4') #>> '{}', 'sha256'), now() - interval '1 day', now() - interval '15 days');
set local role service_role;
select is(app.supplier_request_for_token(pg_temp.v('tok4') #>> '{}'), '{"status":"unknown"}'::jsonb,
          '[H03.fail.1] an expired link answers unknown');
select is(app.accept_supplier_upload(pg_temp.v('tok4') #>> '{}', '20000000-0000-4000-8802-00000000000a/x/y.pdf', repeat('ab', 32)),
          '{"status":"unknown"}'::jsonb, '[H03.fail.1] and accepts nothing');
select is(app.supplier_request_for_token(pg_temp.new_token()), '{"status":"unknown"}'::jsonb,
          '[H03.fail.1] an unknown link answers the same');
select is(app.supplier_request_for_token('short'), '{"status":"unknown"}'::jsonb,
          '[H03.fail.1] a malformed link answers the same');
select is(app.supplier_request_for_token(null), '{"status":"unknown"}'::jsonb,
          '[H03.fail.1] no link answers the same');
reset role;
select throws_ok(format($$update app.document_requests set token_hash = extensions.digest('x', 'sha256') where title = 'Old'$$),
                 '23514', null, '[H03.fail.1] an expired link can never be re-issued');

select * from finish();
rollback;
