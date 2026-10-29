"use client";

import { useActionState, type ReactNode } from "react";
import { continueWithProvider, type FormState } from "@/lib/auth/actions";
import { PROVIDERS, type ProviderChoice } from "@/lib/auth/rules";
import { Problem } from "./AuthCard";

// T-109 (D-27): Continue with Google and Continue with Microsoft, beside the work email. No frame draws them yet
// (issue 138, question 2): they take the bordered secondary button the Onboarding Flow draws for "Continue with SSO".
// /sign-in stacks them under its card (ProviderButtons); onboarding puts them in the design's SSO slot beside "Create
// workspace", inside its own form, so there the buttons name a separate ProviderForm by id (a form never nests).

const IDLE: FormState = { status: "idle" };

export const PROVIDER_BUTTON =
  "kit-transition bg-transparent border border-n400 rounded-control py-[11px] px-[18px] text-[14px] font-head " +
  "text-ink cursor-pointer hover:border-accent hover:text-accent-700 disabled:opacity-45 disabled:cursor-not-allowed";

const NAME: Record<ProviderChoice, string> = { google: "Google", microsoft: "Microsoft" };

/** The action, its answer and whether it is on its way, for a ProviderForm and its buttons. */
export function useProviderSignIn() {
  return useActionState(continueWithProvider, IDLE);
}

/** The form the provider buttons submit: the page to come back to and nothing else. */
export function ProviderForm({ id, action, next, children }: { id?: string; action: (form: FormData) => void; next: string; children?: ReactNode }) {
  return (
    <form id={id} action={action} data-testid="auth-providers" aria-label="Sign in with your company account">
      <input type="hidden" name="next" value={next} />
      {children}
    </form>
  );
}

/** One provider's button. `short` shows only the provider's name, its accessible name still says what it does. */
export function ProviderButton({
  choice,
  form,
  disabled,
  short = false,
  className = "",
}: {
  choice: ProviderChoice;
  form?: string;
  disabled?: boolean;
  short?: boolean;
  className?: string;
}) {
  const label = `Continue with ${NAME[choice]}`;
  return (
    <button
      type="submit"
      form={form}
      name="provider"
      value={choice}
      disabled={disabled}
      aria-label={short ? label : undefined}
      data-provider={PROVIDERS[choice]}
      className={`${PROVIDER_BUTTON} ${className}`}
    >
      {short ? NAME[choice] : label}
    </button>
  );
}

/** /sign-in: the two buttons under an "or" rule, with their own problem line. */
export function ProviderButtons({ next, disabled = false }: { next: string; disabled?: boolean }) {
  const [state, action, pending] = useProviderSignIn();
  return (
    <ProviderForm action={action} next={next}>
      <div className="mt-[20px] flex items-center gap-[12px]" aria-hidden="true">
        <span className="flex-1 border-t border-n200" />
        <span className="font-mono text-[10px] tracking-[0.08em] text-n600">OR WITH YOUR COMPANY ACCOUNT</span>
        <span className="flex-1 border-t border-n200" />
      </div>
      <div className="mt-[14px] flex flex-col gap-[10px]">
        <ProviderButton choice="google" disabled={disabled || pending} className="w-full" />
        <ProviderButton choice="microsoft" disabled={disabled || pending} className="w-full" />
      </div>
      {state.status === "problem" ? <Problem>{state.problem}</Problem> : null}
    </ProviderForm>
  );
}
