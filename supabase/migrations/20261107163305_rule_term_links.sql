-- T-209 · Rule-to-term links (D-31). A rule judges printed text only through accepted term register entries, linked
-- by key by the person who accepts it. The extraction's own params are what the official text says and are never
-- matched against a panel; the links are added beside them, never by an extraction or a model (CLAUDE.md 6 and 7).
--   app.accept_candidate  takes the person's links (p_links, optional: a rule accepted without them is withheld
--                         data_missing until re-linked); an extraction that already holds a link field is refused
--   app.relink_rule       a new accepted version with effect 'editorial' carrying new links; fixtures are not copied
--                         (the old ones were written for the unlinked version), and it reaches checks only through
--                         the next release: a sealed release never changes (#197)
--   P0048 (new)           a node × domain cannot be complete while a held member's linked key has no accepted entry
--                         in one of the node's languages, enforced on the draft's coverage and members, so
--                         app.release_ruleset needs no change
--   private.ruleset_draft_digest also covers the accepted entries of every linked key, so a term changed after a
--                         passing fixture run makes that run stale (P0039; T-210 follow-up)
-- Additive: no table changes. accept_candidate keeps its arguments and gains one with a default.

-- ─── Helpers (run inside the RPCs and triggers; no client gets them) ──────────────────────────────
-- Which link fields each shape takes (docs/05 §Extraction params and term links).
create function private.term_link_fields(p_shape text) returns text[]
language sql immutable set search_path = '' as $$
  select case p_shape
    when 'mandatory_particular' then array['detect', 'scope']
    when 'prescribed_wording' then array['term_key', 'alternative_term_keys', 'match']
    when 'threshold' then array['detect']
    when 'character_height' then array['detect']
    else array[]::text[] end
$$;

-- Every link field of any shape: an extraction never holds one.
create function private.all_term_link_fields() returns text[]
language sql immutable set search_path = '' as $$
  select array['detect', 'scope', 'term_key', 'alternative_term_keys', 'match']
$$;

-- The term keys a rule version's params link to.
create function private.linked_term_keys(p jsonb) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct k order by k), array[]::text[]) from (
    select jsonb_array_elements_text(case when jsonb_typeof(p -> 'detect' -> 'term_keys') = 'array'
                                          then p -> 'detect' -> 'term_keys' else '[]'::jsonb end) as k
    union all
    select p ->> 'term_key' where jsonb_typeof(p -> 'term_key') = 'string'
    union all
    select jsonb_array_elements_text(case when jsonb_typeof(p -> 'alternative_term_keys') = 'array'
                                          then p -> 'alternative_term_keys' else '[]'::jsonb end)
  ) keys where k is not null and k <> ''
$$;

