-- T-105 · A03.fail.2 "A pending invitation exists: resend, never duplicate" (answer 1 on #27).
-- app.invite_member for an address with a pending invitation in the workspace now resends that invitation instead
-- of failing on invitations_one_pending: it returns the existing id, re-enqueues 'notify' under a new key (the worker
-- mints a new token, which replaces the old one) and audits invitation.resent. No new row, no new P-code.
-- The resend keeps the invitation's role, scope and end date; to change them, revoke and invite again. It renews
-- expires_at to the column's 7-day default, because a lapsed invitation still holds the pending slot and the
-- email's promise is "if it lapses, ask them to send another" (design, Template 02).
-- Seats: a new editor-class invitation is checked as before. A resend of one still within its expiry claims nothing
-- new; a lapsed one could no longer become a membership, so renewing it is checked like a new invitation (P0033,
-- the row unchanged). Same signature, so grants are kept.
-- One email in flight: while a notify job for the invitation is queued or running, a resend (a double-submitted
-- form) renews and audits but queues no second job, because parallel jobs would race on token_hash and the newest
-- email could carry a dead link.
-- app.revoke_invitation cancels only the first 'invite:<id>' job; a queued resend that outlives a revoke is a no-op,
-- because the worker re-checks the invitation and records skipped_revoked without minting a token or sending.
create or replace function app.invite_member(p_ws uuid, p_email text, p_role text, p_is_external boolean default false,
                                             p_scope_family_ids uuid[] default null, p_scope_node_ids text[] default null,
                                             p_access_ends_at timestamptz default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_inv uuid; v_used int; v_included int; v_pending app.invitations; v_found boolean; v_in_flight boolean;
        v_resends int;
begin
  if not private.has_role(p_ws, '{admin}') then raise exception 'only admins can invite' using errcode = '42501'; end if;

  select * into v_pending from app.invitations i
  where i.workspace_id = p_ws and i.email = lower(p_email)::extensions.citext
    and i.accepted_at is null and i.revoked_at is null
  for update;
  v_found := found;

  if (not v_found and p_role in ('admin','portfolio_manager','editor'))
     or (v_found and v_pending.expires_at <= now() and v_pending.role in ('admin','portfolio_manager','editor')) then
    select s.editor_seats into v_included from app.subscriptions s where s.workspace_id = p_ws;
    if v_included is not null then
      select count(*) into v_used from app.memberships m
      where m.workspace_id = p_ws and m.ended_at is null and (m.access_ends_at is null or m.access_ends_at > now())
        and m.role in ('admin','portfolio_manager','editor');
      if v_used >= v_included then
        raise exception 'BE-33: no editor seat left on this plan' using errcode = 'P0033';
      end if;
    end if;
  end if;

  if v_found then
    update app.invitations i set expires_at = now() + interval '7 days' where i.id = v_pending.id;
    v_in_flight := exists (select 1 from app.jobs j
                           where j.kind = 'notify' and j.status in ('queued','running')
                             and (j.idempotency_key = 'invite:' || v_pending.id::text
                                  or j.idempotency_key like 'invite:' || v_pending.id::text || ':resend:%'));
    if not v_in_flight then
      select count(*) into v_resends from app.audit_events a
      where a.workspace_id = p_ws and a.kind = 'invitation.resent' and a.object_id = v_pending.id::text;
      perform private.enqueue('notify', p_ws, 'invite:' || v_pending.id::text || ':resend:' || (v_resends + 1)::text,
                              jsonb_build_object('template', 'invitation', 'invitation_id', v_pending.id));
    end if;
    perform private.write_audit(p_ws, 'invitation.resent', 'invitation', v_pending.id::text,
                                jsonb_build_object('expires_at', v_pending.expires_at),
                                jsonb_build_object('email', v_pending.email, 'role', v_pending.role,
                                                   'is_external', v_pending.is_external,
                                                   'expires_at', now() + interval '7 days',
                                                   'email_queued', not v_in_flight));
    return v_pending.id;
  end if;

  insert into app.invitations (workspace_id, email, role, is_external, scope_family_ids, scope_node_ids,
                               access_ends_at, invited_by)
  values (p_ws, lower(p_email), p_role, p_is_external, p_scope_family_ids, p_scope_node_ids, p_access_ends_at,
          private.person_id())
  returning id into v_inv;
  perform private.enqueue('notify', p_ws, 'invite:' || v_inv::text,
                          jsonb_build_object('template', 'invitation', 'invitation_id', v_inv));
  perform private.write_audit(p_ws, 'invitation.sent', 'invitation', v_inv::text, null,
                              jsonb_build_object('email', lower(p_email), 'role', p_role, 'is_external', p_is_external));
  return v_inv;
end $$;
