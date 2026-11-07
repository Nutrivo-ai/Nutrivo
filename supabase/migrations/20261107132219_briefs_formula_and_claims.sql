-- T-1001 · E01 Create a brief: a person enters a product's formula lines and intended claims (S-NV2-004).
-- Additive: one private helper, two RPCs and a redefinition of app.request_check with the same signature and grants.
-- app.formula_lines and app.intended_claims already exist with read_scoped RLS and no client write grants (0003, 0004).
-- Decisions on #76 (7 Nov): the person picks the register row (no automatic or model matching); the formula changes
-- check outcomes, so it is part of a check's idempotency key. Tests: supabase/tests/app/96_briefs.test.sql.

-- ─── 1 · private.formula_digest: what a check of this product would read as its formula ────────────────────────
-- '-' when the product has no formula lines (a formula never entered: additive rules are withheld data_missing, #172),
-- otherwise the md5 of the ordered lines as the worker reads them. Any change to a line changes the digest.
create function private.formula_digest(p_product uuid) returns text
language sql stable set search_path = '' as $$
  select coalesce(md5(string_agg(jsonb_build_array(f.position, f.ingredient, f.percent, f.feed_material_ref,
                                                   f.additive_ref, f.amount, f.unit)::text, '|'
                                 order by f.position, f.id)), '-')
  from app.formula_lines f where f.product_id = p_product
$$;
revoke all on function private.formula_digest(uuid) from public, anon, authenticated;
grant execute on function private.formula_digest(uuid) to service_role;

-- ─── 2 · app.set_formula_lines: the person's formula, replaced as a whole ──────────────────────────────────────
-- p_lines is a JSON array in the order printed on the brief; each element:
--   {ingredient (text, as entered, required), percent (0..100)?, feed_material_ref?, additive_ref?, amount (>= 0)?,
--    unit? (required with amount)}
-- A line names at most one register row, and only a row the register holds (ref.feed_materials.number or
-- ref.feed_additives.id); the person picks it, never the model (E03). A line with neither is "not matched to the
-- register": the worker then withholds additive rules rather than reading the formula as additive-free.
-- An empty array removes the formula: the product is back to "no formula entered". applied_by is the person.
create function app.set_formula_lines(p_product uuid, p_lines jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_person uuid := private.person_id(); v_old jsonb; v_new jsonb; v_n int;
        v_line jsonb; v_i bigint; v_ingredient text; v_fm text; v_add text; v_unit text;
begin
  if v_person is null or not private.can_edit_product(p_product) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  -- One formula write per product at a time; request_check reads the digest after this commits.
  select pr.workspace_id into v_ws from app.products pr where pr.id = p_product for update;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'the formula must be a list of lines' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) > 300 then
    raise exception 'a formula holds at most 300 lines' using errcode = '22023';
  end if;
  for v_line, v_i in select e.value, e.ordinality from jsonb_array_elements(p_lines) with ordinality e loop
    if jsonb_typeof(v_line) <> 'object' then
      raise exception 'line %: not a formula line', v_i using errcode = '22023';
    end if;
    v_ingredient := btrim(v_line ->> 'ingredient');
    if v_ingredient is null or v_ingredient = '' or length(v_ingredient) > 300 then
      raise exception 'line %: the ingredient as entered is required (at most 300 characters)', v_i using errcode = '22023';
    end if;
    if coalesce(jsonb_typeof(v_line -> 'percent'), 'null') not in ('null','number')
       or coalesce(jsonb_typeof(v_line -> 'amount'), 'null') not in ('null','number') then
      raise exception 'line %: percent and amount are numbers', v_i using errcode = '22023';
    end if;
    if (v_line ->> 'percent')::numeric not between 0 and 100 then
      raise exception 'line %: percent is between 0 and 100', v_i using errcode = '22023';
    end if;
    if (v_line ->> 'amount')::numeric < 0 then
      raise exception 'line %: amount is not negative', v_i using errcode = '22023';
    end if;
    v_unit := nullif(btrim(v_line ->> 'unit'), '');
    if (v_line ->> 'amount') is not null and v_unit is null or length(v_unit) > 20 then
      raise exception 'line %: an amount needs its unit (at most 20 characters)', v_i using errcode = '22023';
    end if;
    v_fm := nullif(btrim(v_line ->> 'feed_material_ref'), '');
    v_add := nullif(btrim(v_line ->> 'additive_ref'), '');
    if v_fm is not null and v_add is not null then
      raise exception 'line %: a line is a feed material or an additive, not both', v_i using errcode = '22023';
    end if;
    if v_fm is not null and not exists (select 1 from ref.feed_materials m where m.number = v_fm)
       or v_add is not null and not exists (select 1 from ref.feed_additives a where a.id = v_add) then
      raise exception 'line %: the register holds no such entry', v_i using errcode = '22023';
    end if;
  end loop;

  select coalesce(jsonb_agg(to_jsonb(f) - 'workspace_id' - 'product_id' - 'created_at' order by f.position, f.id),
                  '[]'::jsonb)
    into v_old from app.formula_lines f where f.product_id = p_product;
  delete from app.formula_lines f where f.product_id = p_product;
  insert into app.formula_lines (workspace_id, product_id, position, ingredient, percent, feed_material_ref,
                                 additive_ref, amount, unit, applied_by)
  select v_ws, p_product, e.ordinality::int, btrim(e.value ->> 'ingredient'), (e.value ->> 'percent')::numeric,
         nullif(btrim(e.value ->> 'feed_material_ref'), ''), nullif(btrim(e.value ->> 'additive_ref'), ''),
         (e.value ->> 'amount')::numeric, nullif(btrim(e.value ->> 'unit'), ''), v_person
  from jsonb_array_elements(p_lines) with ordinality e;
  get diagnostics v_n = row_count;
  select coalesce(jsonb_agg(to_jsonb(f) - 'workspace_id' - 'product_id' - 'created_at' order by f.position, f.id),
                  '[]'::jsonb)
    into v_new from app.formula_lines f where f.product_id = p_product;

  perform private.write_audit(v_ws, 'formula.set', 'product', p_product::text,
                              jsonb_build_object('lines', v_old),
                              jsonb_build_object('lines', v_new, 'digest', private.formula_digest(p_product)));
  return v_n;
end $$;
revoke execute on function app.set_formula_lines(uuid, jsonb) from public, anon;
grant execute on function app.set_formula_lines(uuid, jsonb) to authenticated;

-- ─── 3 · app.set_intended_claims: the customer's own claim text, per language ──────────────────────────────────
-- Replaces the product's intended claims in one language with p_claims, in order. The text is the customer's,
-- stored exactly as typed (trimmed), never generated or translated: claims are judged on the target-language string
-- (non-negotiable 4). The language is one that a market of the jurisdiction register prints in. An empty array
-- removes that language's claims.
create function app.set_intended_claims(p_product uuid, p_language text, p_claims text[]) returns int
language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_person uuid := private.person_id(); v_old jsonb; v_new jsonb; v_n int; v_c text;
begin
  if v_person is null or not private.can_edit_product(p_product) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  select pr.workspace_id into v_ws from app.products pr where pr.id = p_product for update;

  if p_language is null or not exists (select 1 from ref.jurisdictions j where p_language = any(j.languages)) then
    raise exception 'not a language of any market' using errcode = '22023';
  end if;
  if p_claims is null or coalesce(array_length(p_claims, 1), 0) > 50 then
    raise exception 'at most 50 intended claims per language' using errcode = '22023';
  end if;
  foreach v_c in array p_claims loop
    if v_c is null or btrim(v_c) = '' or length(btrim(v_c)) > 500 then
      raise exception 'an intended claim is text of at most 500 characters' using errcode = '22023';
    end if;
  end loop;

  select coalesce(jsonb_agg(c.claim_text order by c.created_at, c.id), '[]'::jsonb) into v_old
    from app.intended_claims c where c.product_id = p_product and c.language = p_language;
  delete from app.intended_claims c where c.product_id = p_product and c.language = p_language;
  insert into app.intended_claims (workspace_id, product_id, language, claim_text, created_at)
  select v_ws, p_product, p_language, btrim(u.c), clock_timestamp() + (u.n * interval '1 microsecond')
  from unnest(p_claims) with ordinality u(c, n);
  get diagnostics v_n = row_count;
  select coalesce(jsonb_agg(c.claim_text order by c.created_at, c.id), '[]'::jsonb) into v_new
    from app.intended_claims c where c.product_id = p_product and c.language = p_language;

  perform private.write_audit(v_ws, 'intended_claims.set', 'product', p_product::text,
                              jsonb_build_object('language', p_language, 'claims', v_old),
                              jsonb_build_object('language', p_language, 'claims', v_new));
  return v_n;
end $$;
revoke execute on function app.set_intended_claims(uuid, text, text[]) from public, anon;
grant execute on function app.set_intended_claims(uuid, text, text[]) to authenticated;

-- ─── 4 · app.request_check: the formula is part of what a check is of ──────────────────────────────────────────
-- Same body as 20261008000005, plus the formula digest in the idempotency key and the payload. Before this, entering
-- a formula left the key unchanged, so the next request_check returned the earlier job whose additive rules were
-- withheld for want of a formula (#76). create or replace keeps the grants.
create or replace function app.request_check(p_product uuid, p_nodes text[] default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_av uuid; v_sha text; v_ruleset text; v_class uuid; v_nodes text[]; v_formula text;
begin
  if not private.can_edit_product(p_product) then raise exception 'not permitted' using errcode = '42501'; end if;
  select pr.workspace_id into v_ws from app.products pr where pr.id = p_product;
  select av.id, av.file_sha256 into v_av, v_sha from app.artwork_versions av
  where av.product_id = p_product order by av.version desc limit 1;
  if v_av is null then raise exception 'this product has no artwork to check yet' using errcode = 'P0002'; end if;
  select rv.id into v_ruleset from ref.ruleset_versions rv order by rv.released_at desc limit 1;
  if v_ruleset is null then raise exception 'no ruleset has been released' using errcode = 'P0003'; end if;
  select c.id into v_class from app.classifications c where c.product_id = p_product order by c.created_at desc limit 1;
  v_nodes := coalesce(p_nodes, array(select pn.node_id from app.product_nodes pn
                                     where pn.product_id = p_product order by pn.node_id));
  v_formula := private.formula_digest(p_product);
  return private.enqueue('check', v_ws,
    format('check:%s:%s:%s:%s:%s:%s', p_product, v_sha, v_ruleset, coalesce(v_class::text, '-'),
           array_to_string(v_nodes, ','), v_formula),
    jsonb_build_object('product_id', p_product, 'artwork_version_id', v_av, 'ruleset_version', v_ruleset,
                       'classification_id', v_class, 'node_ids', to_jsonb(v_nodes), 'formula_digest', v_formula));
end $$;
