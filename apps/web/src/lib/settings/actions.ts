"use server";

// T-107: every write the settings screens make, as Server Actions under the person's own session. Workspace data is
// written only through the app RPCs (app.invite_member, change_member, remove_member, revoke_invitation,
// set_default_operator); a password and sessions only through Supabase Auth. Nothing uses the service role, and a
// failure goes to Sentry by its error code with the request id, never with what was typed (docs/17).
import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";
import { checkPassword, PASSWORD_PROBLEM } from "@/lib/auth/rules";
import { readOperator, OPERATOR_PROBLEM } from "@/lib/onboarding/rules";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/observability/request-id";
import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { isRole } from "@/lib/shell/routes";

/** Why a write did not happen, in the RPCs' own error codes (docs/04). */
export type Refusal =
  | "no-permission" // 42501
  | "no-seat" // P0033: BE-33, then the upsell
  | "last-admin" // P0043
  | "ended" // P0044: the membership ended meanwhile
  | "accepted" // P0040 on revoke: accepted meanwhile
  | "invalid" // 22023, or refused before the call
  | "error";

export type Result<T = string> = { ok: true; value: T } | { ok: false; reason: Refusal; problem?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CODES: Record<string, Refusal> = {
  "42501": "no-permission",
  P0033: "no-seat",
  P0043: "last-admin",
  P0044: "ended",
  P0040: "accepted",
  "22023": "invalid",
};

const appClient = async () => (await createClient()).schema("app");
type App = Awaited<ReturnType<typeof appClient>>;
type Answer = { data: unknown; error: { code?: string; message: string } | null };

/** Runs one RPC under the person's session with the request id on the Sentry scope; unexpected codes are reported. */
async function rpc(name: string, call: (app: App) => PromiseLike<Answer>): Promise<Result> {
  const requestId = resolveRequestId((await headers()).get(REQUEST_ID_HEADER));
  return Sentry.withScope(async (scope) => {
    scope.setTag("request_id", requestId);
    scope.setTag("area", "settings");
    const { data, error } = await call(await appClient());
    if (error) {
      const reason = (error.code && CODES[error.code]) || "error";
      if (reason === "error") Sentry.captureException(new Error(`${name} failed: ${error.code ?? "error"}`));
      return { ok: false, reason } as const;
    }
    return { ok: true, value: String(data) } as const;
  });
}

export type ScopeInput = { familyIds: string[] | null; nodeIds: string[] | null; endsAt: string | null };

/** A scope as the RPCs take it: null lists mean everything, an empty list is refused there, so it is null here too. */
function scopeArgs(scope: ScopeInput) {
  const families = scope.familyIds?.filter((id) => UUID.test(id)) ?? null;
  const nodes = scope.nodeIds?.filter((id) => /^[A-Z]{2,3}(-[A-Z0-9]{2,3})?$/.test(id)) ?? null;
  const ends = scope.endsAt && !Number.isNaN(Date.parse(scope.endsAt)) ? new Date(scope.endsAt).toISOString() : null;
  return {
    p_scope_family_ids: families && families.length ? families : null,
    p_scope_node_ids: nodes && nodes.length ? nodes : null,
    p_access_ends_at: ends,
  };
}

/** A03: invite, or resend a pending invitation to the same address (app.invite_member returns the same id then). */
export async function inviteMember(
  workspaceId: string,
  input: { email: string; role: string; external: boolean } & ScopeInput,
): Promise<Result> {
  const email = input.email.trim().toLowerCase();
  if (!UUID.test(workspaceId) || !isRole(input.role)) return { ok: false, reason: "invalid" };
  if (!EMAIL.test(email)) return { ok: false, reason: "invalid", problem: "Type the address the invitation goes to." };
  const scope = scopeArgs(input);
  // Absent arguments take the RPC's defaults: null scope (everything) and no end date.
  const args = {
    p_ws: workspaceId,
    p_email: email,
    p_role: input.role,
    p_is_external: input.external,
    p_scope_family_ids: scope.p_scope_family_ids ?? undefined,
    p_scope_node_ids: scope.p_scope_node_ids ?? undefined,
    p_access_ends_at: scope.p_access_ends_at ?? undefined,
  };
  return rpc("invite_member", (app) => app.rpc("invite_member", args));
}

/** A05: the whole editable state of a membership; nothing is cleared by omission. */
export async function changeMember(
  membershipId: string,
  input: { role: string; external: boolean } & ScopeInput,
): Promise<Result> {
  if (!UUID.test(membershipId) || !isRole(input.role)) return { ok: false, reason: "invalid" };
  // The whole state is passed, nulls included (null scope = everything, null end = none); the generated types do not
  // mark these arguments nullable, hence the cast.
  const args = { p_membership: membershipId, p_role: input.role, p_is_external: input.external, ...scopeArgs(input) } as unknown as
    Database["app"]["Functions"]["change_member"]["Args"];
  return rpc("change_member", (app) => app.rpc("change_member", args));
}

/** A06: ends the membership; app.remove_member revokes signing grants and queues the sign-out. */
export async function removeMember(membershipId: string, reason: string): Promise<Result> {
  if (!UUID.test(membershipId)) return { ok: false, reason: "invalid" };
  const args = { p_membership: membershipId, p_reason: reason.trim().slice(0, 500) || undefined };
  return rpc("remove_member", (app) => app.rpc("remove_member", args));
}

/** A03: revokes a pending invitation; its queued email is cancelled. */
export async function revokeInvitation(invitationId: string): Promise<Result> {
  if (!UUID.test(invitationId)) return { ok: false, reason: "invalid" };
  return rpc("revoke_invitation", (app) => app.rpc("revoke_invitation", { p_invitation: invitationId }));
}

/** B01: the default responsible operator, exactly as printed; the country is the code the address ends with. */
export async function saveOperator(
  workspaceId: string,
  input: { name: string; address: string; approval: string },
): Promise<Result> {
  if (!UUID.test(workspaceId)) return { ok: false, reason: "invalid" };
  const read = readOperator(input);
  if (!read.ok) {
    return {
      ok: false,
      reason: "invalid",
      problem:
        read.problem === "country"
          ? "The country could not be read from the end of the address. End it with the two-letter country code, as in “…, SE”."
          : OPERATOR_PROBLEM[read.problem],
    };
  }
  const args = { p_ws: workspaceId, p_operator: read.operator };
  return rpc("set_default_operator", (app) => app.rpc("set_default_operator", args));
}

/** Reports an Auth failure by its code only. */
function reportAuth(where: string, error: { code?: string; name: string; status?: number }) {
  Sentry.captureMessage(`auth ${where} failed: ${error.code ?? error.name}`, {
    level: "error",
    tags: { area: "auth", auth_step: where, auth_code: error.code ?? "none" },
    extra: { status: error.status },
  });
}

/**
 * A07 from Your account: the new password, typed twice, then every other session ends (A07 step 2). The database
 * audits access.password_changed and never the secret (A07.must.1).
 */
export async function changePassword(password: string, again: string): Promise<Result<"changed">> {
  const verdict = checkPassword(password, again);
  if (!verdict.ok) return { ok: false, reason: "invalid", problem: PASSWORD_PROBLEM[verdict.problem] };
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { ok: false, reason: "no-permission", problem: "Your session ended. Sign in again to change the password." };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (error.code === "same_password") return { ok: false, reason: "invalid", problem: "That is the password you have now. Choose a new one." };
    if (error.code === "weak_password") {
      return { ok: false, reason: "invalid", problem: "That password is too easy to guess. A passphrase of four words is stronger." };
    }
    if (error.code === "insufficient_aal" || error.code === "reauthentication_needed") {
      return { ok: false, reason: "no-permission", problem: "Prove your two-step sign-in first, then change the password." };
    }
    reportAuth("change_password", error);
    return { ok: false, reason: "error", problem: "The password was not changed. Try again; the old one still works until it is." };
  }
  const others = await supabase.auth.signOut({ scope: "others" });
  if (others.error) reportAuth("revoke_other_sessions", others.error);
  return { ok: true, value: "changed" };
}

/** "Sign out everywhere else": every session but this one ends. */
export async function signOutElsewhere(): Promise<Result<"done">> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) {
    reportAuth("sign_out_others", error);
    return { ok: false, reason: "error", problem: "The other sessions were not ended. Try again." };
  }
  return { ok: true, value: "done" };
}
