// T-103 (A02, A07): the decisions sign-in makes, as pure functions so they are tested without a stack. Nothing here
// touches a session, and nothing here ever holds a password longer than the call that checks it.

/** Where somebody lands after signing in when nothing asked for a page: their first workspace (/auth/continue). */
export const CONTINUE = "/auth/continue";
/** S-REC-001, and where every expired or already-used email link ends (A07.fail.1). */
export const EXPIRED_LINK = "/auth/forgot?link=expired";

/**
 * The page to return to after signing in, if it is one of ours. Only a same-origin path is kept: "//evil.test",
 * "/\\evil.test", "https://…" and anything with a control character fall back, so `next` is never an open redirect.
 */
export function safeNext(next: string | null | undefined, fallback = CONTINUE): string {
  if (!next || next.length > 512) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if ([...next].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f || c === "\\")) return fallback;
  try {
    const url = new URL(next, "http://nutrivo.invalid");
    if (url.origin !== "http://nutrivo.invalid") return fallback;
    return url.pathname + url.search;
  } catch {
    return fallback;
  }
}

/** /sign-in carrying the page to come back to, when there is one worth carrying. */
export function signInHref(next?: string | null): string {
  const target = safeNext(next, "");
  return target && target !== CONTINUE ? `/sign-in?next=${encodeURIComponent(target)}` : "/sign-in";
}

export const MIN_PASSWORD = 12;

export type PasswordCheck =
  | { ok: true; strength: "fair" | "strong" }
  | { ok: false; problem: "short" | "mismatch" | "long" };

/**
 * S-REC-002: twelve characters or more, typed twice. Length is the rule ("Longer beats complicated"); no symbol or
 * digit is demanded. The strength read-out is a fact about what was typed: a passphrase of four words or twenty
 * characters reads strong.
 */
export function checkPassword(password: string, again: string): PasswordCheck {
  if (password.length < MIN_PASSWORD) return { ok: false, problem: "short" };
  if (password.length > 72) return { ok: false, problem: "long" }; // bcrypt reads no further
  if (password !== again) return { ok: false, problem: "mismatch" };
  const words = password.trim().split(/[\s\-_.]+/).filter((w) => w.length >= 3).length;
  return { ok: true, strength: words >= 4 || password.length >= 20 ? "strong" : "fair" };
}

export const PASSWORD_PROBLEM: Record<"short" | "mismatch" | "long", string> = {
  short: `At least ${MIN_PASSWORD} characters. A passphrase of four words is easier to remember than symbols.`,
  mismatch: "The two passwords are not the same. Type the new one again in both fields.",
  long: "At most 72 characters. Anything longer is not read, so it would not make the password stronger.",
};

export type Assurance = { currentLevel: string | null; nextLevel: string | null };

export type MfaGate = "ok" | "challenge" | "enrol";

/** Where a reset link goes when the account has a verified factor: two-step first, then the new password. */
export const RESET_AFTER_MFA = `/auth/mfa?next=${encodeURIComponent("/auth/reset")}`;

/**
 * True when the session must prove its second factor first. Supabase Auth refuses a password change below aal2 once a
 * factor is verified (insufficient_aal), and a reset link only ever signs in at aal1, so every person with two-step,
 * every signer among them, proves it before choosing the new password.
 */
export function needsStepUp(assurance: Assurance): boolean {
  return assurance.nextLevel === "aal2" && assurance.currentLevel !== "aal2";
}

/**
 * A02 step 4, A02.fail.2 and A02.must.2. A person with a verified factor proves it at sign-in (aal2) before reaching
 * any workspace. A person holding signing authority with no factor at all enrols first ("Two-step is offered here,
 * not later"). Everybody else may work at aal1; signing itself is refused below aal2 by the database (P0292).
 */
export function mfaGate(assurance: Assurance, holdsSigningGrant: boolean): MfaGate {
  if (needsStepUp(assurance)) return "challenge";
  if (holdsSigningGrant && assurance.nextLevel !== "aal2") return "enrol";
  return "ok";
}

