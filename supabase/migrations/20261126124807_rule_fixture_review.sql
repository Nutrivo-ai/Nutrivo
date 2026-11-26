-- Incident #360 · Rule fixtures are proposed by the worker and confirmed by a person (docs/12 Thursday, docs/13).
-- Until now nothing wrote ref.rule_fixtures except the service role, so no ruleset could be released without raw SQL.
--   ref.rule_fixtures       gains a review state: proposed (written by `nutrivo fixtures draft`), confirmed or
--                           rejected (a staff member's decision, with who and when). Rows that existed before this
--                           change were written by hand and count as confirmed; a new row is proposed unless it says
--                           otherwise. A decided row never goes back to proposed or changes its decision.
--   RLS                     the same as ref.rule_versions: authenticated users read confirmed fixtures, staff read all.
--                           Clients still get no write grant; the service role bypasses RLS as before.
--   app.decide_rule_fixture staff at aal2 confirm or reject one proposed fixture of an accepted rule version; audited.
--                           It never touches a rule version, a term or a ruleset (CLAUDE.md 6 and 7).
--   The release gate        private.version_tested, private.ruleset_draft_fixture_count and
--                           private.ruleset_draft_digest count confirmed fixtures only, so a proposed fixture never
--                           makes a version tested (P0039, P0010). With every earlier row confirmed, the digests of
--                           runs recorded before this change are unchanged.
-- Expand only: new nullable columns, a column with a default, a check, a trigger and replaced function bodies.

-- ─── Table ───────────────────────────────────────────────────────────────────────────────────────
alter table ref.rule_fixtures
  add column status        text not null default 'confirmed' check (status in ('proposed','confirmed','rejected')),
  add column proposed_by   text,                          -- the runner that drafted it (nutrivo-worker <v> fixtures_draft)
  add column proposed_at   timestamptz,
  add column decided_by    uuid references app.people(id),
  add column decided_at    timestamptz,
  add column decision_note text;
-- Existing rows took 'confirmed' above; from here on a row nobody confirmed is only a proposal.
alter table ref.rule_fixtures alter column status set default 'proposed';
alter table ref.rule_fixtures add constraint rule_fixtures_proposed_undecided
  check (status <> 'proposed' or (decided_by is null and decided_at is null));
create index rule_fixtures_version_status on ref.rule_fixtures (rule_key, version, status);
create index rule_fixtures_decided_by on ref.rule_fixtures (decided_by);

-- A decision is final: proposed → confirmed | rejected, once. Content corrections are new rows (and a new run).
create function private.rule_fixture_status_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status and not (old.status = 'proposed' and new.status in ('confirmed','rejected')) then
    raise exception 'a % fixture stays %; propose a new one instead', old.status, old.status using errcode = '22023';
  end if;
  if old.status <> 'proposed' and (new.decided_by is distinct from old.decided_by
                                   or new.decided_at is distinct from old.decided_at) then
    raise exception 'a fixture''s decision is never rewritten' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger rule_fixture_status_guard before update on ref.rule_fixtures
  for each row execute function private.rule_fixture_status_guard();

alter table ref.rule_fixtures enable row level security;
create policy read_confirmed on ref.rule_fixtures for select to authenticated
  using (status = 'confirmed' or private.is_staff());
revoke insert, update, delete, truncate on ref.rule_fixtures from authenticated, anon;

-- ─── The release gate counts confirmed fixtures only ─────────────────────────────────────────────
create or replace function private.version_tested(p_rule_key text, p_version int) returns boolean
language sql stable security definer set search_path = '' as $$
  select count(distinct rf.expected_outcome) = 3 from ref.rule_fixtures rf
  where rf.rule_key = p_rule_key and rf.version = p_version and rf.status = 'confirmed'
$$;

create or replace function private.ruleset_draft_fixture_count(p_draft text) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from ref.ruleset_draft_members m
  join ref.rule_fixtures rf on rf.rule_key = m.rule_key and rf.version = m.version and rf.status = 'confirmed'
  where m.draft_id = p_draft
$$;

-- As T-209 left it, with confirmed fixtures only. Confirming or rejecting a fixture changes the confirmed set, so it
-- makes an earlier run stale exactly as a changed fixture does.
create or replace function private.ruleset_draft_digest(p_draft text) returns text
language sql stable security definer set search_path = '' as $$
  select encode(extensions.digest(coalesce(string_agg(
           m.rule_key || ':' || m.version || ':' || coalesce(f.fx, '') || coalesce(':' || t.tx, ''), E'\n'
           order by m.rule_key), ''), 'sha256'), 'hex')
  from ref.ruleset_draft_members m
  join ref.rule_versions rv on rv.rule_key = m.rule_key and rv.version = m.version
  left join lateral (
    select string_agg(md5(jsonb_build_array(rf.id, rf.name, rf.input, rf.expected_outcome, rf.expected)::text), ','
                      order by rf.id) as fx
    from ref.rule_fixtures rf
    where rf.rule_key = m.rule_key and rf.version = m.version and rf.status = 'confirmed') f on true
  left join lateral (
    select string_agg(md5(jsonb_build_array(te.id, te.term_key, te.language, te.term)::text), ','
                      order by te.term_key, te.language, te.id) as tx
    from ref.term_entries te
    where te.term_key = any (private.linked_term_keys(rv.params)) and te.status = 'accepted'
      and te.ruleset_version is null) t on true
  where m.draft_id = p_draft
$$;

-- ─── The staff decision ──────────────────────────────────────────────────────────────────────────
-- p_decision is 'confirm' or 'reject'. Staff work at aal2 (#35 Q6, docs/09); this RPC checks it itself.
create function app.decide_rule_fixture(p_fixture uuid, p_decision text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_person uuid := private.require_staff(); v_f ref.rule_fixtures; v_status text;
begin
  if not private.aal2() then
    raise exception 'staff decide fixtures at aal2: prove your second factor first' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('confirm','reject') then
    raise exception 'a fixture decision is confirm or reject' using errcode = '22023';
  end if;
  select * into v_f from ref.rule_fixtures f where f.id = p_fixture for update;
  if not found then raise exception 'unknown fixture' using errcode = '22023'; end if;
  if v_f.status <> 'proposed' then
    raise exception 'fixture is already %', v_f.status using errcode = '22023';
  end if;
  if not exists (select 1 from ref.rule_versions rv where rv.rule_key = v_f.rule_key and rv.version = v_f.version
                 and rv.status = 'accepted') then
    raise exception 'only a fixture of an accepted rule version is decided (% v%)', v_f.rule_key, v_f.version
      using errcode = '22023';
  end if;
  v_status := case p_decision when 'confirm' then 'confirmed' else 'rejected' end;
  update ref.rule_fixtures
  set status = v_status, decided_by = v_person, decided_at = now(), decision_note = nullif(trim(p_note), '')
  where id = p_fixture;
  perform private.write_audit(null, 'rule_fixture.' || v_status, 'rule_fixture', p_fixture::text,
                              jsonb_build_object('status', v_f.status),
                              jsonb_build_object('status', v_status, 'rule_key', v_f.rule_key,
                                                 'version', v_f.version, 'expected_outcome', v_f.expected_outcome,
                                                 'note', nullif(trim(p_note), '')));
  return jsonb_build_object('id', p_fixture, 'status', v_status, 'rule_key', v_f.rule_key, 'version', v_f.version,
                            'tested', private.version_tested(v_f.rule_key, v_f.version));
end $$;

revoke all on function app.decide_rule_fixture(uuid,text,text) from public, anon;
grant execute on function app.decide_rule_fixture(uuid,text,text) to authenticated, service_role;
revoke all on function private.rule_fixture_status_guard() from public, anon, authenticated;
