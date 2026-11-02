-- T-401 · C01, C02, C03, C04, B02: products, families, stages and the free allowance's one email.
-- Every write follows 20261008000005_functions.sql: security definer, search_path = '', permission check first, one
-- transaction, private.write_audit, private.enqueue. Nothing here deletes: products have no delete (BE-13), and the
-- allowance's consumption rows stay insert-only (BE-05).
--
-- Decisions taken where the spec is silent (asked on #43 with needs-human; the conservative option until answered):
--   Q1 A new recipe (family) on a paid plan is refused once live recipes reach the subscription's recipes_included,
--      P0034, and the screen offers the next plan. No overage is ever created, so the invoice never grows (BE-34,
--      C01.fail.1). T-704 owns the € overage cap and may loosen this to "up to the cap".
--   Q2 No SKU or discontinue-reason column: the reason travels in the audit event only.
--   Q4 Only internal, unscoped editor-class members create families or products: a scoped member could not see a
--      family created outside their scope.

-- ─── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- An internal, unscoped admin, portfolio manager or editor, active and unexpired.
create function private.can_create_product(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app.memberships m join app.people p on p.id = m.person_id
    where m.workspace_id = ws and p.user_id = auth.uid() and m.ended_at is null
      and (m.access_ends_at is null or m.access_ends_at > now())
      and m.role in ('admin','portfolio_manager','editor')
      and not m.is_external and m.scope_family_ids is null and m.scope_node_ids is null)
$$;

-- BE-33: a recipe is a family with at least one product that is not discontinued (app.live_billable_counts).
create function private.live_recipes(ws uuid) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from app.families f
  where f.workspace_id = ws and f.discontinued_at is null
    and exists (select 1 from app.products p where p.family_id = f.id and p.stage <> 'discontinued')
$$;

-- BE-34 (Q1 above): refuse one more recipe once the paid plan's included recipes are all live. The subscription
-- mirror clears recipes_included when no subscription is live, and Free and Advanced carry none, so they never stop.
create function private.require_recipe_room(ws uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v_included int; v_plan text;
begin
  select s.recipes_included, s.plan into v_included, v_plan from app.subscriptions s where s.workspace_id = ws;
  if v_included is not null and private.live_recipes(ws) >= v_included then
    raise exception 'BE-34: all % recipes of the % plan are in use; the next plan adds more', v_included, v_plan
      using errcode = 'P0034',
            hint = jsonb_build_object('plan', v_plan, 'recipes_included', v_included,
                                      'next_plan', case v_plan when 'basic' then 'standard' else 'advanced' end)::text;
  end if;
end $$;

-- The operator exactly as printed, validated like app.set_default_operator; null keeps the workspace default.
create function private.normalise_operator(p_operator jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
begin
  if p_operator is null or p_operator = 'null'::jsonb then return null; end if;
  if jsonb_typeof(p_operator) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p_operator) k
                where k not in ('name','address','country','approval_number'))
     or jsonb_typeof(p_operator -> 'name') is distinct from 'string'
     or length(btrim(p_operator ->> 'name')) not between 1 and 300
     or jsonb_typeof(p_operator -> 'address') is distinct from 'string'
     or length(btrim(p_operator ->> 'address')) not between 1 and 500
     or jsonb_typeof(p_operator -> 'country') is distinct from 'string'
     or (p_operator ->> 'country') !~ '^[A-Z]{2}$'
     or jsonb_typeof(coalesce(p_operator -> 'approval_number', 'null')) not in ('string','null')
     or length(p_operator ->> 'approval_number') > 100 then
    raise exception 'the operator needs a name, an address and a two-letter country code; the approval number is optional'
      using errcode = '22023';
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'name', btrim(p_operator ->> 'name'), 'address', btrim(p_operator ->> 'address'),
    'country', p_operator ->> 'country', 'approval_number', nullif(btrim(p_operator ->> 'approval_number'), '')));
end $$;