/**
 * What an email link (confirmation, sign-in link, reset) may carry back to /auth/callback when it failed. Every
 * failure lands on the recovery page, which offers a fresh link (A07.fail.1). Nothing is shown from the provider's
 * description, so a failure never says more than "expired or used".
 */
export function callbackFailure(params: URLSearchParams): string | null {
  if (params.get("error") || params.get("error_code") || params.get("error_description")) return EXPIRED_LINK;
  if (!params.get("code") && !params.get("token_hash")) return EXPIRED_LINK;
  return null;
}

/** The email-link types /auth/callback verifies by token hash. Anything else is refused as an expired link. */
const OTP_TYPES = ["signup", "invite", "magiclink", "recovery", "email_change", "email"] as const;
export type LinkType = (typeof OTP_TYPES)[number];
export function linkType(value: string | null): LinkType | null {
  return OTP_TYPES.find((t) => t === value) ?? null;
}

/** "This link expires in N minutes" on S-REC-002: an hour from when the reset was asked for, never below zero. */
export function minutesLeft(sentAt: string | null | undefined, now: number, validForMinutes = 60): number | null {
  if (!sentAt) return null;
  const sent = Date.parse(sentAt);
  if (Number.isNaN(sent)) return null;
  return Math.max(0, Math.ceil((sent + validForMinutes * 60_000 - now) / 60_000));
}

// ─── T-109 · Business sign-in (D-27) ─────────────────────────────────────────────────────────────────────────────

/** The two OAuth providers D-27 names, by the value their button posts and the name Supabase Auth knows them by. */
export const PROVIDERS = { google: "google", microsoft: "azure" } as const;
export type ProviderChoice = keyof typeof PROVIDERS;
export function providerChoice(value: string | null | undefined): ProviderChoice | null {
  return value === "google" || value === "microsoft" ? value : null;
}

/**
 * The fixed marker private.before_user_created_hook puts at the start of its refusal. Supabase Auth answers signUp,
 * signInWithOtp and inviteUserByEmail with it as the error message (403, error_code "unknown"), and hands it to
 * /auth/callback as error_description after Google or Microsoft. It is matched, never shown.
 */
export const BUSINESS_EMAIL_MARKER = "business_email_required";

/** True when Supabase Auth refused to create an account because the address is a consumer or free-mail one. */
export function isBusinessEmailRefusal(error: { message?: string | null } | null | undefined): boolean {
  return !!error?.message?.includes(BUSINESS_EMAIL_MARKER);
}

/** What /sign-in says after a refused or failed Google or Microsoft sign-in, by a fixed key in `?problem=`. */
export const SIGN_IN_PROBLEM = {
  business_email:
    "Nutrivo accounts use a work email address, so that address cannot open one. Continue with your company's Google or Microsoft account, or use your work email.",
  provider: "Google or Microsoft did not sign you in, and nothing was changed. Try again, or use your work email and password.",
} as const;
export type SignInProblem = keyof typeof SIGN_IN_PROBLEM;
export function signInProblem(value: string | null | undefined): SignInProblem | null {
  return value === "business_email" || value === "provider" ? value : null;
}

/**
 * Where /auth/callback goes when a Google or Microsoft sign-in came back with an error instead of a code: /sign-in
 * with a fixed problem, carrying the page asked for. The provider's description is only searched for the marker.
 */
export function oauthFailure(params: URLSearchParams): string | null {
  if (params.get("via") !== "oauth") return null;
  if (!params.get("error") && !params.get("error_code") && !params.get("error_description")) return null;
  const problem: SignInProblem = (params.get("error_description") ?? "").includes(BUSINESS_EMAIL_MARKER) ? "business_email" : "provider";
  const target = safeNext(params.get("next"), "");
  const query = new URLSearchParams({ problem });
  if (target && target !== CONTINUE) query.set("next", target);
  return `/sign-in?${query.toString()}`;
}
