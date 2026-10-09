-- 0003 · Tenant tables: products, artwork, checks, artefacts, documents, billing mirrors, jobs, audit.
-- Workflow Register domains C D E F G H I J M O; BE-13..BE-36. product_id/node_id are denormalised onto child
-- tables on purpose: RLS policies stay single-table and fast (see 0004).

create table app.signing_grants (                -- BE-04: rows, never implied by role
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces(id),
  person_id    uuid not null references app.people(id),
  node_id      text not null references ref.jurisdictions(id),
  granted_by   uuid not null references app.people(id),
  granted_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  revoked_by   uuid references app.people(id)
);
create unique index signing_grants_one_active on app.signing_grants(workspace_id, person_id, node_id) where revoked_at is null;

create table app.families (                      -- the billing unit: a recipe (Handoff §04)
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references app.workspaces(id),
  name            text not null,
  discontinued_at timestamptz,
  created_at      timestamptz not null default now()
);

create table app.products (                      -- BE-13: lifecycle, never deleted
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references app.workspaces(id),
  family_id       uuid not null references app.families(id),
  name            text not null,
  stage           text not null default 'brief' check (stage in ('brief','in_development','active','discontinued')),
  species         text check (species in ('dog','cat','other')),
  life_stage      text,
  format          text,                            -- dry, wet, treat, supplement ...
  operator        jsonb,                           -- overrides workspaces.default_operator
  discontinued_at timestamptz,
  created_at      timestamptz not null default now(),
  check ((stage = 'discontinued') = (discontinued_at is not null))
);
create index products_workspace on app.products(workspace_id);
create index products_family on app.products(family_id);

create table app.product_nodes (                 -- product × market (Handoff: product_market). BE-14
  product_id         uuid not null references app.products(id),
  node_id            text not null references ref.jurisdictions(id),
  workspace_id       uuid not null references app.workspaces(id),
  label_state        text not null default 'not_assessed' check (label_state in ('clear','action','not_assessed')),
  registration_state text not null default 'unknown'
                     check (registration_state in ('not_required','registered','not_registered','expired','unknown')),
  display_state      text generated always as (
                       case when registration_state in ('not_registered','expired') then 'blocked'
                            when label_state = 'clear' and registration_state = 'unknown' then 'not_assessed'
                            else label_state end) stored,
  ruleset_version    text references ref.ruleset_versions(id),
  open_actions       int  not null default 0 check (open_actions >= 0),
  last_check_job_id  uuid,
  updated_at         timestamptz not null default now(),
  primary key (product_id, node_id)
);
create index product_nodes_workspace on app.product_nodes(workspace_id);

create table app.formula_lines (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references app.workspaces(id),
  product_id        uuid not null references app.products(id),
  position          int  not null,
  ingredient        text not null,
  percent           numeric(7,3),
  feed_material_ref text references ref.feed_materials(number),
  additive_ref      text references ref.feed_additives(id),
  amount            numeric,
  unit              text,
  applied_by        uuid references app.people(id),   -- E03: a person applies, never the model
  created_at        timestamptz not null default now()
);

create table app.intended_claims (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces(id),
  product_id   uuid not null references app.products(id),
  language     text not null,
  claim_text   text not null,
  created_at   timestamptz not null default now()
);

