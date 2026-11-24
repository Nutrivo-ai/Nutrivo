// People and workspaces for end-to-end tests, made the way the product makes them: an auth user through the admin
// API, a session through a one-time magic-link token (never a password), and workspaces only through the
// app.create_workspace RPC signed in as that person. Every run uses fresh random emails, so runs never collide.
import { randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type { BrowserContext } from "@playwright/test";
import type { Database } from "../../../src/lib/database.types";

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set: scripts/ci/e2e.sh exports it from the local Supabase stack`);
  return value;
}

/** True when the local stack's variables are present (scripts/ci/e2e.sh); the shell tests need them. */
export function haveStack() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

const url = () => env("NEXT_PUBLIC_SUPABASE_URL");
const anon = () => env("NEXT_PUBLIC_SUPABASE_ANON_KEY");

/** The service-role client: test setup only, never in the app's browser code. */
export function admin(): SupabaseClient<Database> {
  return createClient<Database>(url(), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
}

export type Person = { email: string; userId: string; session: Session; db: SupabaseClient<Database> };

/** A confirmed auth user, signed in by a magic-link token, with a client that acts as them under RLS. */
export async function person(label: string): Promise<Person> {
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const service = admin();
  const created = await service.auth.admin.createUser({ email, email_confirm: true });
  if (created.error) throw created.error;
  const link = await service.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;
  const db = createClient<Database>(url(), anon(), { auth: { persistSession: false, autoRefreshToken: false } });
  const verified = await db.auth.verifyOtp({ type: "email", token_hash: link.data.properties.hashed_token });
  if (verified.error || !verified.data.session) throw verified.error ?? new Error("no session from the magic link");
  return { email, userId: created.data.user.id, session: verified.data.session, db };
}

/** A workspace created by `who` through app.create_workspace: they are its admin. */
export async function workspace(who: Person, name: string): Promise<string> {
  const { data, error } = await who.db.schema("app").rpc("create_workspace", { p_name: name });
  if (error) throw error;
  return data;
}

/**
 * Signs the browser context in as `who`: @supabase/ssr writes its own session cookies (name, chunking and encoding
 * are its business), and they are copied into the context for the app's origin.
 */
export async function signIn(context: BrowserContext, who: Person, baseURL: string) {
  const jar: { name: string; value: string }[] = [];
  const ssr = createServerClient<Database>(url(), anon(), {
    cookies: {
      getAll: () => jar,
      setAll: (cookies) => {
        for (const c of cookies) {
          const i = jar.findIndex((j) => j.name === c.name);
          if (i >= 0) jar.splice(i, 1);
          if (c.value) jar.push({ name: c.name, value: c.value });
        }
      },
    },
  });
  const { error } = await ssr.auth.setSession({
    access_token: who.session.access_token,
    refresh_token: who.session.refresh_token,
  });
  if (error) throw error;
  await context.clearCookies();
  await context.addCookies(jar.map((c) => ({ ...c, url: baseURL, sameSite: "Lax" as const })));
}
