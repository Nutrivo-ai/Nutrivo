-- T-402 · D03: a person confirms or edits the product's classification (decided on #44, Q1 option a).
-- Additive: one RPC. app.classifications stays insert-only: a confirmation is a new row, never an update of the
-- suggestion. The values are the provisional closed vocabularies of docs/03 (Q3 on #44: revisited at T-208).

create function app.confirm_classification(p_product uuid, p_basis uuid,
                                           p_species text, p_life_stage text, p_product_class text,
                                           p_intended_use text, p_parnut_status text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_person uuid := private.person_id(); v_latest app.classifications; v_basis_cite jsonb; v_fields jsonb := '{}'::jsonb;
        v_edited text[] := '{}'; v_new jsonb; v_old jsonb; v_f text; v_id uuid;
begin
  if v_person is null or not private.can_edit_product(p_product) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  -- One confirmation per product at a time: two people confirming the same basis at once must not both pass the
  -- basis check below (the second waits, then sees the first's row and gets P0045). The worker takes the same lock
  -- before it writes a suggestion.
  select pr.workspace_id into v_ws from app.products pr where pr.id = p_product for update;

  -- The person confirms what they were shown: the product's latest classification, or none at all. Anything newer
  -- (another person's confirmation, a new suggestion) is refused rather than silently overwritten.
  select * into v_latest from app.classifications c where c.product_id = p_product
   order by c.created_at desc, c.id desc limit 1;
  if p_basis is distinct from v_latest.id then
    raise exception 'the classification changed since it was read; reload and confirm again' using errcode = 'P0045';
  end if;

  -- Provisional closed vocabularies (docs/03, Q3 on #44); product_class is also the column's check constraint.
  if p_species is not null and p_species not in ('dog','cat')
     or p_life_stage is not null and p_life_stage not in ('growth','adult','senior')
     or p_product_class is not null and p_product_class not in ('complete','complementary','treat','mineral','dietetic','other')
     or p_intended_use is not null
     or p_parnut_status is not null and p_parnut_status not in ('parnut') then
    raise exception 'a value is not one of the recorded classification values' using errcode = '22023';
  end if;

  v_new := jsonb_build_object('species', p_species, 'life_stage', p_life_stage, 'product_class', p_product_class,
                              'intended_use', p_intended_use, 'parnut_status', p_parnut_status);
  v_old := case when v_latest.id is null then null else
           jsonb_build_object('species', v_latest.species, 'life_stage', v_latest.life_stage,
                              'product_class', v_latest.product_class, 'intended_use', v_latest.intended_use,
                              'parnut_status', v_latest.parnut_status) end;
  -- The basis's label evidence is kept for each value the person left as it was; an edited value rests on the person.
  begin
    v_basis_cite := v_latest.citation::jsonb;
  exception when others then
    v_basis_cite := null;
  end;
  foreach v_f in array array['species','life_stage','product_class','intended_use','parnut_status'] loop
    if (v_new ->> v_f) is distinct from (v_old ->> v_f) then          -- no basis: every value set is the person's
      v_edited := v_edited || v_f;
    elsif (v_new ->> v_f) is not null and v_basis_cite #> array['fields', v_f] is not null then
      v_fields := v_fields || jsonb_build_object(v_f, v_basis_cite #> array['fields', v_f]);
    end if;
  end loop;

  insert into app.classifications (workspace_id, product_id, species, life_stage, product_class, intended_use,
                                   parnut_status, citation, provenance, confirmed_by, confirmed_at, model_call_id,
                                   created_at)
  values (v_ws, p_product, p_species, p_life_stage, p_product_class, p_intended_use, p_parnut_status,
          jsonb_build_object('basis', 'person', 'basis_classification_id', p_basis, 'fields', v_fields,
                             'edited', to_jsonb(v_edited))::text,
          'person', v_person, now(), v_latest.model_call_id,
          clock_timestamp())                    -- strictly after its basis, even inside one transaction
  returning id into v_id;
  perform private.write_audit(v_ws, 'classification.confirmed', 'classification', v_id::text, v_old,
                              v_new || jsonb_build_object('basis', p_basis, 'edited', to_jsonb(v_edited)));
  return v_id;
end $$;

revoke execute on function app.confirm_classification(uuid, uuid, text, text, text, text, text) from public, anon;
grant execute on function app.confirm_classification(uuid, uuid, text, text, text, text, text) to authenticated;