create table app.jobs (                          -- job state; pgmq carries only {job_id}
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid references app.workspaces(id),
  kind            text not null check (kind in ('extract','check','recheck','bulk_recheck','report','export',
                                                'notify','session_revoke','diff_fanout')),
  idempotency_key text not null unique,
  status          text not null default 'queued' check (status in ('queued','running','succeeded','failed','cancelled')),
  payload         jsonb not null default '{}',       -- never secrets: members can read their jobs
  progress        jsonb not null default '{}',
  attempts        int  not null default 0,
  last_error      text,
  requested_by    uuid references app.people(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index jobs_workspace on app.jobs(workspace_id, created_at desc);

create table app.artwork_versions (              -- BE-16
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references app.workspaces(id),
  product_id     uuid not null references app.products(id),
  version        int  not null check (version >= 1),
  file_sha256    text not null,
  storage_path   text not null,
  file_name      text,
  mime_type      text,
  page_count     int,
  page_size_mm   numeric[],
  is_new_artwork boolean not null,                 -- BE-32: only a product's first artwork counts
  uploaded_by    uuid references app.people(id),
  created_at     timestamptz not null default now(),
  unique (product_id, version),
  unique (product_id, file_sha256)
);

create table app.extraction_runs (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references app.workspaces(id),
  product_id         uuid not null references app.products(id),
  artwork_version_id uuid not null references app.artwork_versions(id),
  engine             text not null,
  engine_version     text not null,
  status             text not null default 'queued' check (status in ('queued','running','succeeded','partial','failed')),
  failure_codes      text[] not null default '{}',
  idempotency_key    text not null unique,
  started_at         timestamptz,
  finished_at        timestamptz,
  created_at         timestamptz not null default now()
);

create table app.artwork_panels (                -- one row per printed panel (BE-16); typed failures (BE-18)
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references app.workspaces(id),
  product_id          uuid not null references app.products(id),
  artwork_version_id  uuid not null references app.artwork_versions(id),
  extraction_run_id   uuid not null references app.extraction_runs(id),
  page                int  not null,
  panel_index         int  not null,
  bbox_mm             numeric[] not null check (array_length(bbox_mm, 1) = 4),  -- [x0,y0,x1,y1], top-left origin
  language            text,
  language_confidence numeric,
  status              text not null check (status in ('extracted','not_assessable')),
  failure_code        text check (failure_code in ('outlined_text','rasterised','missing_font','colour_space',
                                                   'no_true_scale','unreadable')),
  created_at          timestamptz not null default now(),
  check ((status = 'not_assessable') = (failure_code is not null))
);

create table app.text_objects (                  -- BE-17: both heights, always
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references app.workspaces(id),
  product_id     uuid not null references app.products(id),
  panel_id       uuid not null references app.artwork_panels(id),
  text           text not null,
  bbox_mm        numeric[] not null check (array_length(bbox_mm, 1) = 4),
  font_name      text,
  font_size_pt   numeric,
  x_height_mm    numeric,
  cap_height_mm  numeric,
  is_ocr         boolean not null default false,
  confidence     numeric,
  reading_order  int
);
create index text_objects_panel on app.text_objects(panel_id);

create table app.classifications (               -- BE-19: cited determination; insert-only, latest row wins
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references app.workspaces(id),
  product_id    uuid not null references app.products(id),
  species       text,
  life_stage    text,
  product_class text check (product_class in ('complete','complementary','treat','mineral','dietetic','other')),
  intended_use  text,
  parnut_status text,
  citation      text not null,
  provenance    text not null check (provenance in ('deterministic_rule','model_judgement','person')),
  confirmed_by  uuid references app.people(id),
  confirmed_at  timestamptz,
  model_call_id uuid,
  created_at    timestamptz not null default now()
);

create table app.checks (                        -- check event: one per product × node × language panel. Append-only.
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references app.workspaces(id),
  job_id             uuid references app.jobs(id),
  product_id         uuid not null references app.products(id),
  node_id            text not null references ref.jurisdictions(id),
  artwork_version_id uuid references app.artwork_versions(id),
  panel_id           uuid references app.artwork_panels(id),
  language           text,
  artwork_sha        text,
  ruleset_version    text not null references ref.ruleset_versions(id),
  classification_id  uuid references app.classifications(id),
  label_state        text not null check (label_state in ('clear','action','not_assessed')),
  applied_rule_keys  text[] not null default '{}',     -- BE-23: three first-class arrays
  passed_rule_keys   text[] not null default '{}',
  withheld_rule_keys text[] not null default '{}',
  actor_id           uuid references app.people(id),
  actor_is_external  boolean not null default false,    -- BE-06: stamped at write time
  trigger            text not null default 'user' check (trigger in ('user','revision','recheck','bulk','rule_diff')),
  at                 timestamptz not null default now(),
  check (passed_rule_keys <@ applied_rule_keys),
  check (not (applied_rule_keys && withheld_rule_keys)),
  check (label_state <> 'clear' or (cardinality(withheld_rule_keys) = 0
                                    and cardinality(applied_rule_keys) > 0
                                    and passed_rule_keys @> applied_rule_keys))
);
create index checks_applied on app.checks using gin (applied_rule_keys);
create index checks_withheld on app.checks using gin (withheld_rule_keys);
create index checks_latest on app.checks(product_id, node_id, at desc);

create table app.check_findings (                -- append-only; provenance is a field, never inferred (Handoff §01)
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references app.workspaces(id),
  check_id           uuid not null references app.checks(id),
  product_id         uuid not null references app.products(id),
  node_id            text not null references ref.jurisdictions(id),
  rule_key           text,
  rule_version       int,
  gap_id             text references ref.coverage_gaps(gap_id),
  state              text not null check (state in ('action','not_assessed','info')),
  kind               text not null default 'label' check (kind in ('label','registration','geometry','classification')),
  provenance         text not null check (provenance in ('deterministic_rule','model_judgement',
                                                         'authored_definition','not_assessed')),
  citation           text,
  message            text not null,
  recommended_action text,
  panel_id           uuid references app.artwork_panels(id),
  language           text,
  text_object_id     uuid references app.text_objects(id),
  bbox_mm            numeric[],
  measured_mm        numeric,
  required_mm        numeric,
  height_definition  text check (height_definition in ('x_height','cap_height','figure_height')),
  reason_code        text,
  confidence         numeric check (confidence between 0 and 1),
  model_call_id      uuid,
  created_at         timestamptz not null default now(),
  check (rule_key is not null or gap_id is not null),
  check ((state = 'not_assessed') = (provenance = 'not_assessed')),
  check (state <> 'not_assessed' or reason_code is not null),
  check (reason_code is null
         or reason_code not in ('not_encoded','partially_encoded','out_of_scope','pending_acceptance')
         or gap_id is not null),
  check (provenance <> 'model_judgement' or (confidence is not null and model_call_id is not null))
);
create index check_findings_check on app.check_findings(check_id);

create table app.envelopes (                     -- E02: what a brief may say and must carry
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references app.workspaces(id),
  product_id      uuid not null references app.products(id),
  ruleset_version text not null references ref.ruleset_versions(id),
  inputs_hash     text not null,
  created_at      timestamptz not null default now(),
  unique (product_id, ruleset_version, inputs_hash)
);

create table app.envelope_items (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces(id),
  product_id   uuid not null references app.products(id),
  envelope_id  uuid not null references app.envelopes(id),
  kind         text not null check (kind in ('requirement','permitted','prohibited','limit','obligation','not_assessed')),
  rule_key     text,
  gap_id       text references ref.coverage_gaps(gap_id),
  provenance   text not null check (provenance in ('deterministic_rule','model_judgement','authored_definition','not_assessed')),
  payload      jsonb not null default '{}',
  check (rule_key is not null or gap_id is not null)
);

create table app.reports (                       -- documents: pinned, unguessable reference, insert-only (BE-26)
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references app.workspaces(id),
  product_id       uuid not null references app.products(id),
  node_id          text references ref.jurisdictions(id),
  ref              text not null unique check (length(ref) between 20 and 64),
  job_id           uuid references app.jobs(id),
  check_ids        uuid[] not null,
  ruleset_version  text not null references ref.ruleset_versions(id),
  artwork_sha      text not null,
  has_not_assessed boolean not null,
  pdf_path         text,
  pdf_sha256       text,
  created_by       uuid references app.people(id),
  created_at       timestamptz not null default now()
);

create table app.certificates (                  -- append-only hash chain (I03, BE-29)
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces(id),
  report_id    uuid not null references app.reports(id),
  product_id   uuid not null references app.products(id),
  node_id      text not null references ref.jurisdictions(id),
  signer_id    uuid not null references app.people(id),
  grant_id     uuid not null references app.signing_grants(id),
  prev_hash    text,
  hash         text not null unique,
  signed_at    timestamptz not null default now()
);

create table app.shares (                        -- BE-27: revocable, optional expiry, access logged
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces(id),
  report_id    uuid not null references app.reports(id),
  token_hash   bytea not null unique,
  channel      text not null check (channel in ('link','email')),
  recipient    text,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  created_by   uuid references app.people(id),
  created_at   timestamptz not null default now()
);

create table app.share_access_log (
  id           bigint generated always as identity primary key,
  workspace_id uuid not null references app.workspaces(id),
  share_id     uuid not null references app.shares(id),
  accessed_at  timestamptz not null default now(),
  ip_hash      text,
  user_agent   text
);

create table app.supersessions (                 -- BE-30: material change only; never 'invalid'
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references app.workspaces(id),
  artefact_type   text not null check (artefact_type in ('report','certificate')),
  artefact_id     uuid not null,
  rule_key        text not null,
  rule_diff_id    uuid references ref.rule_diffs(id),
  ruleset_version text not null references ref.ruleset_versions(id),
  superseded_at   timestamptz not null default now()
);
create index supersessions_artefact on app.supersessions(artefact_type, artefact_id);

create table app.registrations (                 -- G03
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references app.workspaces(id),
  product_id      uuid not null references app.products(id),
  node_id         text not null references ref.jurisdictions(id),
  obligation_id   uuid references ref.obligations(id),
  number          text,
  registered_on   date,
  expires_at      date,
  evidence_doc_id uuid,
  recorded_by     uuid references app.people(id),
  created_at      timestamptz not null default now()
);

create table app.registration_packs (            -- G02
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references app.workspaces(id),
  product_id     uuid not null references app.products(id),
  node_id        text not null references ref.jurisdictions(id),
  obligation_id  uuid references ref.obligations(id),
  evidence_state jsonb not null default '{}',
  created_at     timestamptz not null default now()
);

create table app.suppliers (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces(id),
  name         text not null,
  email        extensions.citext,
  created_at   timestamptz not null default now()
);

create table app.supplier_documents (            -- documents are insert-only; a new version is a new row
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces(id),
  supplier_id  uuid references app.suppliers(id),
  product_id   uuid references app.products(id),
  doc_type     text not null,
  storage_path text not null,
  file_sha256  text not null,
  valid_from   date,
  valid_to     date,
  uploaded_via text not null check (uploaded_via in ('member','supplier_link')),
  scan_status  text not null default 'quarantine' check (scan_status in ('quarantine','clean','rejected')),
  created_at   timestamptz not null default now()
);

create table app.document_requests (             -- H02/H03: token-scoped upload links
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces(id),
  supplier_id  uuid not null references app.suppliers(id),
  product_id   uuid references app.products(id),
  doc_type     text not null,
  token_hash   bytea unique,                       -- set by the worker when the link is sent
  expires_at   timestamptz not null default now() + interval '14 days',
  fulfilled_at timestamptz,
  created_by   uuid references app.people(id),
  created_at   timestamptz not null default now()
);

create table app.subscriptions (                 -- mirror of Stripe; Stripe is the source of truth
  workspace_id           uuid primary key references app.workspaces(id),
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  plan                   text not null,
  term                   text check (term in ('monthly','annual')),
  status                 text not null,
  regions                text[] not null default '{}',
  editor_seats           int,                      -- null = no seat check (free during the allowance, Advanced)
  recipes_included       int,
  current_period_end     timestamptz,
  updated_at             timestamptz not null default now()
);

create table app.allowances (                    -- BE-32: three new label artworks per workspace
  workspace_id   uuid primary key references app.workspaces(id),
  labels_allowed int not null default 3,
  labels_used    int not null default 0 check (labels_used >= 0),
  updated_at     timestamptz not null default now()
);

create table app.allowance_consumptions (        -- the primary key makes consumption idempotent
  artwork_version_id uuid primary key references app.artwork_versions(id),
  workspace_id       uuid not null references app.workspaces(id),
  consumed_at        timestamptz not null default now()
);

create table app.billing_details (
  workspace_id     uuid primary key references app.workspaces(id),
  legal_name       text,
  address          jsonb,
  vat_number       text,
  vat_validated_at timestamptz,
  updated_at       timestamptz not null default now()
);

create table app.payment_events (                -- append-only Stripe webhook log
  stripe_event_id text primary key,
  workspace_id    uuid references app.workspaces(id),
  type            text not null,
  payload         jsonb not null,
  received_at     timestamptz not null default now()
);

create table app.notifications (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces(id),
  person_id    uuid not null references app.people(id),
  kind         text not null,
  severity     text not null default 'info' check (severity in ('info','warning','critical')),
  object_ref   jsonb not null default '{}',
  created_at   timestamptz not null default now(),
  read_at      timestamptz
);

create table app.notification_prefs (
  person_id uuid not null references app.people(id),
  kind      text not null,
  channel   text not null check (channel in ('in_app','email')),
  enabled   boolean not null default true,
  primary key (person_id, kind, channel)
);

create table app.alerts (                        -- BE-39; editorial diffs never create one
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references app.workspaces(id),
  rule_diff_id       uuid not null references ref.rule_diffs(id),
  product_id         uuid not null references app.products(id),
  node_id            text not null references ref.jurisdictions(id),
  phase              text not null check (phase in ('coming','in_force')),
  effect_type        text not null check (effect_type <> 'editorial'),
  effective_from     date,
  sell_through_until date,
  created_at         timestamptz not null default now()
);

create table app.alert_reads (                   -- read state is per person, not per workspace
  alert_id  uuid not null references app.alerts(id),
  person_id uuid not null references app.people(id),
  read_at   timestamptz not null default now(),
  primary key (alert_id, person_id)
);

create table app.saved_views (                   -- workspace objects, not personal preferences (BE-41)
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app.workspaces(id),
  name         text not null,
  filters      jsonb not null default '{}',
  columns      jsonb not null default '[]',
  created_by   uuid references app.people(id),
  created_at   timestamptz not null default now()
);

create table app.model_calls (                   -- every model call, reproducible; no client access
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid references app.workspaces(id),
  purpose        text not null,
  provider       text not null,
  model_id       text not null,
  prompt_version text not null,
  input_hash     text not null,
  output         jsonb,
  input_tokens   int,
  output_tokens  int,
  cost_eur       numeric(10,5),
  latency_ms     int,
  created_at     timestamptz not null default now()
);

create table app.audit_events (                  -- BE-05/06: append-only, actor state stamped at write time
  id                bigint generated always as identity primary key,
  workspace_id      uuid references app.workspaces(id),
  actor_id          uuid references app.people(id),
  actor_is_external boolean not null default false,
  kind              text not null,
  object_type       text,
  object_id         text,
  before            jsonb,
  after             jsonb,
  ruleset_version   text,
  at                timestamptz not null default now()
);
create index audit_events_workspace on app.audit_events(workspace_id, at desc);
