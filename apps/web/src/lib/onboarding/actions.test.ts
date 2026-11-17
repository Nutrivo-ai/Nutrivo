import { beforeEach, describe, expect, it, vi } from "vitest";

// The signUp Server Action's existing-account path (A01.fail.1) with Supabase Auth stubbed. rules.test.ts covers
// signInPathAnswer on its own; this covers the action's wiring: "Check your email" only for a link Supabase Auth
// accepted, a refused send is a visible problem reported to Sentry by code (docs/18, issue 266), and that problem is the
// one the new-account path gives for the same refusal, so the answer never says whether an address has an account.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "app.nutrivo.test", "x-forwarded-proto": "https" }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect ${url}`); } }));
const captureMessage = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureMessage }));

type AuthError = { code?: string; status?: number; name?: string; message: string };
type SignUpAnswer = { data: { user: { identities: unknown[] } | null }; error: AuthError | null };
let signUpAnswer: SignUpAnswer;
let otpAnswer: { data: unknown; error: AuthError | null };
const signInWithOtp = vi.fn(async () => otpAnswer);
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signUp: async () => signUpAnswer, signInWithOtp } }),
}));

const { signUp } = await import("./actions");
const { AUTH_BUSY_PROBLEM, EMAIL_REFUSED_PROBLEM } = await import("./rules");

const EMAIL = "j.holm@haldenpet.com";
const form = () => {
  const f = new FormData();
  f.set("email", EMAIL);
  f.set("fullName", "Jonas Holm");
  f.set("password", "a-long-enough-passphrase");
  f.set("workspaceName", "Halden Pet Nutrition");
  return f;
};
const existing: SignUpAnswer = { data: { user: { identities: [] } }, error: null };

beforeEach(() => {
  captureMessage.mockClear();
  signInWithOtp.mockClear();
  otpAnswer = { data: {}, error: null };
});

describe("signUp, existing account (A01.fail.1)", () => {
  it("A01.fail.1: a sign-in link Supabase Auth accepted shows Check your email", async () => {
    signUpAnswer = existing;
    expect(await signUp({ status: "idle" }, form())).toEqual({ status: "sent", email: EMAIL });
    expect(signInWithOtp).toHaveBeenCalledOnce();
  });

  it("A01.fail.1: a failed sign-in link send returns an error state, never sent", async () => {
    signUpAnswer = existing;
    otpAnswer = { data: {}, error: { code: "email_address_invalid", status: 400, message: "Email address is invalid" } };
    const state = await signUp({ status: "idle" }, form());
    expect(state).toEqual({ status: "problem", problem: EMAIL_REFUSED_PROBLEM });
    expect(captureMessage).toHaveBeenCalledWith("onboarding sign_in_path failed: email_address_invalid", expect.anything());
  });

  it("A01.fail.1: the failed send reads the same as the new-account path's refusal of that address", async () => {
    signUpAnswer = existing;
    otpAnswer = { data: {}, error: { code: "email_address_invalid", status: 400, message: "invalid" } };
    const existingAnswer = await signUp({ status: "idle" }, form());
    signUpAnswer = { data: { user: null }, error: { code: "email_address_invalid", status: 400, message: "invalid" } };
    const newAnswer = await signUp({ status: "idle" }, form());
    expect(existingAnswer).toEqual(newAnswer);
  });

  it("A01.fail.1: also for user_already_exists, a failed send is an error state", async () => {
    signUpAnswer = { data: { user: null }, error: { code: "user_already_exists", status: 422, message: "exists" } };
    otpAnswer = { data: {}, error: { code: "otp_disabled", status: 422, message: "disabled" } };
    expect(await signUp({ status: "idle" }, form())).toEqual({ status: "problem", problem: EMAIL_REFUSED_PROBLEM });
  });

  it("A01.fail.1: a busy Supabase Auth still gives the shared busy answer", async () => {
    signUpAnswer = existing;
    otpAnswer = { data: {}, error: { code: "over_email_send_rate_limit", status: 429, message: "rate" } };
    expect(await signUp({ status: "idle" }, form())).toEqual({ status: "problem", problem: AUTH_BUSY_PROBLEM });
    expect(captureMessage).toHaveBeenCalledWith("onboarding sign_in_path failed: over_email_send_rate_limit", expect.anything());
  });
});
