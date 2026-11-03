-- T-601 · I02 "Share a report" (BE-27): share links that are unguessable, revocable, optionally expiring and access-logged.
-- Additive: three RPCs and a narrower read policy on app.shares. Open questions are on #58; each choice below is the
-- conservative option named there.
--
-- app.create_share(p_report, p_channel, p_recipient, p_expires_in_days, p_request_id)
--   An editor-class member of the report's product (private.can_edit_product; 42501 otherwise, a missing report too).
--   'link': 32 random bytes made here, returned once as URL-safe base64 (43 characters) and stored only as SHA-256
--   (#58 Q2). 'email': a random placeholder hash (its preimage is discarded, so nothing can open it) and a notify job
--   {template:'report', share_id, request_id?}, key share:<id>, whose worker mints the emailed token (docs/04).
--   Expiry: null for none, else 1 to 365 days (22023). Audited share.created. Never gated by plan or dunning (#58 Q4).
-- app.revoke_share(p_share)
--   Editor-class on the product, or an admin or portfolio manager of the workspace. Idempotent: an already revoked
--   share keeps its first revoked_at. Holds the row, so a concurrent notify job cannot store a token after the revoke
--   (the worker's update requires revoked_at is null). Audited share.revoked.
-- app.open_share(p_token, p_user_agent)
--   Service role only: the web server's share page calls it (#58 Q1). An unknown, malformed, revoked or expired token
--   gets exactly {"status":"unknown"} ("Revoked links: SHOW AS UNKNOWN", U09). A live one inserts an
--   app.share_access_log row (insert-only; user agent cut to 256 characters, ip_hash left null, #58 Q5) and returns
--   the report's face facts and its stored PDF path, never anything else from the workspace.
--
-- BE-27 / non-negotiable 9: nothing here reads or changes public.verify_reference or app.reports; a revoked or expired
-- share stops the share page only, and the report's reference keeps verifying.
--
-- Read policy: app.shares was readable by every member (read_member). A share names a report and, for email, a
-- recipient address, so it is now readable only where the member can see the report's product (scoped members no
-- longer see shares of products outside their scope). product_id is denormalised onto the row (from its report) so the
-- policy stays single-table (.claude/rules/database.md); existing rows are backfilled before it becomes not null.

alter table app.shares add column product_id uuid references app.products(id);
update app.shares s set product_id = r.product_id from app.reports r where r.id = s.report_id and s.product_id is null;
alter table app.shares alter column product_id set not null;
-- Expand: a writer that does not name product_id (the worker's tests, older code) gets its report's. A product_id
-- that disagrees with the report, or a report of another workspace, is refused.
create function private.share_product() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_product uuid; v_ws uuid;
begin
  select r.product_id, r.workspace_id into v_product, v_ws from app.reports r where r.id = new.report_id;
  if v_ws is distinct from new.workspace_id then
    raise exception 'a share belongs to its report''s workspace' using errcode = '23514';
  end if;
  if new.product_id is null then
    new.product_id := v_product;
  elsif new.product_id is distinct from v_product then
    raise exception 'a share''s product is its report''s product' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.share_product() from public, anon, authenticated;
create trigger shares_product before insert or update of product_id, report_id, workspace_id on app.shares
  for each row execute function private.share_product();

create function private.share_token_hash(p_token text) returns bytea
language sql immutable set search_path = '' as $$
  select extensions.digest(p_token, 'sha256')
$$;

create function app.create_share(p_report uuid, p_channel text, p_recipient text default null,
                                 p_expires_in_days int default 30, p_request_id text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_r app.reports; v_id uuid := gen_random_uuid(); v_token text; v_hash bytea; v_recipient text;
        v_expires timestamptz; v_job uuid; v_rid text;
begin
  select * into v_r from app.reports r where r.id = p_report;
  if not found or not private.can_edit_product(v_r.product_id) or private.person_id() is null then
    raise exception 'only an editor of this product can share its report' using errcode = '42501';
  end if;
  if p_channel is null or p_channel not in ('link','email') then
    raise exception 'a share is a link or an email' using errcode = '22023';
  end if;
  if p_expires_in_days is not null and p_expires_in_days not between 1 and 365 then
    raise exception 'a share expires after 1 to 365 days, or never' using errcode = '22023';
  end if;
  v_expires := case when p_expires_in_days is null then null else now() + make_interval(days => p_expires_in_days) end;

  if p_channel = 'email' then
    v_recipient := lower(btrim(p_recipient));
    if v_recipient is null or length(v_recipient) > 254 or v_recipient !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      raise exception 'an email share needs one valid address' using errcode = '22023';
    end if;
    v_hash := extensions.digest(extensions.gen_random_bytes(32), 'sha256');
  else
    if p_recipient is not null then
      raise exception 'a link share has no recipient' using errcode = '22023';
    end if;
    v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
    v_hash := private.share_token_hash(v_token);
  end if;

  insert into app.shares (id, workspace_id, product_id, report_id, token_hash, channel, recipient, expires_at, created_by)
  values (v_id, v_r.workspace_id, v_r.product_id, v_r.id, v_hash, p_channel, v_recipient, v_expires, private.person_id());

  if p_channel = 'email' then
    v_rid := case when p_request_id ~ '^[A-Za-z0-9-]{8,64}$' then p_request_id end;
    v_job := private.enqueue('notify', v_r.workspace_id, 'share:' || v_id::text,
                             jsonb_build_object('template', 'report', 'share_id', v_id)
                               || case when v_rid is null then '{}'::jsonb else jsonb_build_object('request_id', v_rid) end);
  end if;

  perform private.write_audit(v_r.workspace_id, 'share.created', 'share', v_id::text, null,
                              jsonb_build_object('report_id', v_r.id, 'ref', v_r.ref, 'channel', p_channel,
                                                 'recipient', v_recipient, 'expires_at', v_expires),
                              v_r.ruleset_version);
  return jsonb_build_object('share_id', v_id, 'channel', p_channel, 'token', v_token, 'expires_at', v_expires,
                            'job_id', v_job);
end $$;

create function app.revoke_share(p_share uuid) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v_s app.shares;
begin
  select s.* into v_s from app.shares s where s.id = p_share for update;
  if not found or private.person_id() is null
     or not (private.can_edit_product(v_s.product_id)
             or private.has_role(v_s.workspace_id, '{admin,portfolio_manager}')) then
    raise exception 'only an editor of this product or a workspace manager can revoke its share' using errcode = '42501';
  end if;
  if v_s.revoked_at is not null then
    return v_s.revoked_at;
  end if;
  update app.shares set revoked_at = now() where id = v_s.id;
  perform private.write_audit(v_s.workspace_id, 'share.revoked', 'share', v_s.id::text,
                              jsonb_build_object('report_id', v_s.report_id, 'channel', v_s.channel,
                                                 'recipient', v_s.recipient, 'expires_at', v_s.expires_at),
                              jsonb_build_object('revoked_at', now()));
  return now();
end $$;

create function app.open_share(p_token text, p_user_agent text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_s app.shares; v_r app.reports; v_product text; v_ws text;
begin
  if not (auth.role() = 'service_role'
          or (auth.role() is null and session_user not in ('authenticator', 'anon', 'authenticated'))) then
    raise exception 'a share is opened by the web server only' using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return jsonb_build_object('status', 'unknown');
  end if;
  select s.* into v_s from app.shares s where s.token_hash = private.share_token_hash(p_token);
  if not found or v_s.revoked_at is not null or (v_s.expires_at is not null and v_s.expires_at <= now()) then
    return jsonb_build_object('status', 'unknown');
  end if;
  select r.* into v_r from app.reports r where r.id = v_s.report_id and r.workspace_id = v_s.workspace_id;
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  select p.name into v_product from app.products p where p.id = v_r.product_id;
  select w.name into v_ws from app.workspaces w where w.id = v_s.workspace_id;

  insert into app.share_access_log (workspace_id, share_id, user_agent)
  values (v_s.workspace_id, v_s.id, nullif(left(btrim(p_user_agent), 256), ''));

  return jsonb_build_object(
    'status', 'open',
    'share_id', v_s.id,
    'expires_at', v_s.expires_at,
    'workspace_name', v_ws,
    'product_name', v_product,
    'node_id', v_r.node_id,
    'ref', v_r.ref,
    'issued_at', v_r.created_at,
    'ruleset_version', v_r.ruleset_version,
    'artwork_sha', v_r.artwork_sha,
    'has_not_assessed', v_r.has_not_assessed,
    'pdf_path', v_r.pdf_path);
end $$;

revoke all on function private.share_token_hash(text) from public, anon;
grant execute on function private.share_token_hash(text) to authenticated, service_role;
revoke all on function app.create_share(uuid, text, text, int, text), app.revoke_share(uuid) from public, anon;
grant execute on function app.create_share(uuid, text, text, int, text), app.revoke_share(uuid) to authenticated;
revoke all on function app.open_share(text, text) from public, anon, authenticated;
grant execute on function app.open_share(text, text) to service_role;

drop policy if exists read_member on app.shares;
create policy read_scoped on app.shares for select to authenticated
  using (private.can_see_product(product_id));

create index if not exists shares_report on app.shares(report_id);
create index if not exists share_access_log_share on app.share_access_log(share_id);
