-- T-604 · I02, D-30 (#180 Q7): email shares are capped at 50 per workspace per UTC day, refused with P0050.
-- The body of app.create_share from 20261111020651 (T-409), with one more step for channel 'email': before the share
-- is made, the workspace's email shares created since 00:00 UTC today are counted, under a transaction-scoped advisory
-- lock per workspace so two concurrent calls cannot both take the 50th place. Every email share counts, revoked or
-- expired ones too (the email went out); link shares are never counted. The refusal is P0050 with the hint
-- {"limit": 50, "resets_at": "<next 00:00 UTC>"}; nothing is inserted, queued or audited. create or replace keeps the
-- grants (authenticated only). The cap is separate from the hourly notify limit (P0049, T-1103), which still applies.
create or replace function app.create_share(p_report uuid, p_channel text, p_recipient text default null,
                                 p_expires_in_days int default 30, p_request_id text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_r app.reports; v_id uuid := gen_random_uuid(); v_token text; v_hash bytea; v_recipient text;
        v_expires timestamptz; v_job uuid; v_rid text; v_day timestamptz; v_sent int;
        c_email_per_day constant int := 50;
begin
  select * into v_r from app.reports r where r.id = p_report;
  if not found or not private.can_edit_product(v_r.product_id) or private.person_id() is null
     or (v_r.node_id is not null and not private.node_in_scope(v_r.workspace_id, v_r.node_id)) then
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
    -- D-30: 50 email shares per workspace per UTC day.
    perform pg_advisory_xact_lock(hashtextextended('app.create_share:email:' || v_r.workspace_id::text, 0));
    v_day := date_trunc('day', now(), 'UTC');
    select count(*) into v_sent from app.shares s
    where s.workspace_id = v_r.workspace_id and s.channel = 'email' and s.created_at >= v_day;
    if v_sent >= c_email_per_day then
      raise exception 'this workspace has sent % email shares today: try again after 00:00 UTC', c_email_per_day
        using errcode = 'P0050',
              hint = jsonb_build_object('limit', c_email_per_day, 'resets_at', v_day + interval '1 day')::text;
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

-- The count above reads one workspace's email shares of one day.
create index if not exists shares_email_per_day on app.shares (workspace_id, created_at) where channel = 'email';
