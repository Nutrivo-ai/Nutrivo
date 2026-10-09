-- GATES BE-32 BE-36 (+ BE-29) · the three-label allowance, dunning that never deletes, certificate preconditions.
-- Human-owned file. Do not edit to make a build pass.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(9);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a1','alice@a.test');
insert into app.people (id, user_id, display_name) values
  ('10000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a1','Alice');
insert into app.workspaces (id, name) values ('20000000-0000-4000-8000-00000000000a','Workspace A');
insert into app.memberships (workspace_id, person_id, role) values
  ('20000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-0000000000a1','admin');
insert into app.allowances (workspace_id) values ('20000000-0000-4000-8000-00000000000a');
insert into app.families (id, workspace_id, name) values
  ('30000000-0000-4000-8000-00000000000a','20000000-0000-4000-8000-00000000000a','Family A');
insert into app.products (id, workspace_id, family_id, name)
select ('40000000-0000-4000-8000-00000000000' || n)::uuid, '20000000-0000-4000-8000-00000000000a',
       '30000000-0000-4000-8000-00000000000a', 'Product ' || n
from generate_series(1, 4) n;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select lives_ok($$select app.register_artwork('40000000-0000-4000-8000-000000000001','artwork/a/1.pdf','sha-1')$$,
                'an editor registers a first artwork');
select app.register_artwork('40000000-0000-4000-8000-000000000001','artwork/a/1.pdf','sha-1');
select app.register_artwork('40000000-0000-4000-8000-000000000002','artwork/a/2.pdf','sha-2');
select app.register_artwork('40000000-0000-4000-8000-000000000003','artwork/a/3.pdf','sha-3');
reset role;
select is((select labels_used from app.allowances), 3, 'BE-32: three new artworks count three');

select private.consume_allowance(av.id) from app.artwork_versions av, generate_series(1, 20)
where av.product_id = '40000000-0000-4000-8000-000000000001';
select is((select labels_used from app.allowances), 3, 'BE-32: re-checking a label twenty times keeps the counter at three');

set local role authenticated;
select app.register_artwork('40000000-0000-4000-8000-000000000002','artwork/a/2b.pdf','sha-2-revised');
select throws_ok($$select app.register_artwork('40000000-0000-4000-8000-000000000004','artwork/a/4.pdf','sha-4')$$,
                 'P0032', null, 'BE-32: a fourth new artwork is refused once the free allowance is used');
reset role;
select is((select labels_used from app.allowances), 3, 'BE-32: a revised version of label two does not make it four');

update app.workspaces set plan = 'basic', status = 'new_artwork_stopped';
set local role authenticated;
select throws_ok($$select app.register_artwork('40000000-0000-4000-8000-000000000004','artwork/a/4.pdf','sha-4')$$,
                 'P0036', null, 'BE-36: day 14 of dunning stops new artworks');
select lives_ok($$select app.register_artwork('40000000-0000-4000-8000-000000000001','artwork/a/1b.pdf','sha-1-revised')$$,
                'BE-36: revisions of existing artworks keep working during dunning');
reset role;

insert into app.reports (workspace_id, product_id, node_id, ref, check_ids, ruleset_version, artwork_sha, has_not_assessed)
values ('20000000-0000-4000-8000-00000000000a','40000000-0000-4000-8000-000000000001','EU-SE',
        'nv-gate-reference-000000001','{}','0000.00-empty','sha-1',true);
update app.workspaces set status = 'closed';
select is(public.verify_reference('nv-gate-reference-000000001') ->> 'status', 'current',
          'BE-36: a closed workspace never breaks verification of a document somebody else holds');

select throws_ok($$select app.issue_certificate((select id from app.reports where ref = 'nv-gate-reference-000000001'), 'US-TX')$$,
                 'P0291', null, 'BE-29: no signing grant for Texas, no certificate, and the error names the precondition');

select * from finish();
rollback;
