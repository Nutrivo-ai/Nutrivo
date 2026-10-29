"use server";

// T-103 (A02, A07): every write sign-in makes, as Server Actions under the person's own Supabase Auth session. None
// of them logs or reports an email, a password, a code or a token: a failure goes to Sentry by its auth error code
// only (docs/17), and the answers never say whether an account exists (Account Recovery, "Never reveal").
import * as Sentry from "@sentry/nextjs";
import type { AuthError } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { REQUEST_ID_HEADER } from "@/lib/observability/request-id";
import {
  CONTINUE,
  EXPIRED_LINK,
  PASSWORD_PROBLEM,
  PROVIDERS,
  RESET_AFTER_MFA,
  checkPassword,
  providerChoice,
  safeNext,
} from "./rules";
import { landingPath, sessionGate } from "./session";

export type FormState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "problem"; problem: string };

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The origin email links return to: the one this request came in on, as the browser sent it. */
async function origin(): Promise<string> {
  const h = await headers();
  const sent = h.get("origin");
  if (sent) return sent;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${h.get("x-forwarded-proto") ?? "http"}://${host}`;
}

/** Reports an unexpected auth failure by code and status, with the request id, never with what was typed. */
async function report(where: string, error: AuthError | Error) {
  const requestId = (await headers()).get(REQUEST_ID_HEADER) ?? undefined;
  const code = "code" in error ? error.code : undefined;
  const status = "status" in error ? error.status : undefined;
  Sentry.captureMessage(`auth ${where} failed: ${code ?? error.name}`, {
    level: "error",
    tags: { area: "auth", auth_step: where, auth_code: code ?? "none", request_id: requestId },
    extra: { status },
  });
}

/** Statuses that mean Supabase Auth itself failed, as opposed to refusing what was typed. */
const broken = (error: AuthError) => !error.status || error.status >= 500;

/** After any sign-in: prove or enrol a second factor first when needed (A02 step 4), then the page asked for. */
async function onward(next: string): Promise<never> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect(EXPIRED_LINK);
  const gate = await sessionGate(supabase, data.user.id);
  if (gate !== "ok") redirect(`/auth/mfa?next=${encodeURIComponent(next)}`);
  // An action's redirect is followed by the client router, which does not follow a route handler's own redirect, so
  // the default landing is resolved here rather than through /auth/continue.
  redirect(next === CONTINUE ? await landingPath(supabase, data.user.id) : next);
}

/** A02.main: email and password. Every refusal reads the same, so it never confirms that an address has an account. */
export async function signInWithPassword(_: FormState, form: FormData): Promise<FormState> {
  const email = text(form, "email").trim();
  const password = text(form, "password");
  const next = safeNext(text(form, "next"));
  if (!EMAIL.test(email) || !password) return { status: "problem", problem: "Type your work email and your password." };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (broken(error)) {
      await report("password", error);
      return { status: "problem", problem: "Signing in did not work just now, and nothing was changed. Try again in a minute." };
    }
    return {
      status: "problem",
      problem: "That email and password do not sign in. Check both, or email yourself a sign-in link instead.",
    };
  }
  return onward(next);
}

/** A02.main by magic link. The answer is "sent" whether or not the address has an account; nobody is signed up here. */
export async function sendSignInLink(_: FormState, form: FormData): Promise<FormState> {
  const email = text(form, "email").trim();
  const next = safeNext(text(form, "next"));
  if (!EMAIL.test(email)) return { status: "problem", problem: "Type the work email you sign in with." };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false, // accounts start at onboarding (A01) or an invitation (A04), never here
      emailRedirectTo: `${await origin()}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error && broken(error)) await report("magic_link", error);
  return { status: "sent", email };
}

/**
 * T-109 (D-27): Continue with Google or Continue with Microsoft. Supabase Auth keeps the PKCE verifier in this
 * browser's cookies and sends the person to the provider; they come back to /auth/callback with a code, which
 * becomes a session at aal1 and goes through the same two-step gate as a password (T-103). Microsoft is the
 * organizations tenant (supabase/config.toml), so a personal Microsoft account is refused by Microsoft itself, and a
 * new account on a free-mail address is refused by the before-user-created hook.
 */
export async function continueWithProvider(_: FormState, form: FormData): Promise<FormState> {
  const choice = providerChoice(text(form, "provider"));
  const next = safeNext(text(form, "next"));
  if (!choice) return { status: "problem", problem: "Choose Google or Microsoft, or sign in with your work email." };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: PROVIDERS[choice],
    options: {
      redirectTo: `${await origin()}/auth/callback?next=${encodeURIComponent(next)}&via=oauth`,
      scopes: choice === "microsoft" ? "email" : undefined,
      skipBrowserRedirect: true,
    },
  });
  if (error || !data.url) {
    await report(`oauth_${choice}`, error ?? new Error("no authorize url"));
    return { status: "problem", problem: "Signing in with that account did not start just now. Try again in a minute." };
  }
  redirect(data.url);
}

/** S-REC-001 (A07): a reset link, one use, one hour. The confirmation is identical whether or not an account exists. */
export async function sendResetLink(_: FormState, form: FormData): Promise<FormState> {
  const email = text(form, "email").trim();
  if (!EMAIL.test(email)) return { status: "problem", problem: "Type the address you sign in with." };
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await origin()}/auth/callback?next=${encodeURIComponent("/auth/reset")}`,
  });
  if (error && broken(error)) await report("reset_link", error);
  return { status: "sent", email };
}

