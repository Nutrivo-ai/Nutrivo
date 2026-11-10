-- DB-14 follow-up · G03: a registration's evidence document must be a clean one. Since T-802, app.supplier_documents
-- also holds quarantine rows (storage_path quarantine/..., scan not yet run) and rejected rows (the scan found
-- malware) next to the clean promoted row (promotion is a new row, founder decision on #69). The web already offers
-- only clean documents as evidence; the database now refuses anything else (22023), so a quarantined or infected
-- file can never be cited as a registration's evidence.
--
-- Same signature, so callers, grants and generated types do not change. The body is
-- 20261104012022_registration_state.sql's unchanged, apart from `and d.scan_status = 'clean'` and its message.
create or replace function app.record_registration(p_product uuid, p_node text, p_number text, p_registered_on date,
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
                                                where d.id = p_evidence_doc and d.workspace_id = v_ws
                                                  and d.scan_status = 'clean') then
    raise exception 'that evidence document is not a clean document in this workspace' using errcode = '22023';
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

-- create or replace keeps the existing ACL; restated so this migration stands on its own
revoke execute on function app.record_registration(uuid, text, text, date, date, uuid, uuid) from public, anon;
grant execute on function app.record_registration(uuid, text, text, date, date, uuid, uuid) to authenticated;
