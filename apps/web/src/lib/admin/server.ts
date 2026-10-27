// T-205: the only place the web app uses the service role. /admin reads the staff tooling tables (ref.rule_candidates,
// ref.ruleset_drafts*, ref.fixture_runs, candidate terms), which no client role can read (T-204), so the server reads
// them as the service role, and only after the signed-in person's own session shows app_metadata.nutrivo_staff.
// The key is a server environment variable without the NEXT_PUBLIC_ prefix, so no bundle can carry it. Nothing here
// writes: every change is a staff RPC called under the person's own session (src/app/admin/actions.ts).
import "server-only";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { isStaff } from "./staff";

export type StaffGate = { kind: "signed-out" } | { kind: "not-staff" } | { kind: "staff"; user: User };

/** Who is asking, from Supabase Auth (getUser checks the session with Auth, so a revoked one stops here). */
export async function staffGate(): Promise<StaffGate> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { kind: "signed-out" };
  return isStaff(data.user) ? { kind: "staff", user: data.user } : { kind: "not-staff" };
}

export class StaffOnlyError extends Error {
  constructor() {
    super("staff only");
  }
}

/**
 * A service-role client for staff reads. It re-checks staff itself, so no caller can reach it without the check, and
 * it is built per request, never cached in a module.
 */
export async function staffReader(): Promise<SupabaseClient<Database>> {
  if (typeof window !== "undefined") throw new StaffOnlyError();
  const gate = await staffGate();
  if (gate.kind !== "staff") throw new StaffOnlyError();
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed for /admin reads");
  return createServiceClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export class AdminReadError extends Error {
  constructor(what: string, error: { code?: string; message?: string }) {
    super(`admin read failed: ${what} (${error.code ?? "error"})`);
  }
}
