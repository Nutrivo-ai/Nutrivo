"use server";

// A04 (T-107): /invite/<token>. Accepting goes through app.accept_invitation under the invitee's own session, which
// hashes the token and checks it is pending, unexpired and for this person's email. Creating the account goes
// through Supabase Auth, and its confirmation link returns to the same invitation. The token is never logged or
// reported; failures go to Sentry by error code only.
import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkPassword, PASSWORD_PROBLEM } from "@/lib/auth/rules";
import { createClient } from "@/lib/supabase/server";
import { isInviteToken, invitePath } from "./rules";

export type InviteState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "problem"; problem: string }
  | { status: "refused"; reason: "expired" | "other-email" | "member" };

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function callback(next: string) {
  const h = await headers();
  const origin =
    h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"}`;
  return `${origin}/auth/callback?next=${encodeURIComponent(next)}`;
}

function report(where: string, code: string | undefined) {
  Sentry.captureMessage(`invite ${where} failed: ${code ?? "error"}`, { level: "error", tags: { area: "invite", invite_step: where } });
}

/** A04.main: accept, then go straight into the workspace. P0040 / P0041 / P0042 are the three refusals of A04. */
export async function acceptInvitation(_: InviteState, form: FormData): Promise<InviteState> {
  const token = text(form, "token");
  if (!isInviteToken(token)) return { status: "refused", reason: "expired" };
  const supabase = await createClient();
  const { data, error } = await supabase.schema("app").rpc("accept_invitation", { p_token: token });
  if (error) {
    if (error.code === "P0040") return { status: "refused", reason: "expired" };
    if (error.code === "P0041") return { status: "refused", reason: "other-email" };
    if (error.code === "P0042") return { status: "refused", reason: "member" };
    if (error.code === "42501") redirect(`/sign-in?next=${encodeURIComponent(invitePath(token))}`);
    report("accept", error.code);
    return { status: "problem", problem: "The invitation could not be accepted just now. Nothing was changed; try again." };
  }
  redirect(`/w/${data}`);
}

/**
 * Creates the invitee's user. The confirmation email returns to this invitation; an address that already has an
 * account gets a sign-in link that returns here instead, and the answer reads the same either way.
 */
export async function createInvitedUser(_: InviteState, form: FormData): Promise<InviteState> {
  const token = text(form, "token");
  const email = text(form, "email").trim();
  const password = text(form, "password");
  if (!isInviteToken(token)) return { status: "refused", reason: "expired" };
  if (!EMAIL.test(email)) return { status: "problem", problem: "Type the address the invitation was sent to." };
  const verdict = checkPassword(password, password);
  if (!verdict.ok) return { status: "problem", problem: PASSWORD_PROBLEM[verdict.problem] };
  const supabase = await createClient();
  const back = await callback(invitePath(token));
  const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: back } });
  const exists = error?.code === "user_already_exists" || error?.code === "email_exists" || (!error && (data.user?.identities?.length ?? 0) === 0);
  if (exists) {
    const link = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: back } });
    if (link.error) report("sign_in_link", link.error.code);
    return { status: "sent", email };
  }
  if (error) {
    if (error.code === "weak_password") return { status: "problem", problem: PASSWORD_PROBLEM.short };
    if (!error.status || error.status >= 500) report("sign_up", error.code);
    return { status: "problem", problem: "That user could not be created. Check the address and try again." };
  }
  return { status: "sent", email };
}

/** Signed in as somebody else (P0041): sign out here and sign in again, coming back to the invitation. */
export async function signOutForInvite(form: FormData): Promise<never> {
  const token = text(form, "token");
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect(isInviteToken(token) ? `/sign-in?next=${encodeURIComponent(invitePath(token))}` : "/sign-in");
}
