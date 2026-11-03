-- T-504 · D06, G03: registration state is derived in the database, separately from label state (non-negotiable 8),
-- and a registration is recorded only through app.record_registration. No obligation content is written here or
-- anywhere in migrations and seeds (non-negotiable 7, G01.must.1).

-- D06. The derivation, in order (#54 Q1): the latest recorded registration for the product and market decides when
-- there is one: expired once its expiry date has passed, else registered ("we record what you tell us, we do not
-- confirm"). Without one, not_registered only when an accepted, sourced registration obligation exists for the market;
-- obligations have no acceptance yet (#54 Q4), so none qualifies and the state stays unknown. not_required is never
-- derived: a missing obligation row is not evidence. Unknown never displays as Clear (display_state, BE-14).
create function private.compute_registration_state(p_product uuid, p_node text) returns text
language sql stable security definer set search_path = '' as $$
  with latest as (
    select r.expires_at from app.registrations r
    where r.product_id = p_product and r.node_id = p_node
    order by r.created_at desc, r.id desc limit 1)
  select case
    when exists (select 1 from latest where expires_at is not null and expires_at < current_date) then 'expired'
    when exists (select 1 from latest) then 'registered'
    when exists (select 1 from ref.obligations o
                 where o.node_id = p_node and o.kind = 'registration'
                   and o.source_url is not null and o.last_verified_at is not null
                   and false)                    -- no obligation is accepted until #54 Q4 adds acceptance
      then 'not_registered'
    else 'unknown' end
$$;

create function private.refresh_registration_state(p_product uuid, p_node text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_state text := private.compute_registration_state(p_product, p_node);
begin
  update app.product_nodes pn set registration_state = v_state, updated_at = now()
  where pn.product_id = p_product and pn.node_id = p_node and pn.registration_state is distinct from v_state;
  return v_state;
end $$;

revoke execute on function private.compute_registration_state(uuid, text) from public, anon, authenticated;
revoke execute on function private.refresh_registration_state(uuid, text) from public, anon, authenticated;
-- the worker refreshes the state after each check (D06); DATABASE_URL may be the service role on hosted projects
grant execute on function private.compute_registration_state(uuid, text), private.refresh_registration_state(uuid, text)
  to service_role;

-- G03: an editor records a registration they hold. A correction is a new row; the latest wins (#54 Q9). The state is
-- recomputed in the same transaction. Nothing here, or anywhere, submits to an authority (G02.must.1).
create function app.record_registration(p_product uuid, p_node text, p_number text, p_registered_on date,
                                        p_expires_at date default null, p_evidence_doc uuid default null,
                                        p_obligation uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_id uuid; v_state text; v_before text;
begin
  select pr.workspace_id into v_ws from app.products pr where pr.id = p_product;
  if v_ws is null or not private.can_edit_product(p_product) or not private.node_in_scope(v_ws, p_node) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  select pn.registration_state into v_before from app.product_nodes pn
  where pn.product_id = p_product and pn.node_id = p_node for update;
  if not found then raise exception 'this product is not sold in %', p_node using errcode = 'P0002'; end if;
  if nullif(btrim(coalesce(p_number, '')), '') is null then
    raise exception 'a registration needs its number' using errcode = '22023';
  end if;
  if p_registered_on is null then raise exception 'a registration needs its date' using errcode = '22023'; end if;
  if p_expires_at is not null and p_expires_at < p_registered_on then
    raise exception 'the expiry date is before the registration date' using errcode = '22023';
  end if;
  if p_obligation is not null and not exists (select 1 from ref.obligations o
                                              where o.id = p_obligation and o.node_id = p_node) then
    raise exception 'that obligation is not for %', p_node using errcode = '22023';
  end if;
  if p_evidence_doc is not null and not exists (select 1 from app.supplier_documents d
                                                where d.id = p_evidence_doc and d.workspace_id = v_ws) then
    raise exception 'that evidence document is not in this workspace' using errcode = '22023';
  end if;
  -- clock_timestamp, not now(): two recordings in one transaction must still order, since the latest one wins
  insert into app.registrations (workspace_id, product_id, node_id, obligation_id, number, registered_on, expires_at,
                                 evidence_doc_id, recorded_by, created_at)
  values (v_ws, p_product, p_node, p_obligation, btrim(p_number), p_registered_on, p_expires_at, p_evidence_doc,
          private.person_id(), clock_timestamp())
  returning id into v_id;
  v_state := private.refresh_registration_state(p_product, p_node);
  perform private.write_audit(v_ws, 'registration.recorded', 'registration', v_id::text,
                              jsonb_build_object('registration_state', v_before),
                              jsonb_build_object('registration_state', v_state, 'node', p_node,
                                                 'expires_at', p_expires_at));
  return v_id;
end $$;

revoke execute on function app.record_registration(uuid, text, text, date, date, uuid, uuid) from public, anon;
grant execute on function app.record_registration(uuid, text, text, date, date, uuid, uuid) to authenticated;

-- Market scope applies to registrations and packs as it does to product_nodes, checks and findings (#54 Q10): a
-- member scoped to some markets reads only theirs. A tightening; no client write grants exist or are added.
drop policy read_scoped on app.registrations;
create policy read_scoped on app.registrations for select to authenticated
  using (private.can_see_product(product_id) and private.node_in_scope(workspace_id, node_id));
drop policy read_scoped on app.registration_packs;
create policy read_scoped on app.registration_packs for select to authenticated
  using (private.can_see_product(product_id) and private.node_in_scope(workspace_id, node_id));
