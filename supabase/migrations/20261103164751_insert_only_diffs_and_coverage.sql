-- ref.rule_diffs and ref.coverage_nodes join the insert-only list (BE-05), a follow-up from the T-204 review.
-- A released ruleset's coverage and its typed diffs are the record that alerts (J03) and the public coverage page
-- (P01, BE-10) are built from; a correction is a new release, never an edit. app.release_ruleset only inserts them,
-- and nothing in the repository updates or deletes either table.
do $$
declare t text;
begin
  foreach t in array array['ref.rule_diffs','ref.coverage_nodes'] loop
    execute format('revoke update, delete, truncate on %s from authenticated, service_role, anon', t);
    execute format('create trigger insert_only_row before update or delete on %s for each row execute function private.reject_mutation()', t);
    execute format('create trigger insert_only_truncate before truncate on %s for each statement execute function private.reject_mutation()', t);
  end loop;
end $$;
