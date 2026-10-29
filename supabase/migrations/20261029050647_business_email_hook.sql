-- T-109 · Business emails only (D-27): no new account for a consumer or free-mail address, on any route.
-- Tests: supabase/tests/app/50_business_email_hook.test.sql; apps/web/tests/e2e/business-sign-in.spec.ts.
--
-- Supabase Auth calls private.before_user_created_hook before it inserts a row in auth.users, whatever created it:
-- email and password, a sign-in link with shouldCreateUser, an invitation, Google or Microsoft. The hook is configured
-- in supabase/config.toml locally and in the dashboard on hosted projects (Authentication → Hooks). It never runs for
-- an account that already exists, so a sign-in, a password reset or a Google or Microsoft identity linked to an
-- existing account is never refused (D-27, "Existing accounts").
--
-- The list is versioned here, in migrations: a founder extends it with a new migration that inserts rows under a new
-- list_version. Version 2026-10-29.1 is exactly the domains D-27 names; "and similar" and the disposable-mail domains
-- wait for a named source (#138).

create table private.consumer_email_domains (
  pattern text primary key check (pattern = lower(pattern) and pattern !~ '[@\s]' and pattern !~ '^\.|\.$'),
  -- exact: the domain itself. any_tld: the name under any top-level domain, one label (outlook.de) or a second-level
  -- country domain (outlook.co.uk), never a subdomain of somebody else's domain (outlook.acme.com).
  match text not null check (match in ('exact', 'any_tld')),
  list_version text not null,
  source text not null,
  added_at timestamptz not null default now()
);
comment on table private.consumer_email_domains is
  'D-27: consumer and free-mail domains refused at account creation by private.before_user_created_hook. Extended only by migration, under a new list_version.';

alter table private.consumer_email_domains enable row level security;
revoke all on private.consumer_email_domains from public, anon, authenticated;
grant select on private.consumer_email_domains to supabase_auth_admin;
grant all on private.consumer_email_domains to service_role;
create policy read_auth_hook on private.consumer_email_domains for select to supabase_auth_admin using (true);

insert into private.consumer_email_domains (pattern, match, list_version, source) values
  ('gmail.com',      'exact',   '2026-10-29.1', 'D-27'),
  ('googlemail.com', 'exact',   '2026-10-29.1', 'D-27'),
  ('outlook',        'any_tld', '2026-10-29.1', 'D-27'),
  ('hotmail',        'any_tld', '2026-10-29.1', 'D-27'),
  ('live',           'any_tld', '2026-10-29.1', 'D-27'),
  ('msn.com',        'exact',   '2026-10-29.1', 'D-27'),
  ('yahoo',          'any_tld', '2026-10-29.1', 'D-27'),
  ('icloud.com',     'exact',   '2026-10-29.1', 'D-27'),
  ('me.com',         'exact',   '2026-10-29.1', 'D-27'),
  ('aol.com',        'exact',   '2026-10-29.1', 'D-27'),
  ('gmx',            'any_tld', '2026-10-29.1', 'D-27'),
  ('web.de',         'exact',   '2026-10-29.1', 'D-27'),
  ('proton.me',      'exact',   '2026-10-29.1', 'D-27'),
  ('protonmail.com', 'exact',   '2026-10-29.1', 'D-27'),
  ('yandex',         'any_tld', '2026-10-29.1', 'D-27'),
  ('mail.ru',        'exact',   '2026-10-29.1', 'D-27');

-- True when an email address may not open a new account. The domain is compared lower-cased without a trailing dot;
-- an address with no domain at all is refused too, since an account without a reachable work address is not one.
create function private.is_consumer_email(p_email text) returns boolean
language sql stable set search_path = '' as $$
  with d as (select rtrim(lower(btrim(substring(coalesce(p_email, '') from '@([^@]*)$'))), '.') as domain)
  select d.domain is null or d.domain = '' or exists (
    select 1 from private.consumer_email_domains c
    where (c.match = 'exact' and d.domain = c.pattern)
       or (c.match = 'any_tld' and starts_with(d.domain, c.pattern || '.')
           and substr(d.domain, length(c.pattern) + 2) ~ '^([a-z]{2,63}|(co|com|net|org)\.[a-z]{2})$'))
  from d
$$;

-- The Before User Created hook (Supabase Auth). {} lets the account be created; an error refuses it with 403, and
-- Supabase Auth hands the message back to the caller (signUp, signInWithOtp, inviteUserByEmail) or, for Google and
-- Microsoft, to /auth/callback as error_description. The web app matches the fixed marker, never shows the text.
create function private.before_user_created_hook(event jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
begin
  if private.is_consumer_email(event -> 'user' ->> 'email') then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'business_email_required: Nutrivo accounts use a work email address.'));
  end if;
  return '{}'::jsonb;
end $$;

grant usage on schema private to supabase_auth_admin;
revoke all on function private.is_consumer_email(text), private.before_user_created_hook(jsonb) from public, anon, authenticated;
grant execute on function private.is_consumer_email(text), private.before_user_created_hook(jsonb) to supabase_auth_admin;
grant execute on function private.is_consumer_email(text) to service_role;
