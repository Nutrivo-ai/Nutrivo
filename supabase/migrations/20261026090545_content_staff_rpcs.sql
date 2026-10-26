-- T-204 · Staff RPCs for content operations: accept or reject a candidate (K01/K02 → ref.rule_versions), term
-- decisions (K03), coverage edits (K04), and release_ruleset with the fixture gate (K05) writing typed diffs (J02).
-- Every RPC checks private.is_staff() first and needs the caller's app.people row: acceptance is a person's click
-- (CLAUDE.md 6 and 7). Nothing here writes rule content of its own: params, article reference and excerpt come only
-- from a stored, verified extraction.
-- A release is prepared as a draft (ref.ruleset_drafts), so fixtures can run before the immutable
-- ref.ruleset_versions row exists (#36 question 1). The worker records each fixture run in ref.fixture_runs, bound
-- to a digest of the draft's members and their fixtures; no RPC can record a pass. Open questions: #34.
-- New P-codes: P0010 (BE-10: complete coverage without accepted, tested rules), P0039 (K05: release without passing
-- fixtures).

-- ─── Tables (staff tooling: service role only, like ref.rule_candidates) ─────────────────────────────
create table ref.ruleset_drafts (                -- a proposed ruleset; frozen once a ruleset_versions row has its id
  id         text primary key check (id ~ '^[0-9]{4}\.[0-9]{2}-[a-z0-9]+$'),   -- '2026.11-a'
  based_on   text references ref.ruleset_versions(id),
  notes      text not null default '',
  created_by uuid not null references app.people(id),
  created_at timestamptz not null default now()
);

create table ref.ruleset_draft_members (
  draft_id text not null references ref.ruleset_drafts(id),
  rule_key text not null,
  version  int  not null,
  primary key (draft_id, rule_key),
  foreign key (rule_key, version) references ref.rule_versions(rule_key, version)
);
create trigger ruleset_member_guard before insert or update on ref.ruleset_draft_members
  for each row execute function private.ruleset_member_guard();                -- P0038: accepted versions only

create table ref.ruleset_draft_coverage (
  draft_id        text not null references ref.ruleset_drafts(id),
  node_id         text not null references ref.jurisdictions(id),
  domain          text not null check (domain in ('mandatory_particulars','composition','claims_wording',
                                                  'type_geometry','language','registration')),
  state           text not null check (state in ('complete','partial','not_encoded')),
  method          text not null default 'machine_extraction_person_accepted',
  last_checked_at date,
  gap_id          text references ref.coverage_gaps(gap_id),
  primary key (draft_id, node_id, domain),
  check (state = 'complete' or gap_id is not null)
);

create table ref.fixture_runs (                  -- insert-only; written by the worker's fixture runner only
  id                uuid primary key default gen_random_uuid(),
  draft_id          text not null references ref.ruleset_drafts(id),
  digest            text not null,              -- private.ruleset_draft_digest(draft_id) when the run started
  passed            boolean not null,
  rule_fixtures_ran int  not null check (rule_fixtures_ran >= 0),
  summary           jsonb not null default '{}',
  runner            text not null,
  ran_at            timestamptz not null default clock_timestamp(),
  check (not passed or rule_fixtures_ran > 0)   -- a runner that judged nothing never passes
);
create index fixture_runs_draft on ref.fixture_runs(draft_id, ran_at desc);

revoke all on ref.ruleset_drafts, ref.ruleset_draft_members, ref.ruleset_draft_coverage, ref.fixture_runs
  from public, anon, authenticated;
grant select, insert, update, delete on ref.ruleset_drafts, ref.ruleset_draft_members, ref.ruleset_draft_coverage
  to service_role;
grant select, insert on ref.fixture_runs to service_role;
revoke update, delete, truncate on ref.fixture_runs from authenticated, service_role, anon;
create trigger insert_only_row before update or delete on ref.fixture_runs
  for each row execute function private.reject_mutation();
create trigger insert_only_truncate before truncate on ref.fixture_runs
  for each statement execute function private.reject_mutation();

-- ─── Helpers ─────────────────────────────────────────────────────────────────────────────────────
create function private.require_staff() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_person uuid;
begin
  if not private.is_staff() then raise exception 'staff only' using errcode = '42501'; end if;
  v_person := private.person_id();
  if v_person is null then raise exception 'a staff action needs a person record' using errcode = '42501'; end if;
  return v_person;
end $$;

create function private.latest_ruleset() returns text
language sql stable security definer set search_path = '' as $$
  select rv.id from ref.ruleset_versions rv order by rv.released_at desc, rv.id desc limit 1
$$;

-- What a fixture run is bound to: each member's version and the content of its fixtures. Any change to either
-- after the run makes the run stale for release.
create function private.ruleset_draft_digest(p_draft text) returns text
language sql stable security definer set search_path = '' as $$
  select encode(extensions.digest(coalesce(string_agg(
           m.rule_key || ':' || m.version || ':' || coalesce(f.fx, ''), E'\n' order by m.rule_key), ''), 'sha256'), 'hex')
  from ref.ruleset_draft_members m
  left join lateral (
    select string_agg(md5(concat_ws('|', rf.id, rf.name, rf.input, rf.expected_outcome, rf.expected)), ','
                      order by rf.id) as fx
    from ref.rule_fixtures rf where rf.rule_key = m.rule_key and rf.version = m.version) f on true
  where m.draft_id = p_draft
$$;
revoke execute on function private.ruleset_draft_digest(text) from authenticated;

-- docs/05 §Applicability: the predicate language, and nothing else.
create function private.valid_applicability(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare v_key text; v_arg jsonb; v_item jsonb;
        v_fields text[] := '{species,life_stage,product_class,intended_use,parnut_status,format,node_id,region,panel_language}';
begin
  if p is null or jsonb_typeof(p) <> 'object' or (select count(*) from jsonb_object_keys(p)) <> 1 then
    return false;
  end if;
  select k, p -> k into v_key, v_arg from jsonb_object_keys(p) k;
  if v_key in ('all','any') then
    if jsonb_typeof(v_arg) <> 'array' then return false; end if;
    for v_item in select jsonb_array_elements(v_arg) loop
      if not private.valid_applicability(v_item) then return false; end if;
    end loop;
    return true;
  elsif v_key = 'not' then
    return private.valid_applicability(v_arg);
  elsif v_key in ('eq','in') then
    return jsonb_typeof(v_arg) = 'array' and jsonb_array_length(v_arg) = 2
       and (v_arg ->> 0) = any(v_fields)
       and (v_key = 'eq' or jsonb_typeof(v_arg -> 1) = 'array');
  elsif v_key = 'has' then
    return jsonb_typeof(v_arg) = 'string' and (v_arg #>> '{}') = any(v_fields);
  end if;
  return false;
end $$;

-- BE-10: a node × domain may be complete only when draft members cover it (held on the node or its region) and
-- every one of them has fixtures. The release re-checks it against the fixture run.
create function private.coverage_supported(p_draft text, p_node text, p_domain text) returns boolean
language sql stable security definer set search_path = '' as $$
  with held as (
    select m.rule_key, m.version from ref.ruleset_draft_members m
    join ref.rules r on r.rule_key = m.rule_key
    where m.draft_id = p_draft and r.domain = p_domain
      and r.node_id in (p_node, (select j.parent_id from ref.jurisdictions j where j.id = p_node)))
  select exists (select 1 from held)
     and not exists (select 1 from held h where not exists (
           select 1 from ref.rule_fixtures rf where rf.rule_key = h.rule_key and rf.version = h.version))
$$;

-- A draft that can still change: it exists and has not been released. Locks it for the caller's transaction.
create function private.open_draft(p_draft text) returns ref.ruleset_drafts
language plpgsql security definer set search_path = '' as $$
declare v_d ref.ruleset_drafts;
begin
  select * into v_d from ref.ruleset_drafts d where d.id = p_draft for update;
  if not found then raise exception 'unknown ruleset draft %', p_draft using errcode = '22023'; end if;
  if exists (select 1 from ref.ruleset_versions rv where rv.id = p_draft) then
    raise exception 'ruleset % is released and cannot change; start a new draft', p_draft using errcode = '22023';
  end if;
  return v_d;
end $$;

-- ─── K01/K02 → J02: accept or reject a candidate ─────────────────────────────────────────────────
-- p_use picks the key the person checked against the text ('first' or 'second'). Its params, article reference
-- and excerpt become the new version verbatim; both extractions are kept (BE-38). The new version supersedes the
-- rule's latest accepted version; earlier versions stay as they are (BE-08). effect_type types the change (BE-09).
create function app.accept_candidate(p_candidate uuid, p_use text, p_title text, p_shape text, p_domain text,
                                     p_node text, p_applicability jsonb, p_effect_type text,
                                     p_effective_from date default null, p_sell_through_until date default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_person uuid := private.require_staff(); v_c ref.rule_candidates; v_value jsonb; v_x jsonb;
        v_rule ref.rules; v_prev int; v_version int;
begin
  if p_use is null or p_use not in ('first','second') then
    raise exception 'choose the first or the second extraction' using errcode = '22023';
  end if;
  select * into v_c from ref.rule_candidates c where c.id = p_candidate for update;
  if not found then raise exception 'unknown candidate' using errcode = '22023'; end if;
  if v_c.decision not in ('pending','needs_review') then
    raise exception 'candidate is already %', v_c.decision using errcode = '22023';
  end if;
  if v_c.proposed_rule_key is null then
    raise exception 'candidate names no rule key' using errcode = '22023';
  end if;
  if v_c.agree is null or v_c.first_value is null or v_c.second_value is null then
    raise exception 'the second extraction has not run for this candidate' using errcode = '22023';
  end if;
  v_value := case p_use when 'first' then v_c.first_value else v_c.second_value end;
  v_x := v_value -> 'extraction';
  if coalesce((v_value ->> 'verified')::boolean, false) is not true
     or coalesce((v_x ->> 'found')::boolean, false) is not true
     or coalesce(v_x ->> 'excerpt', '') = '' or coalesce(v_x ->> 'article_ref', '') = ''
     or jsonb_typeof(v_x -> 'params') is distinct from 'object' then
    raise exception 'the % extraction is not a verified finding with params, article and excerpt', p_use
      using errcode = '22023';
  end if;
  if p_effect_type is null then
    raise exception 'type the change: effect_type is required' using errcode = '22023';
  end if;
  if p_sell_through_until < p_effective_from then
    raise exception 'sell_through_until is before effective_from' using errcode = '22023';
  end if;
  if not private.valid_applicability(p_applicability) then
    raise exception 'applicability is not a valid predicate (docs/05)' using errcode = '22023';
  end if;

  select * into v_rule from ref.rules r where r.rule_key = v_c.proposed_rule_key for update;
  if not found then
    if coalesce(p_title, '') = '' or p_shape is null or p_domain is null or p_node is null then
      raise exception 'a new rule needs a title, shape, domain and node' using errcode = '22023';
    end if;
    insert into ref.rules (rule_key, shape, domain, node_id, title)
    values (v_c.proposed_rule_key, p_shape, p_domain, p_node, p_title);
  elsif (p_shape is not null and p_shape <> v_rule.shape) or (p_domain is not null and p_domain <> v_rule.domain)
        or (p_node is not null and p_node <> v_rule.node_id) then
    raise exception 'rule % keeps its shape, domain and node; use a new rule key', v_rule.rule_key
      using errcode = '22023';
  end if;

  select max(rv.version) filter (where rv.status = 'accepted'), coalesce(max(rv.version), 0) + 1
  into v_prev, v_version from ref.rule_versions rv where rv.rule_key = v_c.proposed_rule_key;

  insert into ref.rule_versions (rule_key, version, status, params, applicability, article_ref, source_id,
                                 source_excerpt, effect_type, effective_from, sell_through_until,
                                 supersedes_version, extraction_a, extraction_b, accepted_by, accepted_at)
  values (v_c.proposed_rule_key, v_version, 'accepted', v_x -> 'params', p_applicability, v_x ->> 'article_ref',
          v_c.source_id, v_x ->> 'excerpt', p_effect_type, p_effective_from, p_sell_through_until,
          v_prev, v_c.first_value, v_c.second_value, v_person, now());
  update ref.rule_candidates set decision = 'accepted', decided_by = v_person, decided_at = now()
  where id = p_candidate;

  perform private.write_audit(null, 'rule_version.accepted', 'rule_version',
                              v_c.proposed_rule_key || ':' || v_version, null,
                              jsonb_build_object('candidate_id', p_candidate, 'used', p_use, 'agree', v_c.agree,
                                                 'supersedes_version', v_prev, 'effect_type', p_effect_type,
                                                 'effective_from', p_effective_from,
                                                 'sell_through_until', p_sell_through_until));
  return jsonb_build_object('rule_key', v_c.proposed_rule_key, 'version', v_version, 'supersedes_version', v_prev);
end $$;

create function app.reject_candidate(p_candidate uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_person uuid := private.require_staff(); v_c ref.rule_candidates;
begin
  select * into v_c from ref.rule_candidates c where c.id = p_candidate for update;
  if not found then raise exception 'unknown candidate' using errcode = '22023'; end if;
  if v_c.decision not in ('pending','needs_review') then
    raise exception 'candidate is already %', v_c.decision using errcode = '22023';
  end if;
  update ref.rule_candidates set decision = 'rejected', decided_by = v_person, decided_at = now()
  where id = p_candidate;
  perform private.write_audit(null, 'rule_candidate.rejected', 'rule_candidate', p_candidate::text,
                              jsonb_build_object('decision', v_c.decision),
                              jsonb_build_object('decision', 'rejected', 'note', p_note));
end $$;

-- ─── K03: term decisions (insert-only), BE-11 ────────────────────────────────────────────────────
-- An accepted term must come from a stored official text in its own language: never an English row, never a
-- translation. 'amend' is not offered until its meaning is decided (#34).
create function app.decide_term(p_term_entry uuid, p_decision text, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_person uuid := private.require_staff(); v_e ref.term_entries; v_id uuid;
begin
  if p_decision is null or p_decision not in ('accept','reject') then
    raise exception 'a term decision is accept or reject' using errcode = '22023';
  end if;
  select * into v_e from ref.term_entries t where t.id = p_term_entry for update;
  if not found then raise exception 'unknown term entry' using errcode = '22023'; end if;
  if v_e.status <> 'candidate' then
    raise exception 'term entry is already %', v_e.status using errcode = '22023';
  end if;
  if p_decision = 'accept' then
    if not exists (select 1 from ref.sources s where s.id = v_e.source_id and s.kind = 'eurlex'
                   and s.language = v_e.language and s.sha256 is not null and s.storage_path is not null) then
      raise exception 'BE-11: a % term is accepted only from the stored official % text', v_e.language, v_e.language
        using errcode = '22023';
    end if;
    if exists (select 1 from ref.term_entries t where t.term_key = v_e.term_key and t.language = v_e.language
               and t.status = 'accepted' and t.ruleset_version is not distinct from v_e.ruleset_version) then
      raise exception 'an accepted % term already exists for %', v_e.language, v_e.term_key using errcode = '22023';
    end if;
  end if;
  insert into ref.term_decisions (term_entry_id, decision, decided_by, note)
  values (p_term_entry, p_decision, v_person, p_note) returning id into v_id;
  update ref.term_entries set status = case p_decision when 'accept' then 'accepted' else 'rejected' end
  where id = p_term_entry;
  perform private.write_audit(null, 'term.' || p_decision || 'ed', 'term_entry', p_term_entry::text,
                              jsonb_build_object('status', v_e.status),
                              jsonb_build_object('decision', p_decision, 'term_key', v_e.term_key,
                                                 'language', v_e.language, 'note', p_note));
  return v_id;
end $$;

-- ─── K04: gaps and coverage, held on a draft until release ───────────────────────────────────────
create function app.open_coverage_gap(p_gap_id text, p_node text, p_domain text, p_reason_code text,
                                      p_description text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_person uuid := private.require_staff();
begin
  if p_gap_id is null or p_gap_id !~ '^GAP-[A-Z0-9_-]+$' then
    raise exception 'a gap id looks like GAP-EU-SE-TYPE_GEOMETRY' using errcode = '22023';
  end if;
  if coalesce(trim(p_description), '') = '' then
    raise exception 'a gap says plainly what is missing' using errcode = '22023';
  end if;
  if p_domain is null or p_domain not in ('mandatory_particulars','composition','claims_wording','type_geometry',
                                          'language','registration') then
    raise exception 'unknown domain %', p_domain using errcode = '22023';
  end if;
  if not exists (select 1 from ref.jurisdictions j where j.id = p_node) then
    raise exception 'unknown node %', p_node using errcode = '22023';
  end if;
  if exists (select 1 from ref.coverage_gaps g where g.gap_id = p_gap_id) then
    raise exception 'gap % already exists', p_gap_id using errcode = '22023';
  end if;
  insert into ref.coverage_gaps (gap_id, node_id, domain, reason_code, description)
  values (p_gap_id, p_node, p_domain, p_reason_code, p_description);
  perform private.write_audit(null, 'coverage_gap.opened', 'coverage_gap', p_gap_id, null,
                              jsonb_build_object('node_id', p_node, 'domain', p_domain, 'reason_code', p_reason_code,
                                                 'description', p_description));
  return p_gap_id;
end $$;

-- K05 preparation: a draft starts as the latest release (members and coverage), then changes until released.
create function app.create_ruleset_draft(p_id text, p_notes text default '') returns text
language plpgsql security definer set search_path = '' as $$
declare v_person uuid := private.require_staff(); v_base text;
begin
  if p_id is null or p_id !~ '^[0-9]{4}\.[0-9]{2}-[a-z0-9]+$' then
    raise exception 'a ruleset id looks like 2026.11-a' using errcode = '22023';
  end if;
  if exists (select 1 from ref.ruleset_versions rv where rv.id = p_id)
     or exists (select 1 from ref.ruleset_drafts d where d.id = p_id) then
    raise exception 'ruleset % already exists', p_id using errcode = '22023';
  end if;
  v_base := private.latest_ruleset();
  insert into ref.ruleset_drafts (id, based_on, notes, created_by) values (p_id, v_base, coalesce(p_notes, ''), v_person);
  insert into ref.ruleset_draft_members (draft_id, rule_key, version)
  select p_id, m.rule_key, m.version from ref.ruleset_members m where m.ruleset_version = v_base;
  insert into ref.ruleset_draft_coverage (draft_id, node_id, domain, state, method, last_checked_at, gap_id)
  select p_id, c.node_id, c.domain, c.state, c.method, c.last_checked_at, c.gap_id
  from ref.coverage_nodes c where c.ruleset_version = v_base;
  perform private.write_audit(null, 'ruleset_draft.created', 'ruleset_draft', p_id, null,
                              jsonb_build_object('based_on', v_base));
  return p_id;
end $$;

-- A null version removes the rule from the draft.
create function app.set_draft_member(p_draft text, p_rule_key text, p_version int) returns void
language plpgsql security definer set search_path = '' as $$
declare v_person uuid := private.require_staff(); v_d ref.ruleset_drafts := private.open_draft(p_draft); v_before int;
begin
  select m.version into v_before from ref.ruleset_draft_members m where m.draft_id = p_draft and m.rule_key = p_rule_key;
  if p_version is null then
    delete from ref.ruleset_draft_members m where m.draft_id = p_draft and m.rule_key = p_rule_key;
  else
    if not exists (select 1 from ref.rule_versions rv where rv.rule_key = p_rule_key and rv.version = p_version
                   and rv.status = 'accepted') then
      raise exception 'a ruleset may only contain accepted rule versions (% v%)', p_rule_key, p_version
        using errcode = 'P0038';
    end if;
    insert into ref.ruleset_draft_members (draft_id, rule_key, version) values (p_draft, p_rule_key, p_version)
    on conflict (draft_id, rule_key) do update set version = excluded.version;
  end if;
  perform private.write_audit(null, 'ruleset_draft.member_set', 'ruleset_draft', p_draft,
                              jsonb_build_object('rule_key', p_rule_key, 'version', v_before),
                              jsonb_build_object('rule_key', p_rule_key, 'version', p_version));
end $$;

create function app.set_draft_coverage(p_draft text, p_node text, p_domain text, p_state text,
                                       p_method text default null, p_last_checked_at date default null,
                                       p_gap_id text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_person uuid := private.require_staff(); v_d ref.ruleset_drafts := private.open_draft(p_draft);
        v_before ref.ruleset_draft_coverage;
begin
  if p_state is null or p_state not in ('complete','partial','not_encoded') then
    raise exception 'unknown coverage state %', p_state using errcode = '22023';
  end if;
  if p_state = 'complete' then
    if not private.coverage_supported(p_draft, p_node, p_domain) then
      raise exception 'BE-10: % % is complete only when its rules are accepted, in the ruleset and tested',
        p_node, p_domain using errcode = 'P0010';
    end if;
    p_gap_id := null;
  elsif not exists (select 1 from ref.coverage_gaps g where g.gap_id = p_gap_id and g.node_id = p_node
                    and g.domain = p_domain and g.closed_in is null) then
    raise exception '% coverage needs an open gap for % %', p_state, p_node, p_domain using errcode = '22023';
  end if;
  select * into v_before from ref.ruleset_draft_coverage c
  where c.draft_id = p_draft and c.node_id = p_node and c.domain = p_domain;
  insert into ref.ruleset_draft_coverage (draft_id, node_id, domain, state, method, last_checked_at, gap_id)
  values (p_draft, p_node, p_domain, p_state, coalesce(p_method, v_before.method, 'machine_extraction_person_accepted'),
          p_last_checked_at, p_gap_id)
  on conflict (draft_id, node_id, domain) do update
    set state = excluded.state, method = excluded.method, last_checked_at = excluded.last_checked_at,
        gap_id = excluded.gap_id;
  perform private.write_audit(null, 'ruleset_draft.coverage_set', 'ruleset_draft', p_draft,
                              case when v_before.draft_id is null then null else
                                jsonb_build_object('node_id', p_node, 'domain', p_domain, 'state', v_before.state,
                                                   'gap_id', v_before.gap_id) end,
                              jsonb_build_object('node_id', p_node, 'domain', p_domain, 'state', p_state,
                                                 'gap_id', p_gap_id, 'last_checked_at', p_last_checked_at));
end $$;

-- ─── K05 + J02: release ──────────────────────────────────────────────────────────────────────────
-- Refuses unless every member is accepted and has fixtures, and the draft's latest fixture run passed, judged at
-- least one fixture and still matches the draft (K05.must.1). Writes the immutable release with coverage and gaps,
-- then one diff per changed member typed by the new version's effect, and one diff_fanout job per non-editorial
-- diff: an editorial diff never reaches alerts (BE-09).
create function app.release_ruleset(p_draft text, p_notes text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_person uuid := private.require_staff(); v_d ref.ruleset_drafts; v_prev text; v_run ref.fixture_runs;
        v_digest text; v_bad text; v_diff record; v_diffs jsonb := '[]'; v_jobs jsonb := '[]'; v_job uuid;
begin
  perform pg_advisory_xact_lock(hashtext('ref.release_ruleset'));
  v_d := private.open_draft(p_draft);
  v_prev := private.latest_ruleset();
  if v_d.based_on is distinct from v_prev then
    raise exception 'ruleset % was released after draft % was started; start a new draft', v_prev, p_draft
      using errcode = '22023';
  end if;

  if not exists (select 1 from ref.ruleset_draft_members m where m.draft_id = p_draft) then
    raise exception 'K05: draft % has no members, so no fixture can pass', p_draft using errcode = 'P0039';
  end if;
  select string_agg(m.rule_key || ' v' || m.version, ', ' order by m.rule_key) into v_bad
  from ref.ruleset_draft_members m
  where m.draft_id = p_draft and not exists (select 1 from ref.rule_fixtures rf
                                             where rf.rule_key = m.rule_key and rf.version = m.version);
  if v_bad is not null then
    raise exception 'K05: no release without fixtures; none for %', v_bad using errcode = 'P0039';
  end if;
  select * into v_run from ref.fixture_runs r where r.draft_id = p_draft order by r.ran_at desc, r.id desc limit 1;
  if not found then
    raise exception 'K05: no fixture run recorded for draft %', p_draft using errcode = 'P0039';
  end if;
  if not v_run.passed or v_run.rule_fixtures_ran = 0 then
    raise exception 'K05: the latest fixture run for draft % did not pass', p_draft using errcode = 'P0039';
  end if;
  v_digest := private.ruleset_draft_digest(p_draft);
  if v_run.digest <> v_digest then
    raise exception 'K05: members or fixtures changed after the latest fixture run; run the fixtures again'
      using errcode = 'P0039';
  end if;

  select string_agg(m.rule_key, ', ' order by m.rule_key) into v_bad
  from ref.ruleset_members m
  where m.ruleset_version = v_prev
    and not exists (select 1 from ref.ruleset_draft_members d where d.draft_id = p_draft and d.rule_key = m.rule_key);
  if v_bad is not null then
    raise exception 'removing % from a release is not decided yet (#34)', v_bad using errcode = '22023';
  end if;
  select string_agg(c.node_id || ' ' || c.domain, ', ') into v_bad
  from ref.ruleset_draft_coverage c
  where c.draft_id = p_draft and c.state = 'complete'
    and not private.coverage_supported(p_draft, c.node_id, c.domain);
  if v_bad is not null then
    raise exception 'BE-10: coverage marked complete without accepted, tested rules: %', v_bad using errcode = 'P0010';
  end if;
  select string_agg(c.gap_id, ', ') into v_bad
  from ref.ruleset_draft_coverage c join ref.coverage_gaps g on g.gap_id = c.gap_id
  where c.draft_id = p_draft and g.closed_in is not null;
  if v_bad is not null then
    raise exception 'coverage refers to closed gaps: %', v_bad using errcode = '22023';
  end if;
  select string_agg(m.rule_key || ' v' || m.version, ', ') into v_bad
  from ref.ruleset_draft_members m
  join ref.rule_versions rv on rv.rule_key = m.rule_key and rv.version = m.version
  left join ref.ruleset_members p on p.ruleset_version = v_prev and p.rule_key = m.rule_key
  where m.draft_id = p_draft and p.version is distinct from m.version and rv.effect_type is null;
  if v_bad is not null then
    raise exception 'J02: a changed rule needs a typed effect; none on %', v_bad using errcode = '22023';
  end if;

  insert into ref.ruleset_versions (id, released_at, released_by, notes)
  values (p_draft, clock_timestamp(), v_person, coalesce(p_notes, v_d.notes));
  insert into ref.ruleset_members (ruleset_version, rule_key, version)
  select p_draft, m.rule_key, m.version from ref.ruleset_draft_members m where m.draft_id = p_draft;
  insert into ref.coverage_nodes (ruleset_version, node_id, domain, state, rules_encoded, method, last_checked_at, gap_id)
  select p_draft, c.node_id, c.domain, c.state,
         (select count(*) from ref.ruleset_draft_members m join ref.rules r on r.rule_key = m.rule_key
          where m.draft_id = p_draft and r.domain = c.domain
            and r.node_id in (c.node_id, (select j.parent_id from ref.jurisdictions j where j.id = c.node_id))),
         c.method, c.last_checked_at, c.gap_id
  from ref.ruleset_draft_coverage c where c.draft_id = p_draft;
  update ref.coverage_gaps g set opened_in = p_draft
  where g.opened_in is null
    and g.gap_id in (select c.gap_id from ref.ruleset_draft_coverage c where c.draft_id = p_draft);
  update ref.coverage_gaps g set closed_in = p_draft
  where g.closed_in is null
    and g.gap_id in (select c.gap_id from ref.coverage_nodes c where c.ruleset_version = v_prev and c.gap_id is not null)
    and g.gap_id not in (select c.gap_id from ref.ruleset_draft_coverage c
                         where c.draft_id = p_draft and c.gap_id is not null);
  insert into ref.glossary_entries (key, ruleset_version, definition)
  select g.key, p_draft, g.definition from ref.glossary_entries g where g.ruleset_version = v_prev;

  for v_diff in
    insert into ref.rule_diffs (ruleset_version, rule_key, from_version, to_version, effect_type, effective_from,
                                sell_through_until)
    select p_draft, m.rule_key, p.version, m.version, rv.effect_type, rv.effective_from, rv.sell_through_until
    from ref.ruleset_draft_members m
    join ref.rule_versions rv on rv.rule_key = m.rule_key and rv.version = m.version
    left join ref.ruleset_members p on p.ruleset_version = v_prev and p.rule_key = m.rule_key
    where m.draft_id = p_draft and p.version is distinct from m.version
    returning id, rule_key, from_version, to_version, effect_type
  loop
    v_diffs := v_diffs || jsonb_build_object('id', v_diff.id, 'rule_key', v_diff.rule_key,
                                             'from_version', v_diff.from_version, 'to_version', v_diff.to_version,
                                             'effect_type', v_diff.effect_type);
    if v_diff.effect_type <> 'editorial' then
      v_job := private.enqueue('diff_fanout', null, 'diff_fanout:' || v_diff.id::text,
                               jsonb_build_object('rule_diff_id', v_diff.id));
      v_jobs := v_jobs || to_jsonb(v_job);
    end if;
  end loop;

  perform private.write_audit(null, 'ruleset.released', 'ruleset_version', p_draft, null,
                              jsonb_build_object('previous', v_prev, 'fixture_run_id', v_run.id, 'digest', v_digest,
                                                 'members', (select count(*) from ref.ruleset_draft_members m
                                                             where m.draft_id = p_draft),
                                                 'diffs', jsonb_array_length(v_diffs),
                                                 'fanout_jobs', jsonb_array_length(v_jobs)),
                              p_draft);
  return jsonb_build_object('ruleset_version', p_draft, 'previous', v_prev, 'diffs', v_diffs, 'fanout_jobs', v_jobs);
end $$;

revoke all on function app.accept_candidate(uuid,text,text,text,text,text,jsonb,text,date,date),
                       app.reject_candidate(uuid,text), app.decide_term(uuid,text,text),
                       app.open_coverage_gap(text,text,text,text,text), app.create_ruleset_draft(text,text),
                       app.set_draft_member(text,text,int),
                       app.set_draft_coverage(text,text,text,text,text,date,text),
                       app.release_ruleset(text,text)
  from public, anon;
grant execute on function app.accept_candidate(uuid,text,text,text,text,text,jsonb,text,date,date),
                          app.reject_candidate(uuid,text), app.decide_term(uuid,text,text),
                          app.open_coverage_gap(text,text,text,text,text), app.create_ruleset_draft(text,text),
                          app.set_draft_member(text,text,int),
                          app.set_draft_coverage(text,text,text,text,text,date,text),
                          app.release_ruleset(text,text)
  to authenticated, service_role;
revoke all on function private.require_staff(), private.latest_ruleset(), private.ruleset_draft_digest(text),
                       private.valid_applicability(jsonb), private.coverage_supported(text,text,text),
                       private.open_draft(text)
  from public, anon;
