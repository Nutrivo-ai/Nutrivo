// T-205: the only place the web app uses the service role. /admin reads the staff tooling tables (ref.rule_candidates,
// ref.ruleset_drafts*, ref.fixture_runs, candidate terms), which no client role can read (T-204), so the server reads
// them as the service role, and only after the signed-in person's own session shows app_metadata.nutrivo_staff.
// The key is a server environment variable without the NEXT_PUBLIC_ prefix, so no bundle can carry it. Nothing here
// writes: every change is a staff RPC called under the person's own session (src/app/admin/actions.ts).
import "server-only";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { signInHref } from "@/lib/auth/rules";
import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { ADMIN_MFA, isStaff, staffMfa } from "./staff";

export type StaffGate =
  | { kind: "signed-out" }
  | { kind: "not-staff" }
  /** Staff, but this session has not proved a second factor (aal2) yet: enrol or challenge first (#35 Q6). */
  | { kind: "step-up"; to: "challenge" | "enrol" }
  | { kind: "staff"; user: User };

/**
 * Who is asking, from Supabase Auth (getUser checks the session with Auth, so a revoked one stops here), and whether
 * this session is at aal2. The layout, staffReader and every staff action ask it, because a layout is not rendered
 * again on client navigation.
 */
export async function staffGate(): Promise<StaffGate> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { kind: "signed-out" };
  if (!isStaff(data.user)) return { kind: "not-staff" };
  const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance.error) throw new Error(`assurance level could not be read (${assurance.error.code ?? "error"})`);
  const mfa = staffMfa(assurance.data);
  return mfa === "ok" ? { kind: "staff", user: data.user } : { kind: "step-up", to: mfa };
}

export class StaffOnlyError extends Error {
  constructor() {
    super("staff only");
  }
}

/**
 * A service-role client for staff reads. It re-checks staff and aal2 itself, so no caller can reach it without the check, and
 * it is built per request, never cached in a module.
 */
export async function staffReader(): Promise<SupabaseClient<Database>> {
  if (typeof window !== "undefined") throw new StaffOnlyError();
  const gate = await staffGate();
  if (gate.kind === "signed-out") redirect(signInHref("/admin"));
  if (gate.kind === "step-up") redirect(ADMIN_MFA);
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
