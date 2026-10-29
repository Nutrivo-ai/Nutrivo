"use client";

import { useActionState, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  sendResetLink,
  sendSignInLink,
  setNewPassword,
  signInWithPassword,
  signOut,
  startMfa,
  verifyMfa,
  type FormState,
  type MfaStart,
} from "@/lib/auth/actions";
import { checkPassword, MIN_PASSWORD, safeNext, SIGN_IN_PROBLEM, signInProblem } from "@/lib/auth/rules";
import { AuthCard, Field, Fields, Primary, Problem, QuietLink, Secondary } from "./AuthCard";
import { ProviderButtons } from "./ProviderButtons";

const IDLE: FormState = { status: "idle" };

/** A sent link reads the same whether or not the address has an account (Account Recovery, "Never reveal"). */
function LinkSent({ email, what, again, testId }: { email: string; what: string; again: string; testId: string }) {
  return (
    <AuthCard
      testId={testId}
      mark={{ label: "LINK SENT", tone: "clear", glyph: "square" }}
      title="Check your email"
      body={`If ${email} has a Nutrivo account, ${what} is on its way. It arrives within a minute and works once, for an hour.`}
    >
      <Secondary>
        Wrong address? <QuietLink href={again}>Use another one</QuietLink>
      </Secondary>
    </AuthCard>
  );
}

/** /sign-in (A02.main): email and password, a sign-in link by email, or Google or Microsoft (T-109, D-27). */
export function SignInForm() {
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const returned = signInProblem(params.get("problem")); // a refused Google or Microsoft sign-in (/auth/callback)
  const [passwordState, passwordAction, signingIn] = useActionState(signInWithPassword, IDLE);
  const [linkState, linkAction, sending] = useActionState(sendSignInLink, IDLE);
  if (linkState.status === "sent") return <LinkSent email={linkState.email} what="a sign-in link" again="/sign-in" testId="auth-sign-in" />;
  const problem =
    passwordState.status === "problem"
      ? passwordState.problem
      : linkState.status === "problem"
        ? linkState.problem
        : returned
          ? SIGN_IN_PROBLEM[returned]
          : null;
  return (
    <AuthCard
      testId="auth-sign-in"
      mark={{ label: "SIGN IN", tone: "accent", glyph: "circle" }}
      title="Sign in"
      body="With your work email and password, a link we email you that signs you in once, or your company's Google or Microsoft account."
    >
      <form action={passwordAction}>
        <input type="hidden" name="next" value={next} />
        <Fields>
          <Field label="Work email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required />
          <Field label="Password" name="password" type="password" autoComplete="current-password" />
        </Fields>
        {problem ? <Problem>{problem}</Problem> : null}
        <Primary disabled={signingIn || sending}>{signingIn ? "Signing in…" : "Sign in"}</Primary>
        <button
          type="submit"
          formAction={linkAction}
          disabled={signingIn || sending}
          className="kit-transition mt-[10px] w-full bg-transparent border border-n400 rounded-control py-[11px] px-[20px] text-[13.5px] font-head text-n700 cursor-pointer hover:border-accent hover:text-accent-700 disabled:opacity-45"
        >
          {sending ? "Sending…" : "Email me a sign-in link instead"}
        </button>
      </form>
      <ProviderButtons next={next} disabled={signingIn || sending} />
      <Secondary>
        Forgotten your password? <QuietLink href="/auth/forgot">Send yourself a way back in</QuietLink>
      </Secondary>
    </AuthCard>
  );
}

/** S-REC-001 (A07), and where an expired or used link lands (A07.fail.1). */
export function ForgotForm() {
  const expired = useSearchParams().get("link") === "expired";
  const [state, action, pending] = useActionState(sendResetLink, IDLE);
  if (state.status === "sent") return <LinkSent email={state.email} what="a link to set a new password" again="/auth/forgot" testId="auth-forgot" />;
  return (
    <AuthCard
      testId="auth-forgot"
      mark={expired ? { label: "LINK EXPIRED", tone: "action", glyph: "triangle" } : { label: "PASSWORD RESET", tone: "accent", glyph: "circle" }}
      title={expired ? "That link no longer works" : "Send yourself a way back in"}
      body={
        expired
          ? "Links from us work once, for an hour, so that one has expired or was already used. Type the address you sign in with and a fresh one arrives within a minute."
          : "Type the address you sign in with. If we hold an account for it, a link arrives within a minute and works once, for an hour."
      }
    >
      <form action={action}>
        <Fields>
          <Field label="Email address" name="email" type="email" autoComplete="email" placeholder="you@company.com" required />
        </Fields>
        {state.status === "problem" ? <Problem>{state.problem}</Problem> : null}
        <Primary disabled={pending}>{pending ? "Sending…" : "Send the link"}</Primary>
      </form>
      <Secondary>
        Remembered it? <QuietLink href="/sign-in">Sign in instead</QuietLink>
      </Secondary>
    </AuthCard>
  );
}

