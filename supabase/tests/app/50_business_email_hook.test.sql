-- T-109 · Business emails only (D-27): private.before_user_created_hook, called by Supabase Auth before every new
-- auth.users row. The events below are the shapes Supabase Auth sends for each route; the real routes against the
-- local Supabase Auth are in apps/web/tests/e2e/business-sign-in.spec.ts.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select plan(28);
set local client_min_messages = warning;

create temp table refusal as select jsonb_build_object('error', jsonb_build_object('http_code', 403,
  'message', 'business_email_required: Nutrivo accounts use a work email address.')) as body;

-- The event Supabase Auth sends: the user it is about to create, with the provider in app_metadata.
create function pg_temp.ev(p_email text, p_provider text) returns jsonb language sql as $$
  select jsonb_build_object('metadata', jsonb_build_object('name', 'before-user-created'),
    'user', jsonb_build_object('email', p_email, 'app_metadata', jsonb_build_object('provider', p_provider)))
$$;

-- ─── Each route's event (the local stack cannot switch to supabase_auth_admin; its grants are checked below) ─────

select is(private.before_user_created_hook(pg_temp.ev('pat@gmail.com', 'email')), (select body from refusal),
  '[T-109] email and password: a gmail.com sign-up is refused');
select is(private.before_user_created_hook(pg_temp.ev('pat@yahoo.co.uk', 'email')), (select body from refusal),
  '[T-109] sign-in link with shouldCreateUser: yahoo.co.uk is refused');
select is(private.before_user_created_hook(pg_temp.ev('pat@outlook.de', 'email') || '{"metadata":{"name":"before-user-created","invited":true}}'),
  (select body from refusal), '[T-109] invitation: outlook.de is refused');
select is(private.before_user_created_hook(pg_temp.ev('pat@googlemail.com', 'google')), (select body from refusal),
  '[T-109] Continue with Google: googlemail.com is refused');
select is(private.before_user_created_hook(pg_temp.ev('pat@hotmail.com', 'azure')), (select body from refusal),
  '[T-109] Continue with Microsoft: hotmail.com is refused');
select is(private.before_user_created_hook(pg_temp.ev('mia@haldenpet.com', 'email')), '{}'::jsonb,
  '[T-109] a business domain is allowed by email and password');
select is(private.before_user_created_hook(pg_temp.ev('mia@haldenpet.com', 'google')), '{}'::jsonb,
  '[T-109] a business domain is allowed through Google');
select is(private.before_user_created_hook(pg_temp.ev('mia@haldenpet.com', 'azure')), '{}'::jsonb,
  '[T-109] a business domain is allowed through Microsoft');
select is(private.before_user_created_hook(pg_temp.ev(null, 'email')), (select body from refusal),
  '[T-109] an event without an email is refused, never guessed');
select is(private.before_user_created_hook('{}'::jsonb), (select body from refusal),
  '[T-109] an empty event is refused');

-- ─── The domain match ────────────────────────────────────────────────────────────────────────────────────────────
select ok(private.is_consumer_email('Pat@GMail.COM'), '[T-109] the domain is compared case-insensitively');
select ok(private.is_consumer_email('pat@gmail.com.'), '[T-109] a trailing dot does not get around the list');
select ok(private.is_consumer_email('"a@b"@gmail.com'), '[T-109] the domain is what follows the last @');
select ok(private.is_consumer_email('pat@web.de'), '[T-109] exact entries: web.de');
select ok(private.is_consumer_email('pat@proton.me'), '[T-109] exact entries: proton.me');
select ok(private.is_consumer_email('pat@live.se'), '[T-109] any top-level domain: live.se');
select ok(private.is_consumer_email('pat@gmx.net'), '[T-109] any top-level domain: gmx.net');
select ok(private.is_consumer_email('pat@yandex.com.tr'), '[T-109] any top-level domain: a second-level country domain');
select ok(not private.is_consumer_email('pat@outlook.acme.com'), '[T-109] a company subdomain named outlook is allowed');
select ok(not private.is_consumer_email('pat@mail.gmail.com.acme.test'), '[T-109] a free-mail name inside a company domain is allowed');
select ok(not private.is_consumer_email('pat@notgmail.com'), '[T-109] exact entries never match a longer name');
select ok(not private.is_consumer_email('pat@hotmailer.com'), '[T-109] any_tld entries never match a longer name');

-- ─── Only Supabase Auth can call it and read the list ────────────────────────────────────────────────────────────
select ok(has_function_privilege('supabase_auth_admin', 'private.before_user_created_hook(jsonb)', 'execute')
      and has_schema_privilege('supabase_auth_admin', 'private', 'usage')
      and has_table_privilege('supabase_auth_admin', 'private.consumer_email_domains', 'select'),
  '[T-109] Supabase Auth can execute the hook and read the list');
select ok(not has_function_privilege('anon', 'private.before_user_created_hook(jsonb)', 'execute')
      and not has_function_privilege('authenticated', 'private.before_user_created_hook(jsonb)', 'execute'),
  '[T-109] anon and authenticated cannot execute the hook');
select ok(not has_table_privilege('anon', 'private.consumer_email_domains', 'select')
      and not has_table_privilege('authenticated', 'private.consumer_email_domains', 'select')
      and not has_table_privilege('supabase_auth_admin', 'private.consumer_email_domains', 'insert'),
  '[T-109] anon and authenticated cannot read the list, and Supabase Auth cannot change it');
select ok((select relrowsecurity from pg_class where oid = 'private.consumer_email_domains'::regclass),
  '[T-109] the list has row level security on');
select is((select count(distinct list_version)::int from private.consumer_email_domains where list_version = '2026-10-29.1'), 1,
  '[T-109] the seeded list is versioned');

-- ─── Existing accounts keep working: the hook is consulted only for a new user ───────────────────────────────────
insert into auth.users (id, email, encrypted_password)
values ('00000000-0000-4000-8109-0000000000a1', 'legacy@gmail.com', '$2a$10$legacy-hash');
update auth.users set last_sign_in_at = now() where id = '00000000-0000-4000-8109-0000000000a1';
select is((select count(*)::int from auth.users where email = 'legacy@gmail.com' and last_sign_in_at is not null), 1,
  '[T-109] an existing free-mail account is untouched: nothing in the database refuses its sign-in');

select * from finish();
rollback;
