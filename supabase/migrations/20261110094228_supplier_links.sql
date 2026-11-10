-- T-802 · H02 "Request a document from a supplier" and H03 "Supplier uploads through a link".
-- Additive (expand only). The founder decisions are recorded on #69: promotion is a NEW ROW (the quarantine row stays
-- as history; app.supplier_documents stays insert-only), and this database work is part of T-802 (scope-approved).
-- The conservative choices for what the spec leaves open are listed on #69 and in the PR.
--
-- app.request_document(p_ws, p_title, p_doc_type, p_supplier, p_supplier_name, p_supplier_email, p_product, p_request_id)
--   An editor of the product (private.can_edit_product), or for a workspace document an admin, portfolio manager or
--   editor of the workspace (42501 otherwise, a missing product or supplier too). Upserts the supplier by email within
--   the workspace, inserts the request with NO token (expires in 14 days) and queues the notify job
--   {template:'supplier_request', document_request_id, request_id?} keyed docreq:<id>, whose worker mints the token, stores only its SHA-256
--   and emails the link (H02 step 2, H02.must.1). doc_type must be one encoded in ref.document_requirements (22023).
--   Audited document.requested. Returns {request_id, supplier_id, expires_at, job_id}.
-- app.supplier_request_for_token(p_token)        service role only (the supplier-upload Edge Function)
--   An open request (token matches, not consumed, not fulfilled, not expired) answers what the supplier may see:
--   {status:'open', request_id, workspace_id, workspace_name, supplier_name, title, expires_at}. Anything else, a
--   malformed token included, answers exactly {status:'unknown'} (H03.fail.1).
-- app.accept_supplier_upload(p_token, p_path, p_sha256)    service role only
--   Holds the request row, checks it is still open, consumes it (consumed_at; single use, H03.must.1), inserts the
--   quarantine row of app.supplier_documents for exactly that request's workspace, supplier, product and doc_type, and
--   queues the scan job {document_id} keyed scan:<id>. The object must be <workspace>/<request>/<file> in the
--   quarantine bucket (22023 otherwise). A request that is no longer open answers {status:'unknown'}.
-- app.record_scan_result(p_document, p_outcome)  service role only (the worker's scan handler)
--   'clean' inserts the promoted row (scan_status clean, storage_path the same object name in the documents bucket,
--   promoted_from the quarantine row) and marks the request fulfilled; 'rejected' inserts a rejected row and leaves the
--   request consumed and unfulfilled. Idempotent: a second call returns the first result.
--
-- private.document_request_guard: a request's scope never changes; consumed_at, fulfilled_at and document_id are set
-- once, from null; token_hash may be set or replaced only while the request is open, so a used, fulfilled or expired
-- link can never be revived. A retried notify job re-mints (as invitations do), which replaces an undelivered token.

-- ─── Columns (expand) ─────────────────────────────────────────────────────────────────────────────────────────────
alter table app.document_requests
  add column title       text check (title is null or (length(title) between 1 and 200 and title !~ '[[:cntrl:]]')),
  add column consumed_at timestamptz,
  add column document_id uuid references app.supplier_documents(id);
comment on column app.document_requests.title is 'H02: what the editor asks for, in their words; printed in the email and on the portal';
comment on column app.document_requests.consumed_at is 'H03.must.1: the upload that used the link (single use); set once';
comment on column app.document_requests.document_id is 'H03: the promoted (clean) document that fulfilled the request';

alter table app.supplier_documents
  add column request_id    uuid references app.document_requests(id),
  add column promoted_from uuid references app.supplier_documents(id);
comment on column app.supplier_documents.request_id is 'H03: the document request a supplier upload answered';
comment on column app.supplier_documents.promoted_from is 'H03: the quarantine row this scan result supersedes (a new row; insert-only)';

create unique index supplier_documents_one_upload_per_request on app.supplier_documents(request_id)
  where request_id is not null and promoted_from is null;
create unique index supplier_documents_one_result on app.supplier_documents(promoted_from)
  where promoted_from is not null;
create index document_requests_supplier on app.document_requests(supplier_id);
create index suppliers_workspace_email on app.suppliers(workspace_id, email);

-- ─── Job kind 'scan' (expand) ─────────────────────────────────────────────────────────────────────────────────────
alter table app.jobs drop constraint jobs_kind_check;
alter table app.jobs add constraint jobs_kind_check
  check (kind in ('extract','check','recheck','bulk_recheck','report','export','notify','session_revoke','diff_fanout',
                  'billing_sync','billing_reconcile','recipe_overage','dunning','scan')) not valid;
alter table app.jobs validate constraint jobs_kind_check;

do $$
begin
  if to_regnamespace('pgmq') is not null then
    perform pgmq.create('scan');
  end if;
  -- Defence in depth for H03 step 1: the bucket refuses what the Edge Function refuses (25 MiB; PDF, DOCX, XLSX).
  if to_regclass('storage.buckets') is not null then
    update storage.buckets set file_size_limit = 26214400,
      allowed_mime_types = array['application/pdf',
                                 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                                 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
    where id = 'quarantine';
  end if;
end $$;

-- ─── Guard ────────────────────────────────────────────────────────────────────────────────────────────────────────
create function private.document_request_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.consumed_at is not null or new.fulfilled_at is not null or new.document_id is not null then
      raise exception 'a new document request is open' using errcode = '23514';
    end if;
    if not exists (select 1 from app.suppliers s where s.id = new.supplier_id and s.workspace_id = new.workspace_id)
       or (new.product_id is not null
           and not exists (select 1 from app.products p where p.id = new.product_id and p.workspace_id = new.workspace_id)) then
      raise exception 'a document request names a supplier and product of its own workspace' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id or new.workspace_id is distinct from old.workspace_id
     or new.supplier_id is distinct from old.supplier_id or new.product_id is distinct from old.product_id
     or new.doc_type is distinct from old.doc_type or new.title is distinct from old.title
     or new.expires_at is distinct from old.expires_at or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'a document request''s scope never changes' using errcode = '23514';
  end if;
  if (old.consumed_at is not null and new.consumed_at is distinct from old.consumed_at)
     or (old.fulfilled_at is not null and new.fulfilled_at is distinct from old.fulfilled_at)
     or (old.document_id is not null and new.document_id is distinct from old.document_id) then
    raise exception 'a used or fulfilled document request stays so' using errcode = '23514';
  end if;
  if old.fulfilled_at is null and new.fulfilled_at is not null
     and (new.consumed_at is null or new.document_id is null) then
    raise exception 'a request is fulfilled by the document its upload became' using errcode = '23514';
  end if;
  if new.token_hash is distinct from old.token_hash
     and (new.token_hash is null or old.consumed_at is not null or old.fulfilled_at is not null
          or old.expires_at <= now()) then
    raise exception 'a link is issued only while its request is open' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.document_request_guard() from public, anon, authenticated;
create trigger document_requests_guard before insert or update on app.document_requests
  for each row execute function private.document_request_guard();

-- ─── H02: the editor's request ────────────────────────────────────────────────────────────────────────────────────
create function app.request_document(p_ws uuid, p_title text, p_doc_type text, p_supplier uuid default null,
                                     p_supplier_name text default null, p_supplier_email text default null,
                                     p_product uuid default null, p_request_id text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_supplier app.suppliers; v_email text; v_name text; v_title text; v_id uuid := gen_random_uuid();
        v_expires timestamptz; v_job uuid; v_rid text;
begin
  if private.person_id() is null
     or (p_product is null and not private.has_role(p_ws, '{admin,portfolio_manager,editor}'))
     or (p_product is not null and not exists (select 1 from app.products p
                                               where p.id = p_product and p.workspace_id = p_ws
                                                 and private.can_edit_product(p.id))) then
    raise exception 'only an editor can request a document' using errcode = '42501';
  end if;

  v_title := btrim(p_title);
  if v_title is null or length(v_title) not between 1 and 200 or v_title ~ '[[:cntrl:]]' then
    raise exception 'a request says what it asks for in 1 to 200 characters' using errcode = '22023';
  end if;
  if p_doc_type is null or not exists (select 1 from ref.document_requirements r where r.doc_type = p_doc_type) then
    raise exception 'a request names a document type that is encoded' using errcode = '22023';
  end if;

  v_email := lower(btrim(p_supplier_email));
  if v_email is not null and (length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'a supplier needs one valid email address' using errcode = '22023';
  end if;

  if p_supplier is not null then
    select s.* into v_supplier from app.suppliers s where s.id = p_supplier and s.workspace_id = p_ws for update;
    if not found then
      raise exception 'only an editor can request a document' using errcode = '42501';
    end if;
    if v_supplier.email is null then
      if v_email is null then
        raise exception 'a supplier needs one valid email address' using errcode = '22023';
      end if;
      update app.suppliers set email = v_email where id = v_supplier.id returning * into v_supplier;
    end if;
  else
    v_name := btrim(p_supplier_name);
    if v_name is null or length(v_name) not between 1 and 200 or v_name ~ '[[:cntrl:]]' then
      raise exception 'a supplier needs a name of 1 to 200 characters' using errcode = '22023';
    end if;
    if v_email is null then
      raise exception 'a supplier needs one valid email address' using errcode = '22023';
    end if;
    select s.* into v_supplier from app.suppliers s
    where s.workspace_id = p_ws and s.email = v_email::extensions.citext order by s.created_at limit 1;
    if not found then
      insert into app.suppliers (workspace_id, name, email) values (p_ws, v_name, v_email) returning * into v_supplier;
    end if;
  end if;

  insert into app.document_requests (id, workspace_id, supplier_id, product_id, doc_type, title, created_by)
  values (v_id, p_ws, v_supplier.id, p_product, p_doc_type, v_title, private.person_id())
  returning expires_at into v_expires;

  v_rid := case when p_request_id ~ '^[A-Za-z0-9-]{8,64}$' then p_request_id end;
  v_job := private.enqueue('notify', p_ws, 'docreq:' || v_id::text,
                           jsonb_build_object('template', 'supplier_request', 'document_request_id', v_id)
                             || case when v_rid is null then '{}'::jsonb else jsonb_build_object('request_id', v_rid) end);

  perform private.write_audit(p_ws, 'document.requested', 'document_request', v_id::text, null,
                              jsonb_build_object('supplier_id', v_supplier.id, 'recipient', v_supplier.email::text,
                                                 'product_id', p_product, 'doc_type', p_doc_type, 'title', v_title,
                                                 'expires_at', v_expires));
  return jsonb_build_object('request_id', v_id, 'supplier_id', v_supplier.id, 'expires_at', v_expires, 'job_id', v_job);
end $$;

-- ─── H03: the supplier's link ─────────────────────────────────────────────────────────────────────────────────────
create function private.is_service_caller() returns boolean
language sql stable set search_path = '' as $$
  select auth.role() = 'service_role'
         or (auth.role() is null and session_user not in ('authenticator', 'anon', 'authenticated'))
$$;

create function private.supplier_token_hash(p_token text) returns bytea
language sql immutable set search_path = '' as $$
  select case when p_token ~ '^[A-Za-z0-9_-]{43}$' then extensions.digest(p_token, 'sha256') end
$$;

create function app.supplier_request_for_token(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_r app.document_requests; v_hash bytea := private.supplier_token_hash(p_token);
        v_ws text; v_supplier text;
begin
  if not private.is_service_caller() then
    raise exception 'a supplier link is read by the upload function only' using errcode = '42501';
  end if;
  if v_hash is null then
    return jsonb_build_object('status', 'unknown');
  end if;
  select r.* into v_r from app.document_requests r where r.token_hash = v_hash;
  if not found or v_r.consumed_at is not null or v_r.fulfilled_at is not null or v_r.expires_at <= now() then
    return jsonb_build_object('status', 'unknown');
  end if;
  select w.name into v_ws from app.workspaces w where w.id = v_r.workspace_id;
  select s.name into v_supplier from app.suppliers s where s.id = v_r.supplier_id and s.workspace_id = v_r.workspace_id;
  return jsonb_build_object('status', 'open', 'request_id', v_r.id, 'workspace_id', v_r.workspace_id,
                            'workspace_name', v_ws, 'supplier_name', v_supplier, 'title', v_r.title,
                            'expires_at', v_r.expires_at);
end $$;

create function app.accept_supplier_upload(p_token text, p_path text, p_sha256 text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_r app.document_requests; v_hash bytea := private.supplier_token_hash(p_token); v_doc uuid; v_parts text[];
begin
  if not private.is_service_caller() then
    raise exception 'a supplier upload is accepted by the upload function only' using errcode = '42501';
  end if;
  if v_hash is null then
    return jsonb_build_object('status', 'unknown');
  end if;
  select r.* into v_r from app.document_requests r where r.token_hash = v_hash for update;
  if not found or v_r.consumed_at is not null or v_r.fulfilled_at is not null or v_r.expires_at <= now() then
    return jsonb_build_object('status', 'unknown');
  end if;

  v_parts := string_to_array(p_path, '/');
  if p_path is null or cardinality(v_parts) <> 3 or v_parts[1] <> v_r.workspace_id::text or v_parts[2] <> v_r.id::text
     or v_parts[3] !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$' or v_parts[3] ~ '\.\.' then
    raise exception 'an upload is stored as <workspace>/<request>/<file> in quarantine' using errcode = '22023';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'an upload carries its SHA-256 in hex' using errcode = '22023';
  end if;

  update app.document_requests set consumed_at = now() where id = v_r.id;
  insert into app.supplier_documents (workspace_id, supplier_id, product_id, doc_type, storage_path, file_sha256,
                                      uploaded_via, scan_status, request_id)
  values (v_r.workspace_id, v_r.supplier_id, v_r.product_id, v_r.doc_type, 'quarantine/' || p_path, p_sha256,
          'supplier_link', 'quarantine', v_r.id)
  returning id into v_doc;
  perform private.enqueue('scan', v_r.workspace_id, 'scan:' || v_doc::text, jsonb_build_object('document_id', v_doc));
  perform private.write_audit(v_r.workspace_id, 'document.uploaded', 'supplier_document', v_doc::text, null,
                              jsonb_build_object('request_id', v_r.id, 'supplier_id', v_r.supplier_id,
                                                 'doc_type', v_r.doc_type, 'sha256', p_sha256, 'via', 'supplier_link'));
  return jsonb_build_object('status', 'accepted', 'document_id', v_doc);
end $$;

create function app.record_scan_result(p_document uuid, p_outcome text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_q app.supplier_documents; v_prev app.supplier_documents; v_new uuid;
begin
  if not private.is_service_caller() then
    raise exception 'a scan result is recorded by the worker only' using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome not in ('clean', 'rejected') then
    raise exception 'a scan is clean or rejected' using errcode = '22023';
  end if;
  select d.* into v_q from app.supplier_documents d
  where d.id = p_document and d.scan_status = 'quarantine' and d.uploaded_via = 'supplier_link'
    and d.request_id is not null and d.promoted_from is null and d.storage_path like 'quarantine/%';
  if not found then
    raise exception 'no quarantined supplier upload %', p_document using errcode = '22023';
  end if;
  perform 1 from app.document_requests r where r.id = v_q.request_id for update;

  select d.* into v_prev from app.supplier_documents d where d.promoted_from = v_q.id;
  if found then
    return jsonb_build_object('status', 'already', 'document_id', v_prev.id, 'scan_status', v_prev.scan_status);
  end if;

  insert into app.supplier_documents (workspace_id, supplier_id, product_id, doc_type, storage_path, file_sha256,
                                      valid_from, valid_to, uploaded_via, scan_status, request_id, promoted_from)
  values (v_q.workspace_id, v_q.supplier_id, v_q.product_id, v_q.doc_type,
          case when p_outcome = 'clean' then substr(v_q.storage_path, length('quarantine/') + 1) else v_q.storage_path end,
          v_q.file_sha256, v_q.valid_from, v_q.valid_to, 'supplier_link', p_outcome, v_q.request_id, v_q.id)
  returning id into v_new;

  if p_outcome = 'clean' then
    update app.document_requests set fulfilled_at = now(), document_id = v_new where id = v_q.request_id;
  end if;
  perform private.write_audit(v_q.workspace_id,
                              case when p_outcome = 'clean' then 'document.promoted' else 'document.rejected' end,
                              'supplier_document', v_new::text, jsonb_build_object('document_id', v_q.id),
                              jsonb_build_object('request_id', v_q.request_id, 'scan_status', p_outcome));
  return jsonb_build_object('status', 'recorded', 'document_id', v_new, 'scan_status', p_outcome);
end $$;

-- ─── Grants ───────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function private.is_service_caller(), private.supplier_token_hash(text) from public, anon, authenticated;
grant execute on function private.is_service_caller(), private.supplier_token_hash(text) to service_role;
revoke all on function app.request_document(uuid, text, text, uuid, text, text, uuid, text) from public, anon;
grant execute on function app.request_document(uuid, text, text, uuid, text, text, uuid, text) to authenticated;
revoke all on function app.supplier_request_for_token(text), app.accept_supplier_upload(text, text, text),
  app.record_scan_result(uuid, text) from public, anon, authenticated;
grant execute on function app.supplier_request_for_token(text), app.accept_supplier_upload(text, text, text),
  app.record_scan_result(uuid, text) to service_role;
