-- Incident #315: the board of a 300-recipe workspace misses its p95 budget (spec/nfr.yaml
-- performance.board_300_recipes_p95_ms). The board called app.rollup_state once per product × region, ~300 PostgREST
-- round trips per page. app.board_rollup is the set-returning roll-up decided on #56 (Q4, Q5, 7 Nov 2026): every
-- region roll-up of a workspace's board in one call, plus the worst state of each product across its regions
-- (S-MOB-001). BE-15: the roll-up stays in the database, with app.rollup_state's order
-- (blocked > action > not_assessed > clear, D-06).
--
-- The root cause of the time in the database is private.can_see_product, which every read policy on products,
-- product_nodes, checks and check_findings calls once per row: a SQL function calling another security-definer SQL
-- function (private.family_in_scope) inside its query. Neither can be inlined, so the inner call was set up and
-- planned again on every outer call (~130 µs a row; 905 product_nodes rows took 120 ms in this helper alone, against
-- 11 ms for the same predicate written out). It is rewritten below with family_in_scope's predicate written out for
-- the product's own workspace and family: the same rows answer true, no policy changes, and pgTAP
-- (supabase/tests/app/99_board_rollup.test.sql) checks it against the composed form for every person and product.
--
-- security invoker: the caller's RLS on app.products and app.product_nodes decides which products and markets are
-- rolled up, exactly as each app.rollup_state call did (a family- or market-scoped member rolls up only what they
-- see). No table, view or grant on tenant data is added.

create or replace function private.can_see_product(pid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  -- = exists (product pid with private.family_in_scope(pr.workspace_id, pr.family_id)), written out (see above).
  select exists (
    select 1 from app.products pr
    join app.memberships m on m.workspace_id = pr.workspace_id
    join app.people p on p.id = m.person_id
    where pr.id = pid and p.user_id = auth.uid() and m.ended_at is null
      and (m.access_ends_at is null or m.access_ends_at > now())
      and (m.scope_family_ids is null or pr.family_id = any(m.scope_family_ids)))
$$;

create function app.board_rollup(p_workspace uuid)
returns table (product_id uuid, region_id text, state text, product_state text)
language sql stable security invoker set search_path = '' as $$
  with nodes as (
    -- The markets on the board: the workspace's products that are not discontinued (F01 step 3), under RLS.
    select pn.product_id, pn.node_id, j.parent_id, pn.display_state
    from app.product_nodes pn
    join app.products p on p.id = pn.product_id
    join ref.jurisdictions j on j.id = pn.node_id
    where pn.workspace_id = p_workspace and p.workspace_id = p_workspace and p.stage <> 'discontinued'),
  pairs as (
    -- Each region a product is sold in through one of its markets, as the board groups its columns.
    select distinct n.product_id, n.parent_id as region_id from nodes n where n.parent_id is not null),
  regions as (
    -- app.rollup_state(product, region): the region's own row and its markets'. Clear only when every one is clear,
    -- so a state outside the four never rolls up to Clear.
    select pr.product_id, pr.region_id,
      case when bool_or(n.display_state = 'blocked') then 'blocked'
           when bool_or(n.display_state = 'action') then 'action'
           when bool_and(n.display_state is not distinct from 'clear') then 'clear'
           else 'not_assessed' end as state
    from pairs pr
    join nodes n on n.product_id = pr.product_id and (n.node_id = pr.region_id or n.parent_id = pr.region_id)
    group by pr.product_id, pr.region_id)
  select r.product_id, r.region_id, r.state,
    case when bool_or(r.state = 'blocked') over w then 'blocked'
         when bool_or(r.state = 'action') over w then 'action'
         when bool_and(r.state = 'clear') over w then 'clear'
         else 'not_assessed' end as product_state
  from regions r
  window w as (partition by r.product_id)
  order by r.product_id, r.region_id
$$;

comment on function app.board_rollup(uuid) is
  'BE-15 for the board (F01, S-NV2-006; S-MOB-001): app.rollup_state for every product × region of a workspace, '
  'and each product''s worst state across its regions, in one call under the caller''s RLS.';

revoke all on function app.board_rollup(uuid) from public, anon;
grant execute on function app.board_rollup(uuid) to authenticated, service_role;
