"use server";

// T-106 (A01, and B01's default operator): every write onboarding makes, as Server Actions under the person's own
// Supabase Auth session. The workspace is created only by app.create_workspace and the operator set only by
// app.set_default_operator. Nothing here logs or reports an email, a name, a password or a token: a failure goes to
// Sentry by its error code only (docs/17), and the answer to a signup never says whether the address has an account.
import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { REQUEST_ID_HEADER } from "@/lib/observability/request-id";
import { CONTINUE, checkPassword } from "@/lib/auth/rules";
import {
  ACCOUNT_PROBLEM,
  FREE_REGION,
  ONBOARDING,
  OPERATOR_PROBLEM,
  checkAccount,
  readOperator,
} from "./rules";
import { pickStep } from "./state";

export type OnboardingState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "problem"; problem: string }
  | { status: "created"; workspaceId: string };

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

async function origin(): Promise<string> {
  const h = await headers();
  const sent = h.get("origin");
  if (sent) return sent;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${h.get("x-forwarded-proto") ?? "http"}://${host}`;
}

/** Reports an unexpected failure by code, with the request id, never with what was typed. */
async function report(where: string, error: { code?: string; status?: number; name?: string }) {
  const requestId = (await headers()).get(REQUEST_ID_HEADER) ?? undefined;
  Sentry.captureMessage(`onboarding ${where} failed: ${error.code ?? error.name ?? "unknown"}`, {
    level: "error",
    tags: { area: "onboarding", onboarding_step: where, error_code: error.code ?? "none", request_id: requestId },
    extra: { status: error.status },
  });
}

const callback = async (next: string) => `${await origin()}/auth/callback?next=${encodeURIComponent(next)}`;

/** Supabase Auth could not act just now: a rate limit (one email a minute per address, or the project's) or an outage. */
const busy = (error: { status?: number; code?: string }) =>
  !error.status || error.status >= 500 || error.status === 429 || Boolean(error.code?.startsWith("over_"));

/** The one answer to a busy Supabase Auth, on the new-account and the existing-account path alike (A01.fail.1). */
const AUTH_BUSY: OnboardingState = {
  status: "problem",
  problem: "Your account could not be created just now, and nothing was saved. Try again in a minute.",
};

/**
 * S-ONB-001 (A01 step 1). Supabase Auth creates the user with confirmation on, so nobody has a session until the
 * emailed link comes back through /auth/callback, which returns to /onboarding (A01.fail.2).
 *
 * A01.fail.1: for an address that already has an account, Supabase Auth creates nobody and answers with a user that
 * has no identities. That person gets a sign-in link instead, and this screen reads exactly as it does for a new
 * signup, so the answer never says whether an address has an account: also when Supabase Auth is busy, which both
 * paths answer with the same AUTH_BUSY (a second try within a minute is rate limited on both).
 */
export async function signUp(_: OnboardingState, form: FormData): Promise<OnboardingState> {
  const email = text(form, "email").trim();
  const fullName = text(form, "fullName").trim();
  const password = text(form, "password");
  const workspaceName = text(form, "workspaceName").trim();
  const problem = checkAccount({ email, fullName, password, workspaceName });
  if (problem) return { status: "problem", problem: ACCOUNT_PROBLEM[problem] };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: await callback(ONBOARDING),
      // Read back at step 02. Supabase Auth keeps it in the EU project with the account (D-02).
      data: { full_name: fullName, workspace_name: workspaceName },
    },
  });
  if (error) {
    if (error.code === "user_already_exists" || error.code === "email_exists") return signInPath(email);
    if (busy(error)) {
      await report("sign_up", error);
      return AUTH_BUSY;
    }
    if (error.code === "weak_password") return { status: "problem", problem: ACCOUNT_PROBLEM.password_short };
    return { status: "problem", problem: "That email cannot be used to create a workspace. Check it and try again." };
  }
  if (data.user && (data.user.identities?.length ?? 0) === 0) return signInPath(email);
  return { status: "sent", email };
}