/**
 * S-REC-002 (A07.main): set the new password, then end every other session (A07 step 2), because the usual reason
 * for a reset is that somebody else may have had access. The database records the access event, never the secret.
 */
export async function setNewPassword(_: FormState, form: FormData): Promise<FormState> {
  const verdict = checkPassword(text(form, "password"), text(form, "again"));
  if (!verdict.ok) return { status: "problem", problem: PASSWORD_PROBLEM[verdict.problem] };
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect(EXPIRED_LINK);
  const { error } = await supabase.auth.updateUser({ password: text(form, "password") });
  if (error) {
    if (error.code === "same_password") {
      return { status: "problem", problem: "That is the password you have now. Choose a new one." };
    }
    // Two-step was verified after this page loaded, or the page was reached around the callback: prove it first.
    if (error.code === "insufficient_aal") redirect(RESET_AFTER_MFA);
    if (error.code === "weak_password") {
      return { status: "problem", problem: "That password is too easy to guess. A passphrase of four words is stronger." };
    }
    await report("set_password", error);
    return { status: "problem", problem: "The password was not changed. Try again; the old one still works until it is." };
  }
  const others = await supabase.auth.signOut({ scope: "others" });
  if (others.error) await report("revoke_other_sessions", others.error);
  return onward(CONTINUE);
}

export type MfaStart =
  | { mode: "challenge"; factorId: string }
  | { mode: "enrol"; factorId: string; qr: string; secret: string }
  | { mode: "problem"; problem: string };

/**
 * /auth/mfa: a verified TOTP factor is challenged; without one, a new factor is enrolled. Half-finished enrolments
 * are removed first so a person who left the page can start again. Runs as an action, never on a page render.
 */
export async function startMfa(): Promise<MfaStart> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) redirect("/sign-in");
  const factors = await supabase.auth.mfa.listFactors();
  if (factors.error) {
    await report("mfa_list", factors.error);
    return { mode: "problem", problem: "Two-step sign-in could not be read just now. Reload the page to try again." };
  }
  const verified = factors.data.totp.find((f) => f.status === "verified");
  if (verified) return { mode: "challenge", factorId: verified.id };
  for (const stale of factors.data.all.filter((f) => f.factor_type === "totp" && f.status !== "verified")) {
    await supabase.auth.mfa.unenroll({ factorId: stale.id });
  }
  const enrolled = await supabase.auth.mfa.enroll({ factorType: "totp" });
  if (enrolled.error) {
    await report("mfa_enrol", enrolled.error);
    return { mode: "problem", problem: "Two-step sign-in could not be set up just now. Reload the page to try again." };
  }
  return { mode: "enrol", factorId: enrolled.data.id, qr: enrolled.data.totp.qr_code, secret: enrolled.data.totp.secret };
}

/** The six-digit code from the authenticator app. On success the session is aal2 and goes on to the page asked for. */
export async function verifyMfa(_: FormState, form: FormData): Promise<FormState> {
  const code = text(form, "code").replace(/\s/g, "");
  const factorId = text(form, "factorId");
  const next = safeNext(text(form, "next"));
  if (!/^\d{6}$/.test(code)) return { status: "problem", problem: "Type the six digits your authenticator app shows now." };
  const supabase = await createClient();
  const { data: verified, error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) {
    if (broken(error)) {
      await report("mfa_verify", error);
      return { status: "problem", problem: "The code could not be checked just now. Try again with the next code." };
    }
    return { status: "problem", problem: "That code did not match. Codes change every 30 seconds: type the one showing now." };
  }
  redirect(next === CONTINUE ? await landingPath(supabase, verified.user.id) : next);
}

/** Ends this session on this device. */
export async function signOut(): Promise<never> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error && broken(error)) await report("sign_out", error);
  redirect("/sign-in");
}
