-- T-1002 · E02 Compute the compliance envelope: what a brief must carry, may say and must stay within, per market and
-- language, from the accepted rules of the latest released ruleset only (docs/05 §The envelope, docs/04).
-- Additive (expand only): columns on app.envelopes and app.envelope_items (both empty until now), a new
-- app.envelope_nodes, guard triggers, insert-only enforcement, job kind 'envelope' and app.request_envelope.
-- Honesty as D04 (E02.must.1): anything not encoded is a not_assessed item with its gap_id or rule_key and a reason;
-- a market is 'clear' only when it is fully encoded and nothing for it was withheld (P0021, as private.verdict_guard).
-- Nutrient adequacy is out of scope until FEDIAF is licensed (E02.must.2): every envelope says so, and the schema
-- refuses one that does not. Tests: supabase/tests/app/98_compliance_envelope.test.sql.

-- ─── 1 · app.envelopes: what the envelope was computed from ─────────────────────────────────────────────────────
alter table app.envelopes
  add column job_id         uuid references app.jobs(id),
  add column formula_digest text,
  add column node_ids       text[] not null default '{}',
  add column out_of_scope   text[] not null default '{nutrient_adequacy}',
  add constraint envelopes_nutrient_adequacy_out_of_scope check ('nutrient_adequacy' = any(out_of_scope));
create unique index envelopes_one_per_job on app.envelopes(job_id) where job_id is not null;
create index envelopes_product on app.envelopes(product_id, created_at desc);
comment on column app.envelopes.out_of_scope is
  'E02.must.2: what this envelope never answers. Nutrient adequacy stays out of scope until FEDIAF is licensed (D-10).';

-- ─── 2 · app.envelope_items: one requirement, permission, limit, obligation or withheld item per market × language ─
alter table app.envelope_items
  add column node_id      text references ref.jurisdictions(id),
  add column language     text,
  add column rule_version int,
  add column reason_code  text,
  add column citation     text,
  add constraint envelope_items_withheld_honestly check (
    (kind = 'not_assessed') = (provenance = 'not_assessed')
    and (kind = 'not_assessed') = (reason_code is not null)),
  add constraint envelope_items_versioned check (rule_key is null or rule_version is not null);
create index envelope_items_envelope on app.envelope_items(envelope_id);

