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
