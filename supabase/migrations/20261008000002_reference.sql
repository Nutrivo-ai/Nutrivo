-- 0002 · Reference schema: jurisdictions, rules, rulesets, coverage, terms, obligations, content-ops tables.
-- BE-07..BE-12, BE-37, BE-38. Shapes are built empty and correct now so content cannot define its own schema.

create table ref.jurisdictions (
  id        text primary key check (id ~ '^[A-Z]{2,3}(-[A-Z0-9]{2,3})?$'),  -- 'EU', 'EU-SE', 'UK-NI', 'US-FED', 'US-TX'
  parent_id text references ref.jurisdictions(id),
  node_type text not null check (node_type in ('region','country','state','federal')),          -- BE-07
  name      text not null,
  languages text[] not null default '{}',       -- official labelling languages (ISO 639-1)
  check ((node_type = 'region') = (parent_id is null))
);

create function private.jurisdiction_shape() returns trigger language plpgsql as $$
begin
  if new.parent_id is not null
     and (select j.node_type from ref.jurisdictions j where j.id = new.parent_id) <> 'region' then
    raise exception 'BE-07: % may only hang directly under a region', new.id using errcode = 'P0007';
  end if;
  return new;
end $$;
create trigger jurisdiction_shape before insert or update on ref.jurisdictions
  for each row execute function private.jurisdiction_shape();

create table ref.sources (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('eurlex','register','national_gazette','authority_page','guidance','other')),
  celex        text,
  title        text not null,
  url          text not null,
  language     text,
  licence      text not null default 'unknown'
               check (licence in ('eu_reuse','ogl','public_domain','licensed','restricted','unknown')),
  retrieved_at timestamptz,
  sha256       text,
  storage_path text,
  created_at   timestamptz not null default now()
);

create table ref.rules (
  rule_key   text primary key,      -- stable for the life of the rule (BE-08), e.g. 'EU.767.ART17.TYPE_OF_FEED'
  shape      text not null check (shape in ('threshold','mandatory_particular','prescribed_wording',
                                            'character_height','additive_condition','claim_judgement')),  -- BE-20
  domain     text not null check (domain in ('mandatory_particulars','composition','claims_wording',
                                             'type_geometry','language','registration')),
  node_id    text not null references ref.jurisdictions(id),   -- where the rule is held (EU core on 'EU')
  title      text not null,
  created_at timestamptz not null default now()
);

create table ref.rule_versions (
  rule_key           text not null references ref.rules(rule_key),
  version            int  not null check (version >= 1),
  status             text not null default 'candidate' check (status in ('candidate','accepted','rejected')),
  params             jsonb not null default '{}',
  applicability      jsonb not null default '{"all": []}',
  article_ref        text not null,           -- 'Reg. (EC) 767/2009 Art. 17(1)(a)'
  source_id          uuid references ref.sources(id),
  source_excerpt     text,                    -- verbatim official text the rule was extracted from
  effect_type        text check (effect_type in ('new_obligation','tightened_threshold',
                                  'withdrawn_authorisation','prescribed_wording','editorial')),  -- BE-09
  effective_from     date,
  sell_through_until date,
  supersedes_version int,
  extraction_a       jsonb,                   -- BE-38: two independent extractions
  extraction_b       jsonb,
  accepted_by        uuid references app.people(id),
  accepted_at        timestamptz,
  created_at         timestamptz not null default now(),
  primary key (rule_key, version),
  check (status <> 'accepted' or (accepted_by is not null and accepted_at is not null and source_excerpt is not null))
);

-- BE-08: an accepted version is permanent. A change is a new version that supersedes it.
create function private.rule_version_guard() returns trigger language plpgsql as $$
begin
  if old.status = 'accepted' then
    raise exception 'BE-08: accepted rule versions are permanent; supersede % with a new version', old.rule_key
      using errcode = 'P0008';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger rule_version_guard before update or delete on ref.rule_versions
  for each row execute function private.rule_version_guard();

create table ref.ruleset_versions (            -- immutable (insert-only, see 0004)
  id          text primary key,                -- '2026.11-a'
  released_at timestamptz not null default now(),
  released_by uuid references app.people(id),
  notes       text not null default ''
);

create table ref.ruleset_members (             -- which accepted rule version each ruleset pins; insert-only
  ruleset_version text not null references ref.ruleset_versions(id),
  rule_key        text not null,
  version         int  not null,
  primary key (ruleset_version, rule_key),
  foreign key (rule_key, version) references ref.rule_versions(rule_key, version)
);

create function private.ruleset_member_guard() returns trigger language plpgsql as $$
begin
  if (select rv.status from ref.rule_versions rv
      where rv.rule_key = new.rule_key and rv.version = new.version) <> 'accepted' then
    raise exception 'a ruleset may only contain accepted rule versions (% v%)', new.rule_key, new.version
      using errcode = 'P0038';
  end if;
  return new;
end $$;
create trigger ruleset_member_guard before insert on ref.ruleset_members
  for each row execute function private.ruleset_member_guard();

create table ref.rule_diffs (
  id                 uuid primary key default gen_random_uuid(),
  ruleset_version    text not null references ref.ruleset_versions(id),
  rule_key           text not null references ref.rules(rule_key),
  from_version       int,
  to_version         int,
  effect_type        text not null check (effect_type in ('new_obligation','tightened_threshold',
                                         'withdrawn_authorisation','prescribed_wording','editorial')),
  effective_from     date,
  sell_through_until date,                       -- BE-09: exposed separately from effective_from
  created_at         timestamptz not null default now()
);