-- The model never decides coverage or produces an envelope item (non-negotiable 6): no model_judgement until a claim
-- judgement has a harness source (#209 Q1). A later task relaxes this with its own tests.
alter table app.envelope_items add constraint envelope_items_no_model check (provenance <> 'model_judgement');

-- ─── 3 · app.envelope_nodes: the envelope's answer per market ───────────────────────────────────────────────────
create table app.envelope_nodes (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references app.workspaces(id),
  product_id    uuid not null references app.products(id),
  envelope_id   uuid not null references app.envelopes(id),
  node_id       text not null references ref.jurisdictions(id),
  state         text not null check (state in ('clear','action','not_assessed')),
  open_items    int  not null default 0 check (open_items >= 0),
  withheld      int  not null default 0 check (withheld >= 0),
  created_at    timestamptz not null default now(),
  unique (envelope_id, node_id)
);
alter table app.envelope_nodes enable row level security;
create policy read_scoped on app.envelope_nodes for select to authenticated
  using (private.can_see_product(product_id) and private.node_in_scope(workspace_id, node_id));
revoke all on app.envelope_nodes from public, anon;
grant select on app.envelope_nodes to authenticated;
grant select, insert on app.envelope_nodes to service_role;

-- ─── 4 · Guards ─────────────────────────────────────────────────────────────────────────────────────────────────
-- An item or node row belongs to its envelope's product and workspace (the read policy is single-table).
create function private.envelope_child_guard() returns trigger
language plpgsql set search_path = '' as $$
declare v_e app.envelopes;
begin
  select * into v_e from app.envelopes e where e.id = new.envelope_id;
  if v_e.id is null or v_e.product_id <> new.product_id or v_e.workspace_id <> new.workspace_id then
    raise exception 'an envelope row belongs to its envelope''s product and workspace' using errcode = '23514';
  end if;
  if new.node_id is not null and not (new.node_id = any(v_e.node_ids)) then
    raise exception 'market % is not one the envelope was computed for', new.node_id using errcode = '23514';
  end if;
  return new;
end $$;
create trigger envelope_child_guard before insert on app.envelope_items
  for each row execute function private.envelope_child_guard();
create trigger envelope_child_guard before insert on app.envelope_nodes
  for each row execute function private.envelope_child_guard();

-- E02.must.1, BE-21 for envelopes: a market is clear only when all six coverage domains are complete in the
-- envelope's ruleset, nothing for it was withheld, and something was actually answered for it. The worker writes the
-- items before the node rows, in one transaction.
create function private.envelope_verdict_guard() returns trigger
language plpgsql set search_path = '' as $$
declare v_ruleset text;
begin
  if new.state = 'clear' then
    select e.ruleset_version into v_ruleset from app.envelopes e where e.id = new.envelope_id;
    if not private.node_fully_encoded(v_ruleset, new.node_id)
       or exists (select 1 from app.envelope_items i
                  where i.envelope_id = new.envelope_id and i.node_id = new.node_id and i.kind = 'not_assessed')
       or not exists (select 1 from app.envelope_items i
                      where i.envelope_id = new.envelope_id and i.node_id = new.node_id and i.kind <> 'not_assessed') then
      raise exception 'BE-21: no rule, no verdict: % is not fully answered in ruleset %, so its envelope cannot be clear',
        new.node_id, v_ruleset using errcode = 'P0021';
    end if;
  end if;
  return new;
end $$;
create trigger envelope_verdict_guard before insert on app.envelope_nodes
  for each row execute function private.envelope_verdict_guard();

-- Insert-only (BE-05): an envelope is pinned evidence of what a brief was told; a new input is a new envelope.
do $$
declare t text;
begin
  foreach t in array array['app.envelopes','app.envelope_items','app.envelope_nodes'] loop
    execute format('revoke update, delete, truncate on %s from authenticated, service_role, anon', t);
    execute format('create trigger insert_only_row before update or delete on %s for each row execute function private.reject_mutation()', t);
    execute format('create trigger insert_only_truncate before truncate on %s for each statement execute function private.reject_mutation()', t);
  end loop;
end $$;

-- ─── 5 · Job kind 'envelope' (expand) ───────────────────────────────────────────────────────────────────────────
alter table app.jobs drop constraint jobs_kind_check;
alter table app.jobs add constraint jobs_kind_check
  check (kind in ('extract','check','recheck','bulk_recheck','report','export','notify','session_revoke','diff_fanout',
                  'billing_sync','billing_reconcile','recipe_overage','dunning','scan','envelope')) not valid;
alter table app.jobs validate constraint jobs_kind_check;
do $$
begin
  if to_regnamespace('pgmq') is not null then
    perform pgmq.create('envelope');
  end if;
end $$;

-- ─── 6 · private.envelope_inputs_hash: what an envelope of this product would be computed from ──────────────────
-- The formula (private.formula_digest), the intended claims per language, the facts (the latest classification when
-- it is confirmed, else the species, life stage and format a person entered at C01) and the markets. Any change to
-- one of them is a new hash, so a new envelope; the same inputs return the cached one (E02 step 3).
create function private.envelope_inputs_hash(p_product uuid, p_nodes text[]) returns text
language sql stable set search_path = '' as $$
  select md5(jsonb_build_array(
    private.formula_digest(p_product),
    (select coalesce(jsonb_agg(jsonb_build_array(c.language, c.claim_text) order by c.language, c.created_at, c.id),
                     '[]'::jsonb)
       from app.intended_claims c where c.product_id = p_product),
    (select case when cl.confirmed_at is not null then cl.id end
       from app.classifications cl where cl.product_id = p_product order by cl.created_at desc, cl.id desc limit 1),
    (select jsonb_build_array(pr.species, pr.life_stage, pr.format) from app.products pr where pr.id = p_product),
    to_jsonb(p_nodes))::text)
$$;
revoke all on function private.envelope_inputs_hash(uuid, text[]) from public, anon, authenticated;
grant execute on function private.envelope_inputs_hash(uuid, text[]) to service_role;

-- ─── 7 · app.request_envelope: an editor asks for the brief's envelope ──────────────────────────────────────────
-- Who: an editor of the product (private.can_edit_product), as app.request_check; anyone else is 42501. The latest
-- released ruleset (P0003 when none). The markets are the product's. One job per (product, ruleset, inputs_hash): a
-- second request with the same inputs returns the same job, and so the cached envelope. No artwork is needed: a brief
-- is screened before it has one. Payload: ids and digests only. Audited envelope.requested.
create function app.request_envelope(p_product uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_ruleset text; v_nodes text[]; v_hash text; v_formula text; v_job uuid;
begin
  if private.person_id() is null or not private.can_edit_product(p_product) then
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
  v_job := private.enqueue('envelope', v_ws, format('envelope:%s:%s:%s', p_product, v_ruleset, v_hash),
    jsonb_build_object('product_id', p_product, 'ruleset_version', v_ruleset, 'inputs_hash', v_hash,
                       'node_ids', to_jsonb(v_nodes), 'formula_digest', v_formula));
  perform private.write_audit(v_ws, 'envelope.requested', 'product', p_product::text, null,
                              jsonb_build_object('job_id', v_job, 'inputs_hash', v_hash), v_ruleset);
  return v_job;
end $$;
revoke execute on function app.request_envelope(uuid) from public, anon;
grant execute on function app.request_envelope(uuid) to authenticated;
