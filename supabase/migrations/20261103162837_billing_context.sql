-- T-703 · M01, M05: the billing context the web server reads before it calls Stripe (docs/08 "Checkout contract").
-- A Checkout Session, a customer-portal session and a change to the Stripe customer's billing details must name the
-- caller's own workspace, so the workspace id and the Stripe customer come from here, checked against auth.uid(),
-- never from the request. Only an internal admin of the whole workspace may manage its billing (the same people who
-- may export it): an external admin or one scoped to some recipes or markets cannot bind the company to a
-- subscription. Read only: nothing is written, so nothing is audited; the Stripe events that follow are stored and
-- audited by app.record_stripe_event (T-702).

create function private.can_manage_billing(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app.memberships m join app.people p on p.id = m.person_id
    where m.workspace_id = ws and p.user_id = auth.uid() and m.ended_at is null
      and (m.access_ends_at is null or m.access_ends_at > now()) and m.role = 'admin'
      and not m.is_external and m.scope_family_ids is null and m.scope_node_ids is null)
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