const HINT = { strong: "STRONG · A PASSPHRASE OF FOUR WORDS", fair: "LONG ENOUGH · LONGER IS STRONGER" } as const;

/** S-REC-002 (A07.main): the new password, typed twice, with a read-out of what was typed. */
export function ResetForm({ minutes }: { minutes: number | null }) {
  const [state, action, pending] = useActionState(setNewPassword, IDLE);
  const [password, setPassword] = useState("");
  const typed = password ? checkPassword(password, password) : null;
  const hint = !typed ? `${MIN_PASSWORD} CHARACTERS OR MORE` : typed.ok ? HINT[typed.strength] : `AT LEAST ${MIN_PASSWORD} CHARACTERS`;
  return (
    <AuthCard
      testId="auth-reset"
      mark={{ label: "LINK VERIFIED", tone: "clear", glyph: "square" }}
      title="Choose a new password"
      body="Twelve characters or more. Longer beats complicated — a passphrase you can remember is stronger than a short string of symbols you cannot."
    >
      <form action={action}>
        <Fields>
          <Field
            label="New password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="At least twelve characters"
            minLength={MIN_PASSWORD}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint={hint}
            hintTone={!typed ? "n600" : typed.ok ? (typed.strength === "strong" ? "clear" : "n600") : "action"}
          />
          <Field label="Type it again" name="again" type="password" autoComplete="new-password" required />
        </Fields>
        {state.status === "problem" ? <Problem>{state.problem}</Problem> : null}
        <Primary disabled={pending}>{pending ? "Setting it…" : "Set the password and sign in"}</Primary>
      </form>
      <Secondary>
        {minutes === null ? "This link works once, for an hour" : minutes > 0 ? `This link expires in ${minutes} minute${minutes === 1 ? "" : "s"}` : "This link has just expired"}
      </Secondary>
    </AuthCard>
  );
}

/** /auth/mfa: enrol TOTP (A02.fail.2) or prove it (aal2, A02.must.2). */
export function MfaForm() {
  const next = safeNext(useSearchParams().get("next"));
  const [start, setStart] = useState<MfaStart | null>(null);
  const [state, action, pending] = useActionState(verifyMfa, IDLE);
  useEffect(() => {
    let live = true;
    startMfa().then(
      (s) => live && setStart(s),
      () => live && setStart({ mode: "problem", problem: "Two-step sign-in could not be read just now. Reload the page to try again." }),
    );
    return () => {
      live = false;
    };
  }, []);

  const enrol = start?.mode === "enrol";
  return (
    <AuthCard
      testId="auth-mfa"
      mark={enrol || !start ? { label: "TWO-STEP SIGN-IN", tone: "accent", glyph: "circle" } : { label: "TWO-STEP SIGN-IN", tone: "clear", glyph: "square" }}
      title={enrol ? "Set up two-step sign-in" : "Type your two-step code"}
      body={
        enrol
          ? "Your account holds signing authority, so a code from an authenticator app is required in addition to your password. Scan the code below with the app, then type the six digits it shows."
          : "Open your authenticator app and type the six digits it shows for Nutrivo."
      }
    >
      {!start ? (
        <p role="status" className="mt-[20px] mb-0 font-mono text-[10px] tracking-[0.08em] text-n600">
          READING · TWO-STEP SIGN-IN
        </p>
      ) : start.mode === "problem" ? (
        <Problem>{start.problem}</Problem>
      ) : (
        <form action={action}>
          <input type="hidden" name="factorId" value={start.factorId} />
          <input type="hidden" name="next" value={next} />
          {start.mode === "enrol" ? (
            <div className="mt-[20px] flex gap-[16px] items-start">
              {/* eslint-disable-next-line @next/next/no-img-element -- an SVG data URL from Supabase Auth */}
              <img src={start.qr} alt="QR code to add Nutrivo to an authenticator app" width={140} height={140} className="flex-none border border-rule" />
              <div className="min-w-0">
                <p className="m-0 text-[12.5px] font-medium">No camera? Type this key instead</p>
                <p data-testid="mfa-secret" className="mt-[5px] mb-0 font-mono text-[12px] tracking-[0.05em] text-n800 break-all">
                  {start.secret}
                </p>
              </div>
            </div>
          ) : null}
          <Fields>
            <Field label="Six-digit code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required />
          </Fields>
          {state.status === "problem" ? <Problem>{state.problem}</Problem> : null}
          <Primary disabled={pending}>{pending ? "Checking…" : enrol ? "Turn on two-step and continue" : "Continue"}</Primary>
        </form>
      )}
      <form action={signOut}>
        <Secondary>
          Not you, or not now?{" "}
          <button type="submit" className="bg-transparent border-0 p-0 text-[13px] text-n600 cursor-pointer hover:text-accent-700 hover:underline underline-offset-[3px]">
            Sign out
          </button>
        </Secondary>
      </form>
    </AuthCard>
  );
}
