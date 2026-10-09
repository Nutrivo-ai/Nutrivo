-- App tests (owned by Claude Code): one file per area, each proving cross-workspace isolation for what it adds.
-- Gate tests live in ../gates/ and are human-owned. Pattern: begin; plan(n); ...; finish(); rollback;
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(1);
select ok(true, 'app test suite is wired up');
select * from finish();
rollback;