-- Raises 22023 with the reason unless p_links are valid links for p_shape: the shape's own fields only, valid modes,
-- the shape's key field present, and every key with at least one accepted register entry (pinned to no ruleset:
-- what the next release carries). Null links are allowed: the rule stays withheld data_missing.
create function private.check_term_links(p_shape text, p_links jsonb) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v_allowed text[] := private.term_link_fields(p_shape); v_field text; v_key text; v_keys jsonb;
begin
  if p_links is null then return; end if;
  if jsonb_typeof(p_links) <> 'object' or p_links = '{}'::jsonb then
    raise exception 'links are an object with at least one field' using errcode = '22023';
  end if;
  for v_field in select jsonb_object_keys(p_links) loop
    if not v_field = any (v_allowed) then
      raise exception 'a % rule takes the links %, not %', p_shape,
        coalesce(nullif(array_to_string(v_allowed, ', '), ''), 'none'), v_field using errcode = '22023';
    end if;
  end loop;
  if p_links ? 'detect' then
    v_keys := p_links -> 'detect' -> 'term_keys';
    if jsonb_typeof(p_links -> 'detect') <> 'object' or (select count(*) from jsonb_object_keys(p_links -> 'detect')) <> 1
       or jsonb_typeof(v_keys) is distinct from 'array' or jsonb_array_length(v_keys) = 0
       or exists (select 1 from jsonb_array_elements(v_keys) e where jsonb_typeof(e) <> 'string' or e #>> '{}' = '') then
      raise exception 'detect is {"term_keys": [one or more term keys]}' using errcode = '22023';
    end if;
  end if;
  if p_links ? 'scope' and (p_links ->> 'scope') is distinct from 'each_panel_in_node_language'
     and (p_links ->> 'scope') is distinct from 'any_panel' then
    raise exception 'scope is each_panel_in_node_language or any_panel' using errcode = '22023';
  end if;
  if p_links ? 'term_key' and (jsonb_typeof(p_links -> 'term_key') <> 'string' or p_links ->> 'term_key' = '') then
    raise exception 'term_key is one term key' using errcode = '22023';
  end if;
  if p_links ? 'alternative_term_keys' then
    v_keys := p_links -> 'alternative_term_keys';
    if jsonb_typeof(v_keys) <> 'array' or jsonb_array_length(v_keys) = 0
       or exists (select 1 from jsonb_array_elements(v_keys) e where jsonb_typeof(e) <> 'string' or e #>> '{}' = '') then
      raise exception 'alternative_term_keys is a list of one or more term keys' using errcode = '22023';
    end if;
  end if;
  if p_links ? 'match' and (p_links ->> 'match') is distinct from 'case_folded'
     and (p_links ->> 'match') is distinct from 'exact' then
    raise exception 'match is case_folded or exact' using errcode = '22023';
  end if;
  if p_shape = 'prescribed_wording' and not p_links ? 'term_key' then
    raise exception 'a prescribed_wording rule links its term_key' using errcode = '22023';
  end if;
  if p_shape in ('mandatory_particular', 'threshold', 'character_height') and not p_links ? 'detect' then
    raise exception 'a % rule links detect.term_keys', p_shape using errcode = '22023';
  end if;
  foreach v_key in array private.linked_term_keys(p_links) loop
    if not exists (select 1 from ref.term_entries t where t.term_key = v_key and t.status = 'accepted'
                   and t.ruleset_version is null) then
      raise exception 'term % has no accepted entry in the register (K03)', v_key using errcode = '22023';
    end if;
  end loop;
end $$;

-- The linked keys of a draft's members held on the node or its region in the domain, each with a node language that
-- has no accepted entry: 'RULE.KEY term_key [lang]', or null when nothing is missing.
create function private.coverage_terms_missing(p_draft text, p_node text, p_domain text) returns text
language sql stable security definer set search_path = '' as $$
  with held as (
    select m.rule_key, rv.params from ref.ruleset_draft_members m
    join ref.rules r on r.rule_key = m.rule_key
    join ref.rule_versions rv on rv.rule_key = m.rule_key and rv.version = m.version
    where m.draft_id = p_draft and r.domain = p_domain
      and r.node_id in (p_node, (select j.parent_id from ref.jurisdictions j where j.id = p_node))),
  keys as (select h.rule_key, unnest(private.linked_term_keys(h.params)) as term_key from held h),
  langs as (select unnest(j.languages) as lang from ref.jurisdictions j where j.id = p_node)
  select string_agg(k.rule_key || ' ' || k.term_key || ' [' || l.lang || ']', ', '
                    order by k.rule_key, k.term_key, l.lang)
  from keys k cross join langs l
  where not exists (select 1 from ref.term_entries t where t.term_key = k.term_key and t.language = l.lang
                    and t.status = 'accepted' and t.ruleset_version is null)
$$;

-- ─── P0048: complete coverage needs every linked term in every node language ─────────────────────
create function private.coverage_terms_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_missing text;
begin
  if new.state = 'complete' then
    v_missing := private.coverage_terms_missing(new.draft_id, new.node_id, new.domain);
    if v_missing is not null then
      raise exception 'D-31: % % is complete only when every linked term has an accepted entry in each of its '
        'languages; missing: %', new.node_id, new.domain, v_missing using errcode = 'P0048';
    end if;
  end if;
  return new;
end $$;
create trigger coverage_terms_guard before insert or update on ref.ruleset_draft_coverage
  for each row execute function private.coverage_terms_guard();

-- A member set after its node × domain was marked complete is held to the same rule.
create function private.member_terms_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_rule ref.rules; v_c record; v_missing text;
begin
  select * into v_rule from ref.rules r where r.rule_key = new.rule_key;
  for v_c in
    select c.node_id, c.domain from ref.ruleset_draft_coverage c
    join ref.jurisdictions j on j.id = c.node_id
    where c.draft_id = new.draft_id and c.state = 'complete' and c.domain = v_rule.domain
      and (c.node_id = v_rule.node_id or j.parent_id = v_rule.node_id)
  loop
    v_missing := private.coverage_terms_missing(new.draft_id, v_c.node_id, v_c.domain);
    if v_missing is not null then
      raise exception 'D-31: % % is complete, and this member links terms without an accepted entry in each of its '
        'languages; missing: %', v_c.node_id, v_c.domain, v_missing using errcode = 'P0048';
    end if;
  end loop;
  return new;
end $$;
create trigger member_terms_guard after insert or update on ref.ruleset_draft_members
  for each row execute function private.member_terms_guard();

-- ─── The digest covers the linked terms ──────────────────────────────────────────────────────────
-- Same members and fixtures as before (T-204), plus, per member, the accepted register entries of its linked keys.
create or replace function private.ruleset_draft_digest(p_draft text) returns text
language sql stable security definer set search_path = '' as $$
  select encode(extensions.digest(coalesce(string_agg(
           m.rule_key || ':' || m.version || ':' || coalesce(f.fx, '') || ':' || coalesce(t.tx, ''), E'\n'
           order by m.rule_key), ''), 'sha256'), 'hex')
  from ref.ruleset_draft_members m
  join ref.rule_versions rv on rv.rule_key = m.rule_key and rv.version = m.version
  left join lateral (
    select string_agg(md5(jsonb_build_array(rf.id, rf.name, rf.input, rf.expected_outcome, rf.expected)::text), ','
                      order by rf.id) as fx
    from ref.rule_fixtures rf where rf.rule_key = m.rule_key and rf.version = m.version) f on true
  left join lateral (
    select string_agg(md5(jsonb_build_array(te.id, te.term_key, te.language, te.term)::text), ','
                      order by te.term_key, te.language, te.id) as tx
    from ref.term_entries te
    where te.term_key = any (private.linked_term_keys(rv.params)) and te.status = 'accepted'
      and te.ruleset_version is null) t on true
  where m.draft_id = p_draft
$$;

-- ─── K01/K02 → J02: accept a candidate, with the person's links ──────────────────────────────────
drop function app.accept_candidate(uuid, text, text, text, text, text, jsonb, text, date, date);
create function app.accept_candidate(p_candidate uuid, p_use text, p_title text, p_shape text, p_domain text,
                                     p_node text, p_applicability jsonb, p_effect_type text,
                                     p_effective_from date default null, p_sell_through_until date default null,
                                     p_links jsonb default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_person uuid := private.require_staff(); v_c ref.rule_candidates; v_value jsonb; v_x jsonb;
        v_rule ref.rules; v_prev int; v_version int; v_shape text;
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
  if (v_x -> 'params') ?| private.all_term_link_fields() then
    raise exception 'D-31: an extraction never holds term links; the accepting person adds them'
      using errcode = '22023';
  end if;
  if not exists (select 1 from ref.sources s where s.id = v_c.source_id and s.kind = 'eurlex'
                 and s.sha256 is not null and s.storage_path is not null) then
    raise exception 'the candidate''s source is not a stored official text' using errcode = '22023';
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
    perform private.check_term_links(p_shape, p_links);
    insert into ref.rules (rule_key, shape, domain, node_id, title)
    values (v_c.proposed_rule_key, p_shape, p_domain, p_node, p_title);
  elsif (p_shape is not null and p_shape <> v_rule.shape) or (p_domain is not null and p_domain <> v_rule.domain)
        or (p_node is not null and p_node <> v_rule.node_id) then
    raise exception 'rule % keeps its shape, domain and node; use a new rule key', v_rule.rule_key
      using errcode = '22023';
  else
    perform private.check_term_links(v_rule.shape, p_links);
  end if;

  select max(rv.version) filter (where rv.status = 'accepted'), coalesce(max(rv.version), 0) + 1
  into v_prev, v_version from ref.rule_versions rv where rv.rule_key = v_c.proposed_rule_key;
  if v_prev is null and p_effect_type = 'editorial' then
    raise exception 'a rule''s first version is an obligation, never editorial' using errcode = '22023';
  end if;

  insert into ref.rule_versions (rule_key, version, status, params, applicability, article_ref, source_id,
                                 source_excerpt, effect_type, effective_from, sell_through_until,
                                 supersedes_version, extraction_a, extraction_b, accepted_by, accepted_at)
  values (v_c.proposed_rule_key, v_version, 'accepted', (v_x -> 'params') || coalesce(p_links, '{}'::jsonb),
          p_applicability, v_x ->> 'article_ref', v_c.source_id, v_x ->> 'excerpt', p_effect_type, p_effective_from,
          p_sell_through_until, v_prev, v_c.first_value, v_c.second_value, v_person, now());
  update ref.rule_candidates set decision = 'accepted', decided_by = v_person, decided_at = now()
  where id = p_candidate;

  perform private.write_audit(null, 'rule_version.accepted', 'rule_version',
                              v_c.proposed_rule_key || ':' || v_version, null,
                              jsonb_build_object('candidate_id', p_candidate, 'used', p_use, 'agree', v_c.agree,
                                                 'supersedes_version', v_prev, 'effect_type', p_effect_type,
                                                 'effective_from', p_effective_from,
                                                 'sell_through_until', p_sell_through_until, 'links', p_links));
  return jsonb_build_object('rule_key', v_c.proposed_rule_key, 'version', v_version, 'supersedes_version', v_prev);
end $$;

-- ─── D-31: re-link an accepted rule ──────────────────────────────────────────────────────────────
-- A new accepted version superseding the latest accepted one: its params minus the old links plus the new ones, the
-- same applicability, article, source, excerpt and extractions, effect 'editorial'. Its fixtures are written anew:
-- passed, failed and withheld, before it can be complete or released (P0010, P0039).
create function app.relink_rule(p_rule_key text, p_links jsonb, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_person uuid := private.require_staff(); v_rule ref.rules; v_prev ref.rule_versions; v_params jsonb;
        v_version int;
begin
  select * into v_rule from ref.rules r where r.rule_key = p_rule_key for update;
  if not found then raise exception 'unknown rule %', p_rule_key using errcode = '22023'; end if;
  select * into v_prev from ref.rule_versions rv where rv.rule_key = p_rule_key and rv.status = 'accepted'
  order by rv.version desc limit 1;
  if not found then
    raise exception 'rule % has no accepted version to re-link', p_rule_key using errcode = '22023';
  end if;
  if p_links is null then raise exception 'give the links' using errcode = '22023'; end if;
  perform private.check_term_links(v_rule.shape, p_links);
  v_params := (v_prev.params - private.all_term_link_fields()) || p_links;
  if v_params = v_prev.params then
    raise exception 'rule % v% already carries these links', p_rule_key, v_prev.version using errcode = '22023';
  end if;
  select max(rv.version) + 1 into v_version from ref.rule_versions rv where rv.rule_key = p_rule_key;

  insert into ref.rule_versions (rule_key, version, status, params, applicability, article_ref, source_id,
                                 source_excerpt, effect_type, supersedes_version, extraction_a, extraction_b,
                                 accepted_by, accepted_at)
  values (p_rule_key, v_version, 'accepted', v_params, v_prev.applicability, v_prev.article_ref, v_prev.source_id,
          v_prev.source_excerpt, 'editorial', v_prev.version, v_prev.extraction_a, v_prev.extraction_b, v_person,
          now());
  perform private.write_audit(null, 'rule_version.relinked', 'rule_version', p_rule_key || ':' || v_version,
                              jsonb_build_object('version', v_prev.version,
                                                 'links', (select coalesce(jsonb_object_agg(e.key, e.value), '{}')
                                                           from jsonb_each(v_prev.params) e
                                                           where e.key = any (private.all_term_link_fields()))),
                              jsonb_build_object('version', v_version, 'links', p_links, 'note', p_note));
  return jsonb_build_object('rule_key', p_rule_key, 'version', v_version, 'supersedes_version', v_prev.version);
end $$;

-- ─── Grants ──────────────────────────────────────────────────────────────────────────────────────
revoke all on function app.accept_candidate(uuid,text,text,text,text,text,jsonb,text,date,date,jsonb),
                       app.relink_rule(text,jsonb,text)
  from public, anon;
grant execute on function app.accept_candidate(uuid,text,text,text,text,text,jsonb,text,date,date,jsonb),
                          app.relink_rule(text,jsonb,text)
  to authenticated, service_role;
revoke all on function private.term_link_fields(text), private.all_term_link_fields(),
                       private.linked_term_keys(jsonb), private.check_term_links(text,jsonb),
                       private.coverage_terms_missing(text,text,text), private.coverage_terms_guard(),
                       private.member_terms_guard()
  from public, anon, authenticated;
