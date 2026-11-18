import { beforeEach, describe, expect, it, vi } from "vitest";

// The signUp Server Action itself, with Supabase Auth stubbed: how it wires signInPathAnswer up for an address that
// already has an account (issue 266). rules.test.ts covers the answer as a pure function; this covers the action.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "app.nutrivo.test", "x-forwarded-proto": "https" }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect ${url}`); } }));
const captureMessage = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ captureMessage }));

type AuthError = { code: string; status: number; name?: string; message?: string };
type Answer<T> = { data: T; error: AuthError | null };
const signUpAuth = vi.fn<(args: unknown) => Promise<Answer<{ user: { identities: unknown[] } | null }>>>();
const signInWithOtp = vi.fn<(args: unknown) => Promise<Answer<Record<string, never>>>>();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { signUp: signUpAuth, signInWithOtp } }) }));

const { signUp } = await import("./actions");
const { AUTH_BUSY_PROBLEM, EMAIL_REFUSED_PROBLEM } = await import("./rules");

const EMAIL = "j@haldenpet.com";
const form = () => {
  const f = new FormData();
  f.set("email", EMAIL);
  f.set("fullName", "Johanna Holm");
  f.set("password", "correct horse battery");
  f.set("workspaceName", "Haldenpet");
  return f;
};
const idle = { status: "idle" } as const;
const existing = { data: { user: { identities: [] } }, error: null };
const refused: AuthError = { code: "email_address_invalid", status: 400, name: "AuthApiError" };
const busy: AuthError = { code: "over_email_send_rate_limit", status: 429, name: "AuthApiError" };

beforeEach(() => {
  captureMessage.mockClear();
  signUpAuth.mockReset();
  signInWithOtp.mockReset();
  signInWithOtp.mockResolvedValue({ data: {}, error: null });
});

describe("signUp, the existing-account path (A01.fail.1, issue 266)", () => {
  it("[A01.fail.1] an existing account whose sign-in link is accepted reads as sent", async () => {
    signUpAuth.mockResolvedValue(existing);
    expect(await signUp(idle, form())).toEqual({ status: "sent", email: EMAIL });
    expect(signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({ email: EMAIL, options: expect.objectContaining({ shouldCreateUser: false }) }),
    );
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("[A01.fail.1] a refused sign-in link is the generic refusal, never sent, and is reported by code", async () => {
    signUpAuth.mockResolvedValue(existing);
    signInWithOtp.mockResolvedValue({ data: {}, error: refused });
    const answer = await signUp(idle, form());
    expect(answer).toEqual({ status: "problem", problem: EMAIL_REFUSED_PROBLEM });
    expect(answer.status).not.toBe("sent");
    expect(captureMessage).toHaveBeenCalledWith("onboarding sign_in_path failed: email_address_invalid", expect.anything());
  });

  it("[A01.fail.1] the refused existing account reads exactly as a refused new signup, so no account is enumerated", async () => {
    signUpAuth.mockResolvedValue(existing);
    signInWithOtp.mockResolvedValue({ data: {}, error: refused });
    const existingAnswer = await signUp(idle, form());

    signUpAuth.mockResolvedValue({ data: { user: null }, error: refused });
    const newAnswer = await signUp(idle, form());

    expect(existingAnswer).toEqual(newAnswer);
    expect(newAnswer).toEqual({ status: "problem", problem: EMAIL_REFUSED_PROBLEM });
  });

  it("[A01.fail.1] the user_already_exists route with a failed send is a problem too", async () => {
    signUpAuth.mockResolvedValue({ data: { user: null }, error: { code: "user_already_exists", status: 422 } });
    signInWithOtp.mockResolvedValue({ data: {}, error: refused });
    expect(await signUp(idle, form())).toEqual({ status: "problem", problem: EMAIL_REFUSED_PROBLEM });
    expect(signInWithOtp).toHaveBeenCalledTimes(1);
  });

  it("[A01.fail.1] a busy sign-in link send is the shared busy problem", async () => {
    signUpAuth.mockResolvedValue(existing);
    signInWithOtp.mockResolvedValue({ data: {}, error: busy });
    expect(await signUp(idle, form())).toEqual({ status: "problem", problem: AUTH_BUSY_PROBLEM });
    expect(captureMessage).toHaveBeenCalledWith("onboarding sign_in_path failed: over_email_send_rate_limit", expect.anything());
  });
});
