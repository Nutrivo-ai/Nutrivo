-- Incident #274 · app.request_check and app.request_envelope checked only private.can_edit_product (family scope and
-- role), never market scope. A member scoped to some markets could queue checks and envelopes for markets they cannot
-- read, and then could not read their own job (the T-409 jobs policy). Founder decision on #274 (ar835, 18 Nov 2026):
-- - Q1 · request_check with an explicit p_nodes: every node in the caller's market scope (private.node_in_scope;
--   42501, judged first) and one of the product's app.product_nodes (22023), as app.add_product_markets. The list is
--   taken whole or refused, never partly queued. It is de-duplicated and sorted, so it keys the same job as the same
--   markets asked for with no list.
-- - Q2 · request_check with p_nodes null (what the web sends): the product's markets in the caller's scope; 42501
--   when none is. 22023 (the product has no markets) only for a caller whose market scope is unrestricted, so a scoped
--   caller cannot tell a product with no markets from one whose markets are all hidden from them.
-- - Q3 · request_envelope: 42501 unless every market of the product is in the caller's scope. The envelope still
--   covers every market of the product (docs/03: app.envelopes.node_ids, the product's markets), so its inputs_hash and
--   app.envelope_inputs_hash are unchanged.
-- Same signatures: create or replace keeps the grants, re-stated below. Tests:
-- supabase/tests/app/99_market_scope_check_envelope.test.sql.

-- ─── 1 · private.markets_in_scope: the product's markets the caller can see, in order ───────────────────────────
create function private.markets_in_scope(p_product uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(pn.node_id order by pn.node_id), '{}')
  from app.product_nodes pn
  where pn.product_id = p_product and private.node_in_scope(pn.workspace_id, pn.node_id)
$$;
revoke all on function private.markets_in_scope(uuid) from public, anon, authenticated;
grant execute on function private.markets_in_scope(uuid) to service_role;

-- ─── 2 · private.market_scope_unrestricted: the caller sees every market of the workspace ──────────────────────
create function private.market_scope_unrestricted(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app.memberships m join app.people p on p.id = m.person_id
    where m.workspace_id = ws and p.user_id = auth.uid() and m.ended_at is null
      and (m.access_ends_at is null or m.access_ends_at > now()) and m.scope_node_ids is null)
$$;
revoke all on function private.market_scope_unrestricted(uuid) from public, anon, authenticated;
grant execute on function private.market_scope_unrestricted(uuid) to service_role;

-- ─── 3 · private.request_markets: which markets a check request of this caller covers, or the refusal ─────────────
-- Called after the role and family check. p_nodes null: the caller's markets of the product (Q2). p_nodes given:
-- exactly that list, de-duplicated and sorted, every node in scope (42501, first) and a market of the product (22023).
create function private.request_markets(p_product uuid, p_nodes text[]) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v_ws uuid; v_nodes text[];
begin
  select pr.workspace_id into v_ws from app.products pr where pr.id = p_product;
  if p_nodes is null then
    v_nodes := private.markets_in_scope(p_product);
    if cardinality(v_nodes) > 0 then return v_nodes; end if;
    if private.market_scope_unrestricted(v_ws) then
      raise exception 'this product has no markets' using errcode = '22023';
    end if;
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(p_nodes) n where n is not null and not private.node_in_scope(v_ws, n)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if cardinality(p_nodes) = 0
     or exists (select 1 from unnest(p_nodes) n
                where n is null or not exists (select 1 from app.product_nodes pn
                                               where pn.product_id = p_product and pn.node_id = n)) then
    raise exception 'every node must be one of the product''s markets' using errcode = '22023';
  end if;
  return array(select distinct n from unnest(p_nodes) n order by n);
end $$;
revoke all on function private.request_markets(uuid, text[]) from public, anon, authenticated;
grant execute on function private.request_markets(uuid, text[]) to service_role;

-- ─── 4 · app.request_check ──────────────────────────────────────────────────────────────────────────────────────
-- Body of 20261108121337 with the market rule above before anything else is read, a tombstoned person refused as in
-- app.request_envelope, and the audit event check.requested (job, markets) that it never wrote.
create or replace function app.request_check(p_product uuid, p_nodes text[] default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_av uuid; v_sha text; v_ruleset text; v_class uuid; v_nodes text[]; v_formula text; v_job uuid;
begin
  if private.person_id() is null or not private.can_edit_product(p_product) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  v_nodes := private.request_markets(p_product, p_nodes);
  select pr.workspace_id into v_ws from app.products pr where pr.id = p_product;
  select av.id, av.file_sha256 into v_av, v_sha from app.artwork_versions av
  where av.product_id = p_product order by av.version desc limit 1;
  if v_av is null then raise exception 'this product has no artwork to check yet' using errcode = 'P0002'; end if;
  select rv.id into v_ruleset from ref.ruleset_versions rv order by rv.released_at desc limit 1;
  if v_ruleset is null then raise exception 'no ruleset has been released' using errcode = 'P0003'; end if;
  select c.id into v_class from app.classifications c where c.product_id = p_product order by c.created_at desc limit 1;
  v_formula := private.formula_digest(p_product);
  v_job := private.enqueue('check', v_ws,
    format('check:%s:%s:%s:%s:%s:%s', p_product, v_sha, v_ruleset, coalesce(v_class::text, '-'),
           array_to_string(v_nodes, ','), v_formula),
    jsonb_build_object('product_id', p_product, 'artwork_version_id', v_av, 'ruleset_version', v_ruleset,
                       'classification_id', v_class, 'node_ids', to_jsonb(v_nodes), 'formula_digest', v_formula));
  perform private.write_audit(v_ws, 'check.requested', 'product', p_product::text, null,
                              jsonb_build_object('job_id', v_job, 'node_ids', to_jsonb(v_nodes)), v_ruleset);
  return v_job;
end $$;
revoke execute on function app.request_check(uuid, text[]) from public, anon;
grant execute on function app.request_check(uuid, text[]) to authenticated;

-- ─── 5 · app.request_envelope ───────────────────────────────────────────────────────────────────────────────────
-- Body of 20261114132715 with Q3 as part of the permission check: any market of the product outside the caller's scope
-- is 42501. The rest is unchanged: the envelope, its inputs_hash and the payload's node_ids cover every market of the
-- product (22023 when it has none). The audit now also records the markets.
create or replace function app.request_envelope(p_product uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_ruleset text; v_nodes text[]; v_hash text; v_formula text; v_key text; v_job app.jobs;
        v_id uuid; v_rid text;
begin
  if private.person_id() is null or not private.can_edit_product(p_product)
     or exists (select 1 from app.product_nodes pn
                where pn.product_id = p_product and not private.node_in_scope(pn.workspace_id, pn.node_id)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  select pr.workspace_id into v_ws from app.products pr where pr.id = p_product;
  select rv.id into v_ruleset from ref.ruleset_versions rv order by rv.released_at desc limit 1;
  if v_ruleset is null then raise exception 'no ruleset has been released' using errcode = 'P0003'; end if;
  v_nodes := array(select pn.node_id from app.product_nodes pn where pn.product_id = p_product order by pn.node_id);
  if coalesce(array_length(v_nodes, 1), 0) = 0 then
    raise exception 'this product has no markets' using errcode = '22023';
  end if;
  v_hash := private.envelope_inputs_hash(p_product, v_nodes);
  v_formula := private.formula_digest(p_product);
  v_key := format('envelope:%s:%s:%s', p_product, v_ruleset, v_hash);

  select * into v_job from app.jobs j where j.idempotency_key = v_key for update;
  if found and v_job.status in ('failed', 'cancelled', 'succeeded')
     and not exists (select 1 from app.envelopes e where e.product_id = p_product and e.ruleset_version = v_ruleset
                                                     and e.inputs_hash = v_hash) then
    v_rid := private.request_id();
    update app.jobs j
    set status = 'queued', attempts = 0, last_error = null, progress = '{}'::jsonb, updated_at = now(),
        payload = (j.payload - 'request_id')
                  || case when v_rid is null then '{}'::jsonb else jsonb_build_object('request_id', v_rid) end
    where j.id = v_job.id;
    if to_regnamespace('pgmq') is not null then
      execute format('select pgmq.send(%L, %L::jsonb)', 'envelope', jsonb_build_object('job_id', v_job.id)::text);
    end if;
    v_id := v_job.id;
  else
    v_id := private.enqueue('envelope', v_ws, v_key,
      jsonb_build_object('product_id', p_product, 'ruleset_version', v_ruleset, 'inputs_hash', v_hash,
                         'node_ids', to_jsonb(v_nodes), 'formula_digest', v_formula));
  end if;
  perform private.write_audit(v_ws, 'envelope.requested', 'product', p_product::text,
                              case when v_job.id is not null then jsonb_build_object('status', v_job.status) end,
                              jsonb_build_object('job_id', v_id, 'inputs_hash', v_hash, 'node_ids', to_jsonb(v_nodes)),
                              v_ruleset);
  return v_id;
end $$;
revoke execute on function app.request_envelope(uuid) from public, anon;
grant execute on function app.request_envelope(uuid) to authenticated;