-- Markets: known jurisdiction nodes (not a region itself) inside the workspace's entitled regions; 22023 otherwise.
create function private.check_markets(ws uuid, p_nodes text[]) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v_nodes text[]; v_bad text;
begin
  select coalesce(array_agg(distinct btrim(n) order by btrim(n)), '{}') into v_nodes
  from unnest(coalesce(p_nodes, '{}')) n where btrim(n) <> '';
  select n into v_bad from unnest(v_nodes) n
  where not exists (
    select 1 from ref.jurisdictions j join app.workspaces w on w.id = ws
    -- every node below a region has that region as its parent (BE-07: EU-DE → EU, UK-GB → UK, US-TX → US)
    where j.id = n and j.node_type <> 'region' and j.parent_id = any(w.entitled_regions))
  limit 1;
  if v_bad is not null then
    raise exception 'market % is unknown or outside this workspace''s regions', v_bad using errcode = '22023';
  end if;
  return v_nodes;
end $$;

-- A family named by the caller must be this workspace's; a new one checks the recipe cap first.
create function private.family_for_product(ws uuid, p_family uuid, p_family_name text, p_fallback_name text)
returns table (family_id uuid, created boolean)
language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  if p_family is not null then
    if not exists (select 1 from app.families f where f.id = p_family and f.workspace_id = ws) then
      raise exception 'that family is not in this workspace' using errcode = '22023';
    end if;
    -- C03.must.1: a variant joins its family. Reviving a family with no live product is a recipe again.
    if not exists (
         select 1 from app.products p where p.family_id = p_family and p.stage <> 'discontinued') then
      perform private.require_recipe_room(ws);
    end if;
    return query select p_family, false;
    return;
  end if;
  v_name := btrim(coalesce(nullif(btrim(p_family_name), ''), p_fallback_name));
  if length(v_name) not between 1 and 200 then
    raise exception 'a family needs a name of 1 to 200 characters' using errcode = '22023';
  end if;
  perform private.require_recipe_room(ws);
  insert into app.families (workspace_id, name) values (ws, v_name) returning id into family_id;
  perform private.write_audit(ws, 'family.created', 'family', family_id::text, null, jsonb_build_object('name', v_name));
  created := true;
  return next;
end $$;

