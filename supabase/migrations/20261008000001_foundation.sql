-- 0001 · Foundation: schemas, extensions, people and tenancy.
-- Design sources: Handoff to Alex §02, Backend Action Register P0 (BE-01..BE-06), Workflow Register A·B.
-- Naming: docs/03-data-model.md. Never edit an applied migration; add a new one.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

create schema if not exists app;      -- tenant data, RLS on every table (BE-01, BE-02)
create schema if not exists ref;      -- shared, versioned reference data (BE-01)
create schema if not exists private;  -- helper functions; never exposed through the API

comment on schema app is 'Tenant data. RLS on every table, keyed to workspace_id (BE-01, BE-02).';
comment on schema ref is 'Shared, versioned reference data: jurisdictions, rules, coverage, terms, obligations (BE-01).';
comment on schema private is 'Helper and guard functions. Not exposed through PostgREST.';

-- People are kept apart from auth.users so a GDPR erasure can tombstone identity
-- while insert-only records keep a stable actor_id (BE-05, BE-06).
create table app.people (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid unique references auth.users(id) on delete set null,
  display_name  text not null,
  email         extensions.citext,
  tombstoned_at timestamptz,
  created_at    timestamptz not null default now()
);

create table app.workspaces (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(name) between 1 and 200),
  entitled_regions text[] not null default '{EU}',   -- purchased regulatory regions (EU, UK, US); hosting is always EU
  plan             text not null default 'free' check (plan in ('free','basic','standard','advanced','partner')),
  status           text not null default 'active'
                   check (status in ('active','dunning','new_artwork_stopped','dormant','closed')),  -- BE-36
  default_operator jsonb,                            -- B01: business responsible for labelling
  sso_policy       text not null default 'off' check (sso_policy in ('off','optional','required')),
  created_by       uuid references app.people(id),
  created_at       timestamptz not null default now()
);

create table app.memberships (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references app.workspaces(id),
  person_id        uuid not null references app.people(id),
  role             text not null check (role in ('admin','portfolio_manager','editor','viewer')),  -- BE-03: four roles
  is_external      boolean not null default false,
  scope_family_ids uuid[],          -- null = every family
  scope_node_ids   text[],          -- null = every market node; a region id covers its children
  access_ends_at   timestamptz,     -- BE-03: past this the membership returns no rows
  ended_at         timestamptz,
  ended_reason     text,
  created_at       timestamptz not null default now()
);
create unique index memberships_one_active on app.memberships(workspace_id, person_id) where ended_at is null;
create index memberships_person on app.memberships(person_id);

create table app.invitations (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references app.workspaces(id),
  email            extensions.citext not null,
  role             text not null check (role in ('admin','portfolio_manager','editor','viewer')),
  is_external      boolean not null default false,
  scope_family_ids uuid[],
  scope_node_ids   text[],
  access_ends_at   timestamptz,
  token_hash       bytea unique,    -- set by the worker when the email is sent; the raw token never touches the database
  expires_at       timestamptz not null default now() + interval '7 days',
  invited_by       uuid not null references app.people(id),
  accepted_at      timestamptz,
  revoked_at       timestamptz,
  created_at       timestamptz not null default now()
);
create unique index invitations_one_pending on app.invitations(workspace_id, email)
  where accepted_at is null and revoked_at is null;
