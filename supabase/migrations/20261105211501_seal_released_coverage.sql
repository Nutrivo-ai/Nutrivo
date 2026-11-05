-- #197 (#8 DB-3) · Seal released coverage. Founder decision (abnutrivo, 3 Nov 2026, on #8): a released ruleset's
-- coverage rows become immutable; changes go into the next draft ruleset.
--
-- A seal row is written for every ref.ruleset_versions row when the transaction that inserted it commits (a deferred
-- constraint trigger), so it is always written last: the release itself (app.release_ruleset, unchanged) still
-- inserts its members, coverage and gap bookkeeping in the same transaction, and every release path is sealed
-- without having to remember to. Once sealed, P0047 refuses:
--   ref.coverage_nodes   INSERT, UPDATE or DELETE of a sealed version's rows; TRUNCATE
--   ref.ruleset_members  INSERT into a sealed version (UPDATE, DELETE, TRUNCATE are already P0005)
--   ref.rules            UPDATE or DELETE of a rule a sealed version pins (its shape, domain and node decide coverage);
--                        TRUNCATE
--   ref.rule_versions    TRUNCATE while a sealed version pins one (UPDATE and DELETE of accepted ones are P0008)
--   ref.coverage_gaps    for a gap that sealed coverage names: DELETE, TRUNCATE, and any change to gap_id, node_id,
--                        domain or reason_code. opened_in and closed_in may each be set once, from null to a ruleset
--                        that is not sealed yet, which only a release in progress can do: that is the K05 gap
--                        bookkeeping (release N+1 closes gaps that sealed release N names). description stays
--                        editable wording (#197 asks a founder whether to freeze it too).
-- Drafts (ref.ruleset_draft_*) are not touched: private.open_draft already refuses a released id.
-- New P-code: P0047.

-- ─── The seal ────────────────────────────────────────────────────────────────────────────────────
create table ref.ruleset_seals (                 -- insert-only; written only by private.seal_ruleset at commit
  ruleset_version text primary key references ref.ruleset_versions(id),
  sealed_at       timestamptz not null default clock_timestamp()
);
revoke all on ref.ruleset_seals from public, anon, authenticated, service_role;
grant select on ref.ruleset_seals to service_role;
create trigger insert_only_row before update or delete on ref.ruleset_seals
  for each row execute function private.reject_mutation();
create trigger insert_only_truncate before truncate on ref.ruleset_seals
  for each statement execute function private.reject_mutation();

create function private.seal_ruleset() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into ref.ruleset_seals (ruleset_version) values (new.id) on conflict (ruleset_version) do nothing;
  return null;
end $$;
-- Fires at commit of the releasing transaction, after everything the release wrote. `set constraints
-- ruleset_seal immediate` only seals earlier, never later.
create constraint trigger ruleset_seal after insert on ref.ruleset_versions
  deferrable initially deferred for each row execute function private.seal_ruleset();

-- Every ruleset released before this migration is sealed now.
insert into ref.ruleset_seals (ruleset_version) select rv.id from ref.ruleset_versions rv;

create function private.ruleset_sealed(p_ruleset text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from ref.ruleset_seals s where s.ruleset_version = p_ruleset)
$$;

-- A rule pinned by a sealed ruleset (null rule_key: any such rule).
create function private.rule_sealed(p_rule_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from ref.ruleset_members m join ref.ruleset_seals s on s.ruleset_version = m.ruleset_version
                 where p_rule_key is null or m.rule_key = p_rule_key)
$$;

-- A gap named by sealed coverage (null gap_id: any such gap).
create function private.gap_sealed(p_gap_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from ref.coverage_nodes c join ref.ruleset_seals s on s.ruleset_version = c.ruleset_version
                 where c.gap_id is not null and (p_gap_id is null or c.gap_id = p_gap_id))
$$;

-- ─── Guards ──────────────────────────────────────────────────────────────────────────────────────
create function private.coverage_seal_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'TRUNCATE' then
    if exists (select 1 from ref.coverage_nodes c join ref.ruleset_seals s on s.ruleset_version = c.ruleset_version) then
      raise exception '#197: released coverage is sealed; % % is not permitted', tg_table_name, tg_op
        using errcode = 'P0047';
    end if;
    return null;
  end if;
  if tg_op in ('UPDATE','DELETE') and private.ruleset_sealed(old.ruleset_version) then
    raise exception '#197: coverage of released ruleset % is sealed; change it in the next draft', old.ruleset_version
      using errcode = 'P0047';
  end if;
  if tg_op in ('INSERT','UPDATE') and private.ruleset_sealed(new.ruleset_version) then
    raise exception '#197: coverage of released ruleset % is sealed; change it in the next draft', new.ruleset_version
      using errcode = 'P0047';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger ruleset_seal_row before insert or update or delete on ref.coverage_nodes
  for each row execute function private.coverage_seal_guard();
create trigger ruleset_seal_truncate before truncate on ref.coverage_nodes
  for each statement execute function private.coverage_seal_guard();

create function private.member_seal_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.ruleset_sealed(new.ruleset_version) then
    raise exception '#197: released ruleset % is sealed; add % to the next draft', new.ruleset_version, new.rule_key
      using errcode = 'P0047';
  end if;
  return new;
end $$;
create trigger ruleset_seal_row before insert on ref.ruleset_members
  for each row execute function private.member_seal_guard();

create function private.rule_seal_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'TRUNCATE' then
    if private.rule_sealed(null) then
      raise exception '#197: released rulesets pin rules; % % is not permitted', tg_table_name, tg_op
        using errcode = 'P0047';
    end if;
    return null;
  end if;
  if private.rule_sealed(old.rule_key) then
    raise exception '#197: rule % is pinned by a released ruleset; use a new rule key or version', old.rule_key
      using errcode = 'P0047';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger ruleset_seal_row before update or delete on ref.rules
  for each row execute function private.rule_seal_guard();
create trigger ruleset_seal_truncate before truncate on ref.rules
  for each statement execute function private.rule_seal_guard();
create trigger ruleset_seal_truncate before truncate on ref.rule_versions
  for each statement execute function private.rule_seal_guard();

create function private.gap_seal_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'TRUNCATE' then
    if private.gap_sealed(null) then
      raise exception '#197: released coverage names gaps; % % is not permitted', tg_table_name, tg_op
        using errcode = 'P0047';
    end if;
    return null;
  end if;
  if not private.gap_sealed(old.gap_id) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE'
     or new.gap_id is distinct from old.gap_id or new.node_id is distinct from old.node_id
     or new.domain is distinct from old.domain or new.reason_code is distinct from old.reason_code then
    raise exception '#197: gap % is named by released coverage; open a new gap in the next draft', old.gap_id
      using errcode = 'P0047';
  end if;
  -- K05 bookkeeping: set once, by the release in progress (not yet sealed), never rewritten afterwards.
  if (new.opened_in is distinct from old.opened_in
      and (old.opened_in is not null or new.opened_in is null or private.ruleset_sealed(new.opened_in)))
     or (new.closed_in is distinct from old.closed_in
      and (old.closed_in is not null or new.closed_in is null or private.ruleset_sealed(new.closed_in))) then
    raise exception '#197: gap % opened_in and closed_in are set once, by the release in progress', old.gap_id
      using errcode = 'P0047';
  end if;
  return new;
end $$;
create trigger ruleset_seal_row before update or delete on ref.coverage_gaps
  for each row execute function private.gap_seal_guard();
create trigger ruleset_seal_truncate before truncate on ref.coverage_gaps
  for each statement execute function private.gap_seal_guard();

revoke all on function private.seal_ruleset(), private.ruleset_sealed(text), private.rule_sealed(text),
                       private.gap_sealed(text), private.coverage_seal_guard(), private.member_seal_guard(),
                       private.rule_seal_guard(), private.gap_seal_guard()
  from public, anon, authenticated;