-- ─── C01 + C03: create a product (and its family, unless one is named) with its markets ─────────────────────────
create function app.create_product(p_ws uuid, p_name text, p_family uuid default null, p_family_name text default null,
                                   p_stage text default 'brief', p_species text default null,
                                   p_life_stage text default null, p_format text default null,
                                   p_operator jsonb default null, p_nodes text[] default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_name text := btrim(coalesce(p_name, '')); v_family uuid; v_new_family boolean; v_product uuid;
        v_nodes text[]; v_operator jsonb;
begin
  if not private.can_create_product(p_ws) then raise exception 'not permitted' using errcode = '42501'; end if;
  if length(v_name) not between 1 and 200 then
    raise exception 'a product needs a name of 1 to 200 characters' using errcode = '22023';
  end if;
  if p_stage is null or p_stage not in ('brief','in_development','active') then
    raise exception 'a new product starts as brief, in_development or active' using errcode = '22023';
  end if;
  if p_species is not null and p_species not in ('dog','cat','other') then
    raise exception 'species is dog, cat or other' using errcode = '22023';
  end if;
  if length(p_life_stage) > 100 or length(p_format) > 100 then
    raise exception 'life stage and format are at most 100 characters' using errcode = '22023';
  end if;
  v_operator := private.normalise_operator(p_operator);
  v_nodes := private.check_markets(p_ws, p_nodes);

  select f.family_id, f.created into v_family, v_new_family
  from private.family_for_product(p_ws, p_family, p_family_name, v_name) f;
  insert into app.products (workspace_id, family_id, name, stage, species, life_stage, format, operator)
  values (p_ws, v_family, v_name, p_stage, p_species, nullif(btrim(p_life_stage), ''), nullif(btrim(p_format), ''),
          v_operator)
  returning id into v_product;
  -- C01 step 3: each market starts not_assessed / unknown (the column defaults).
  insert into app.product_nodes (product_id, node_id, workspace_id)
  select v_product, n, p_ws from unnest(v_nodes) n;
  perform private.write_audit(p_ws, 'product.created', 'product', v_product::text, null,
    jsonb_strip_nulls(jsonb_build_object('name', v_name, 'family_id', v_family, 'new_family', v_new_family,
                                         'stage', p_stage, 'nodes', to_jsonb(v_nodes), 'source', 'form')));
  return v_product;
end $$;

-- ─── C02: a product created from an artwork ──────────────────────────────────────────────────────────────────────
-- The product exists before its artwork (the storage path names it), and products are never deleted, so the checks
-- register_artwork makes for a new artwork (BE-36 dunning, BE-32 allowance) run here first: a product is never made
-- for an artwork that would be refused. The browser then uploads and calls app.register_artwork as D01 does.
create function app.create_product_from_artwork(p_ws uuid, p_file_name text, p_family uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_status text; v_plan text; v_used int; v_allowed int; v_name text; v_family uuid; v_new_family boolean;
        v_product uuid;
begin
  if not private.can_create_product(p_ws) then raise exception 'not permitted' using errcode = '42501'; end if;
  select w.status, w.plan into v_status, v_plan from app.workspaces w where w.id = p_ws;
  if v_status in ('new_artwork_stopped','closed') then
    raise exception 'BE-36: new artworks are paused until payment is resolved; everything else keeps working'
      using errcode = 'P0036';
  end if;
  if v_plan = 'free' then
    select a.labels_used, a.labels_allowed into v_used, v_allowed from app.allowances a where a.workspace_id = p_ws;
    if coalesce(v_used, 0) >= coalesce(v_allowed, 0) then
      raise exception 'BE-32: all % free label artworks are used', coalesce(v_allowed, 0) using errcode = 'P0032';
    end if;
  end if;
  -- The provisional name: the file's name without its extension, separators as spaces.
  v_name := btrim(regexp_replace(regexp_replace(coalesce(p_file_name, ''), '\.[A-Za-z0-9]{1,5}$', ''), '[_\s]+', ' ', 'g'));
  if v_name = '' then v_name := 'Untitled label'; end if;
  v_name := left(v_name, 200);

  select f.family_id, f.created into v_family, v_new_family
  from private.family_for_product(p_ws, p_family, null, v_name) f;
  insert into app.products (workspace_id, family_id, name, stage)
  values (p_ws, v_family, v_name, 'in_development') returning id into v_product;
  perform private.write_audit(p_ws, 'product.created', 'product', v_product::text, null,
    jsonb_build_object('name', v_name, 'family_id', v_family, 'new_family', v_new_family, 'stage', 'in_development',
                       'nodes', '[]'::jsonb, 'source', 'artwork', 'provisional_name', true));
  return v_product;
end $$;

-- ─── C01 step 3 later: add markets to a product. Never consumes allowance (B02.must.1); idempotent. ───────────────
create function app.add_product_markets(p_product uuid, p_nodes text[]) returns int
language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_nodes text[]; v_added text[];
begin
  if not private.can_edit_product(p_product) then raise exception 'not permitted' using errcode = '42501'; end if;
  select pr.workspace_id into v_ws from app.products pr where pr.id = p_product;
  v_nodes := private.check_markets(v_ws, p_nodes);
  if exists (select 1 from unnest(v_nodes) n where not private.node_in_scope(v_ws, n)) then
    raise exception 'a market outside your scope' using errcode = '42501';
  end if;
  with ins as (
    insert into app.product_nodes (product_id, node_id, workspace_id)
    select p_product, n, v_ws from unnest(v_nodes) n
    on conflict (product_id, node_id) do nothing
    returning node_id)
  select coalesce(array_agg(node_id order by node_id), '{}') into v_added from ins;
  if cardinality(v_added) > 0 then
    perform private.write_audit(v_ws, 'product.markets_added', 'product', p_product::text, null,
                                jsonb_build_object('nodes', to_jsonb(v_added)));
  end if;
  return cardinality(v_added);
end $$;

-- ─── C04: change a product's stage. Reversible, dated and attributed; nothing is deleted (BE-13). ─────────────────
create function app.set_product_stage(p_product uuid, p_stage text, p_reason text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_family uuid; v_before text; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not private.can_edit_product(p_product) then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_stage is null or p_stage not in ('brief','in_development','active','discontinued') then
    raise exception 'stage is brief, in_development, active or discontinued' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then raise exception 'the reason is at most 500 characters' using errcode = '22023'; end if;
  select pr.workspace_id, pr.family_id, pr.stage into v_ws, v_family, v_before
  from app.products pr where pr.id = p_product for update;
  if v_before = p_stage then return p_stage; end if;
  -- Leaving discontinued can make a family a live recipe again: the same cap as a new family.
  if v_before = 'discontinued' and not exists (
       select 1 from app.products p where p.family_id = v_family and p.stage <> 'discontinued') then
    perform private.require_recipe_room(v_ws);
  end if;
  update app.products pr
  set stage = p_stage,
      discontinued_at = case when p_stage = 'discontinued' then now() end
  where pr.id = p_product;
  perform private.write_audit(v_ws, 'product.stage_changed', 'product', p_product::text,
                              jsonb_build_object('stage', v_before),
                              jsonb_strip_nulls(jsonb_build_object('stage', p_stage, 'reason', v_reason)));
  return p_stage;
end $$;

-- ─── B02: count a new artwork once; the free plan's last label sends the one email (docs/04, template 05) ─────────
create or replace function private.consume_allowance(p_artwork uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_new boolean; v_rows int; v_used int; v_allowed int; v_plan text;
begin
  select av.workspace_id, av.is_new_artwork into v_ws, v_new from app.artwork_versions av where av.id = p_artwork;
  if not coalesce(v_new, false) then return false; end if;
  insert into app.allowance_consumptions (artwork_version_id, workspace_id) values (p_artwork, v_ws)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    update app.allowances set labels_used = labels_used + 1, updated_at = now() where workspace_id = v_ws
    returning labels_used, labels_allowed into v_used, v_allowed;
    perform private.write_audit(v_ws, 'allowance.consumed', 'artwork_version', p_artwork::text, null,
                                jsonb_build_object('labels_used', v_used, 'labels_allowed', v_allowed));
    select w.plan into v_plan from app.workspaces w where w.id = v_ws;
    if v_plan = 'free' and v_used >= v_allowed then
      perform private.enqueue('notify', v_ws, 'allowance:' || v_ws::text, jsonb_build_object('template', 'allowance_used'));
    end if;
  end if;
  return v_rows = 1;
end $$;

-- ─── Grants ──────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function private.can_create_product(uuid), private.live_recipes(uuid), private.require_recipe_room(uuid),
  private.normalise_operator(jsonb), private.check_markets(uuid, text[]),
  private.family_for_product(uuid, uuid, text, text) from public, anon;
grant execute on function private.can_create_product(uuid), private.live_recipes(uuid), private.require_recipe_room(uuid),
  private.normalise_operator(jsonb), private.check_markets(uuid, text[]),
  private.family_for_product(uuid, uuid, text, text) to authenticated, service_role;

revoke all on function app.create_product(uuid, text, uuid, text, text, text, text, text, jsonb, text[]),
  app.create_product_from_artwork(uuid, text, uuid), app.add_product_markets(uuid, text[]),
  app.set_product_stage(uuid, text, text) from public, anon;
grant execute on function app.create_product(uuid, text, uuid, text, text, text, text, text, jsonb, text[]),
  app.create_product_from_artwork(uuid, text, uuid), app.add_product_markets(uuid, text[]),
  app.set_product_stage(uuid, text, text) to authenticated, service_role;