/** A01.fail.1: the existing account's owner is emailed a sign-in link; no second user is ever created. */
async function signInPath(email: string): Promise<OnboardingState> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: await callback(CONTINUE) },
  });
  if (error) {
    await report("sign_in_path", error);
    if (busy(error)) return AUTH_BUSY;
  }
  return { status: "sent", email };
}

/**
 * S-ONB-002 (A01 steps 2 and 3): app.create_workspace, which makes the person, the workspace (plan free, regions EU),
 * the admin membership, the allowance (3 allowed, 0 used) and the audit event in one transaction. An unconfirmed
 * email is refused here as well as by Supabase Auth (A01.fail.2). The password is set again and other sessions end
 * first (below). A person who already has a workspace is not given a second one by a repeated click.
 */
export async function createWorkspace(_: OnboardingState, form: FormData): Promise<OnboardingState> {
  const region = text(form, "region");
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect(ONBOARDING);
  if (!auth.user.email_confirmed_at) {
    return { status: "problem", problem: "Confirm your email first: open the link we sent you, then continue here." };
  }
  if (region !== FREE_REGION) {
    return { status: "problem", problem: "Free covers the EU. Choose EU to continue; the UK and the US are a plan change once the workspace exists." };
  }
  const already = await pickStep(supabase, auth.user.id);
  if (already.step === 3) return { status: "created", workspaceId: already.workspaceId };
  if (already.step === "done") redirect(CONTINUE);

  // Pre-account takeover: whoever signed this address up first, and never confirmed it, chose the password Supabase
  // Auth keeps; a later signup's password is ignored. So the person who confirmed from the inbox sets the password
  // again here, and every other session ends, before anything is created in their name.
  const password = text(form, "password");
  const typed = checkPassword(password, password);
  if (!typed.ok) return { status: "problem", problem: ACCOUNT_PROBLEM[typed.problem === "long" ? "password_long" : "password_short"] };
  const set = await supabase.auth.updateUser({ password });
  if (set.error && set.error.code !== "same_password") {
    if (set.error.code === "weak_password") return { status: "problem", problem: ACCOUNT_PROBLEM.password_short };
    await report("set_password", set.error);
    return { status: "problem", problem: "Your password could not be set just now, so the workspace was not created. Try again in a minute." };
  }
  const others = await supabase.auth.signOut({ scope: "others" });
  if (others.error) {
    await report("revoke_other_sessions", others.error);
    return { status: "problem", problem: "Your account could not be secured just now, so the workspace was not created. Try again in a minute." };
  }

  const meta = auth.user.user_metadata ?? {};
  const name = typeof meta.workspace_name === "string" && meta.workspace_name.trim() ? meta.workspace_name.trim() : "My workspace";
  const { data, error } = await supabase.schema("app").rpc("create_workspace", { p_name: name.slice(0, 200) });
  if (error || !data) {
    await report("create_workspace", { code: error?.code });
    return { status: "problem", problem: "The workspace was not created, and nothing was saved. Try again in a minute." };
  }
  return { status: "created", workspaceId: data };
}

/** S-ONB-003 (B01): app.set_default_operator for the workspace just created, then into the workspace. */
export async function setOperator(_: OnboardingState, form: FormData): Promise<OnboardingState> {
  const workspaceId = text(form, "workspaceId");
  const read = readOperator({ name: text(form, "operatorName"), address: text(form, "operatorAddress"), approval: text(form, "approval") });
  if (!read.ok) return { status: "problem", problem: OPERATOR_PROBLEM[read.problem] };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect(ONBOARDING);
  const { error } = await supabase.schema("app").rpc("set_default_operator", { p_ws: workspaceId, p_operator: read.operator });
  if (error) {
    if (error.code === "22023") return { status: "problem", problem: OPERATOR_PROBLEM.country };
    if (error.code === "42501") return { status: "problem", problem: "Only an admin of this workspace can set its operator." };
    await report("set_default_operator", { code: error.code });
    return { status: "problem", problem: "The operator was not saved. Try again; your workspace is already there." };
  }
  redirect(`/w/${workspaceId}`);
}
