"use client";

import { useActionState } from "react";
import { continueWithProvider, type FormState } from "@/lib/auth/actions";
import { Problem } from "./AuthCard";

// T-109 (D-27): Continue with Google and Continue with Microsoft, beside the work email. No frame draws them yet
// (issue 138, question 2): they take the bordered secondary button the Onboarding Flow draws for "Continue with SSO", so
// /sign-in and onboarding (T-106) use the same component. Both are one form posting the provider's name.

const IDLE: FormState = { status: "idle" };

const BUTTON =
  "kit-transition w-full bg-transparent border border-n400 rounded-control py-[11px] px-[18px] text-[14px] font-head " +
  "text-ink cursor-pointer hover:border-accent hover:text-accent-700 disabled:opacity-45 disabled:cursor-not-allowed";

export function ProviderButtons({ next, disabled = false }: { next: string; disabled?: boolean }) {
  const [state, action, pending] = useActionState(continueWithProvider, IDLE);
  return (
    <form action={action} data-testid="auth-providers" aria-label="Sign in with your company account">
      <input type="hidden" name="next" value={next} />
      <div className="mt-[20px] flex items-center gap-[12px]" aria-hidden="true">
        <span className="flex-1 border-t border-n200" />
        <span className="font-mono text-[10px] tracking-[0.08em] text-n600">OR WITH YOUR COMPANY ACCOUNT</span>
        <span className="flex-1 border-t border-n200" />
      </div>
      <div className="mt-[14px] flex flex-col gap-[10px]">
        <button type="submit" name="provider" value="google" disabled={disabled || pending} className={BUTTON}>
          Continue with Google
        </button>
        <button type="submit" name="provider" value="microsoft" disabled={disabled || pending} className={BUTTON}>
          Continue with Microsoft
        </button>
      </div>
      {state.status === "problem" ? <Problem>{state.problem}</Problem> : null}
    </form>
  );
}
