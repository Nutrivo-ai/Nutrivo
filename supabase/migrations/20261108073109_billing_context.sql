-- T-703 · M01, M03, M05: what the web server needs from the database around its Stripe calls (docs/08 "Checkout
-- contract", "How the web runs it").
--
-- app.billing_context: before a Checkout Session, a customer-portal session or a change to the Stripe customer's
-- billing details, the web server reads the workspace and its mirrored Stripe customer from here, checked against
-- auth.uid(), never from the request. Read only.
-- app.record_billing_change: after a change to the billing details or the finance address succeeds at Stripe, the web
-- server records who changed what in the audit log (Stripe holds the details, D-18; the audit stays in Nutrivo).
--
-- Who may manage billing is exactly who may export the workspace: an internal admin of the whole workspace whose
-- access has not ended. private.can_manage_billing delegates to private.can_export so the two cannot drift.

create function private.can_manage_billing(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.can_export(ws)
$$;
revoke execute on function private.can_manage_billing(uuid) from public, anon;
grant execute on function private.can_manage_billing(uuid) to authenticated, service_role;

create function app.billing_context(p_ws uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if p_ws is null or not private.can_manage_billing(p_ws) then
    raise exception 'only an internal admin of the whole workspace can manage its billing' using errcode = '42501';
  end if;
  select jsonb_build_object(
           'workspace_id', w.id,
           'name', w.name,
           'plan', w.plan,
           'status', w.status,
           'stripe_customer_id', s.stripe_customer_id,
           'stripe_subscription_id', s.stripe_subscription_id,
           'subscription_status', s.status,
           'term', s.term,
           'current_period_end', s.current_period_end)
    into v
  from app.workspaces w
  left join app.subscriptions s on s.workspace_id = w.id
  where w.id = p_ws;
  return v;
end $$;
revoke all on function app.billing_context(uuid) from public, anon;
grant execute on function app.billing_context(uuid) to authenticated, service_role;

-- p_kind 'details': the legal entity, registered address, VAT number, company ID and PO reference, before and after.
-- p_kind 'finance_email': the address Stripe sends every invoice to, before and after.
-- Only those keys are accepted (22023 otherwise), so the audit row holds billing details and nothing else. A customer
-- id other than the workspace's mirrored one is refused (22023). The row names the admin who made the change
-- (private.write_audit stamps the actor and whether they are external).
create function app.record_billing_change(p_ws uuid, p_kind text, p_customer text, p_before jsonb, p_after jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_keys text[]; v_mirrored text;
begin
  if p_ws is null or not private.can_manage_billing(p_ws) then
    raise exception 'only an internal admin of the whole workspace can manage its billing' using errcode = '42501';
  end if;
  v_keys := case p_kind
              when 'details' then array['legal_name','address','vat_number','company_id','po_reference']
              when 'finance_email' then array['email']
            end;
  if v_keys is null then
    raise exception 'unknown billing change %', p_kind using errcode = '22023';
  end if;
  if coalesce(p_customer, '') !~ '^cus_[A-Za-z0-9_]{1,250}$' then
    raise exception 'not a Stripe customer id' using errcode = '22023';
  end if;
  select s.stripe_customer_id into v_mirrored from app.subscriptions s where s.workspace_id = p_ws;
  if v_mirrored is not null and v_mirrored <> p_customer then
    raise exception 'not this workspace''s Stripe customer' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_before, '{}'::jsonb)) <> 'object' or jsonb_typeof(coalesce(p_after, '{}'::jsonb)) <> 'object'
     or exists (select 1 from jsonb_object_keys(coalesce(p_before, '{}'::jsonb) || coalesce(p_after, '{}'::jsonb)) k
                where k <> all (v_keys)) then
    raise exception 'billing change holds fields it may not' using errcode = '22023';
  end if;
  perform private.write_audit(p_ws, 'billing.' || p_kind || '_changed', 'stripe_customer', p_customer, p_before, p_after);
end $$;
revoke all on function app.record_billing_change(uuid, text, text, jsonb, jsonb) from public, anon;
grant execute on function app.record_billing_change(uuid, text, text, jsonb, jsonb) to authenticated, service_role;