create table ref.coverage_gaps (
  gap_id      text primary key,                  -- stable: 'GAP-EU-SE-TYPE_GEOMETRY'
  node_id     text not null references ref.jurisdictions(id),
  domain      text not null,
  reason_code text not null check (reason_code in ('not_encoded','partially_encoded','data_missing',
                                                   'out_of_scope','pending_acceptance')),
  description text not null,
  opened_in   text references ref.ruleset_versions(id),
  closed_in   text references ref.ruleset_versions(id)
);

create table ref.coverage_nodes (               -- BE-10: queried at check time, rendered live in public
  ruleset_version text not null references ref.ruleset_versions(id),
  node_id         text not null references ref.jurisdictions(id),
  domain          text not null check (domain in ('mandatory_particulars','composition','claims_wording',
                                                  'type_geometry','language','registration')),
  state           text not null check (state in ('complete','partial','not_encoded')),
  rules_encoded   int  not null default 0,
  method          text not null default 'machine_extraction_person_accepted',
  last_checked_at date,
  gap_id          text references ref.coverage_gaps(gap_id),
  primary key (ruleset_version, node_id, domain),
  check (state = 'complete' or gap_id is not null)
);

create table ref.term_entries (                 -- BE-11: per language, from official text, never translated
  id              uuid primary key default gen_random_uuid(),
  term_key        text not null,                  -- 'complete_feed', 'heading_composition'
  language        text not null,
  term            text not null,
  kind            text not null check (kind in ('prescribed_designation','heading','analytical_constituent',
                                                'category','claim_term')),
  article_ref     text not null,
  source_id       uuid references ref.sources(id),
  status          text not null default 'candidate' check (status in ('candidate','accepted','rejected')),
  ruleset_version text references ref.ruleset_versions(id),
  created_at      timestamptz not null default now(),
  unique (term_key, language, ruleset_version)
);

create table ref.term_decisions (               -- insert-only
  id            uuid primary key default gen_random_uuid(),
  term_entry_id uuid not null references ref.term_entries(id),
  decision      text not null check (decision in ('accept','reject','amend')),
  decided_by    uuid not null references app.people(id),
  note          text,
  created_at    timestamptz not null default now()
);

create table ref.glossary_entries (             -- BE-11: eleven authored definitions, returned verbatim
  key             text not null,
  ruleset_version text not null references ref.ruleset_versions(id),
  definition      text not null,
  primary key (key, ruleset_version)
);

create table ref.obligations (                  -- BE-12: a missing field renders as 'not held'
  id                  uuid primary key default gen_random_uuid(),
  node_id             text not null references ref.jurisdictions(id),
  product_class       text not null default 'pet_food',
  kind                text not null check (kind in ('registration','notification','establishment_approval',
                                                    'label_submission','other')),
  authority           text,
  legal_basis         text,
  route               text,
  evidence_list       jsonb,
  fee                 text,
  lead_time_days      int,
  renewal_cycle       text,
  submission_language text,
  source_url          text,
  last_verified_at    date,
  created_at          timestamptz not null default now()
);

create table ref.document_requirements (
  id            uuid primary key default gen_random_uuid(),
  node_id       text not null references ref.jurisdictions(id),
  product_class text not null default 'pet_food',
  doc_type      text not null,
  validity_days int,
  legal_basis   text
);

create table ref.horizon_items (                -- BE-37: a proposal never carries an effective date
  id            uuid primary key default gen_random_uuid(),
  source_id     uuid references ref.sources(id),
  title         text not null,
  stage         text not null check (stage in ('proposal','draft','consultation','adopted','published','in_force')),
  expected_date date,
  effective_from date,
  celex         text,
  notes         text,
  created_at    timestamptz not null default now(),
  check (stage in ('adopted','published','in_force') or effective_from is null)
);

create table ref.rule_candidates (              -- K01/K02; nothing reaches ref.rule_versions on extraction alone
  id                uuid primary key default gen_random_uuid(),
  source_id         uuid not null references ref.sources(id),
  article           text not null,
  source_ref        text,
  proposed_rule_key text,
  first_value       jsonb,
  second_value      jsonb,
  agree             boolean,
  decision          text not null default 'pending' check (decision in ('pending','accepted','rejected','needs_review')),
  decided_by        uuid references app.people(id),
  decided_at        timestamptz,
  created_at        timestamptz not null default now()
);

create table ref.rule_fixtures (                -- K05 refuses a release unless every member's fixtures pass
  id               uuid primary key default gen_random_uuid(),
  rule_key         text not null,
  version          int  not null,
  name             text not null,
  input            jsonb not null,
  expected_outcome text not null check (expected_outcome in ('passed','failed','withheld')),
  expected         jsonb,
  foreign key (rule_key, version) references ref.rule_versions(rule_key, version)
);

create table ref.feed_additives (               -- imported from the EU Register of Feed Additives
  id               text primary key,             -- identification number, e.g. '3a672a'
  name             text not null,
  category         text,
  functional_group text,
  species          text[],
  max_content      jsonb,
  conditions       jsonb,
  authorising_act  text,
  expiry           date,
  source_id        uuid references ref.sources(id)
);

create table ref.feed_materials (               -- Catalogue of feed materials, Reg. (EU) 68/2013 as amended
  number                  text primary key,     -- '9.2.1'
  names                   jsonb not null,       -- {"en": "...", "sv": "...", ...} from official language versions
  description             text,
  compulsory_declarations text[],
  source_id               uuid references ref.sources(id)
);
