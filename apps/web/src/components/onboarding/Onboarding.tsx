"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { cx } from "@/components/kit";
import { Wordmark } from "@/components/shell/Wordmark";
import { track } from "@/lib/analytics";
import { createWorkspace, setOperator, signUp, type OnboardingState } from "@/lib/onboarding/actions";
import {
  FREE_REGION,
  MAX_WORKSPACE_NAME,
  STEPS,
  countryLabel,
  countryOf,
  workspaceNameFromEmail,
  type RegionCard,
  type Step,
} from "@/lib/onboarding/rules";

// The Onboarding Flow file (S-ONB-001 to S-ONB-003): one route, the step is state. The design's own header buttons
// ("Restart at step 01", "View the invited-user page") move between its frames and are not part of the screen; "Continue
// with SSO" and "READ THE COVERAGE DEPTH" wait for SSO and the public coverage page (issue #28, question 5), and the
// recipe fields of step 03 arrive with C01 (T-401). Nothing drawn here is a control that does nothing.

const IDLE: OnboardingState = { status: "idle" };
const FORM = "onboarding-form";

type Region = RegionCard;

type Props =
  | { step: 1 }
  | { step: 2; regions: Region[] }
  | { step: 3; workspaceId: string; workspaceName: string };

const NOTE: Record<Step, string> = {
  1: "Three fields, then confirm one region.",
  2: "Free starts with the EU.",
  3: "Exactly as printed. The establishment number is optional.",
};

const MONO_TAG = "m-0 font-mono text-[10px] tracking-[0.12em] uppercase";
const INPUT = "w-full border border-n400 rounded-control py-[11px] px-[12px] text-[14px] leading-[1.55] font-head bg-paper text-ink placeholder:text-n500";
const LABEL = "block text-[12.5px] font-medium mb-[6px]";
const CARD = "border border-ink bg-paper";
const PRIMARY =
  "kit-transition bg-accent text-paper border-0 rounded-control font-medium font-head cursor-pointer hover:bg-accent-600 " +
  "disabled:opacity-45 disabled:cursor-not-allowed";
const QUIET =
  "kit-transition bg-transparent border border-n400 rounded-control font-head cursor-pointer hover:border-accent hover:text-accent-700 " +
  "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-n400 disabled:hover:text-ink";

export function Onboarding(props: Props) {
  const [account, accountAction, signingUp] = useActionState(signUp, IDLE);
  const [created, createAction, creating] = useActionState(createWorkspace, IDLE);
  const [operator, operatorAction, saving] = useActionState(setOperator, IDLE);
  const [region, setRegion] = useState(FREE_REGION);
  const router = useRouter();

  useEffect(() => {
    if (created.status !== "created" && created.status !== "exists") return;
    // Only a workspace this action created is recorded; one that already existed (a repeat click) records nothing.
    if (created.status === "created") track("workspace_created", { workspace_id: created.workspaceId, plan: "free", region: FREE_REGION });
    router.refresh(); // the page reads the workspace and moves on to step 03
  }, [created, router]);

  const step = props.step;
  const sent = account.status === "sent";
  // Between app.create_workspace answering and the page re-reading the person, step 02 waits on the new workspace.
  const moving = step === 2 && (created.status === "created" || created.status === "exists");
  const pending = signingUp || creating || saving || moving;
  const canContinue = !pending && !(step === 1 && sent) && !(step === 2 && region !== FREE_REGION);
  const nextLabel = step === 1 ? (signingUp ? "Creating…" : "Continue") : step === 2 ? (creating || moving ? "Creating the workspace…" : "Continue") : saving ? "Saving…" : "Continue";

  return (
    <div className="min-h-screen flex flex-col bg-panel text-ink text-[14px]">
      <header className="flex items-center gap-[20px] border-b border-ink bg-paper py-[14px] px-[16px] md:px-[32px]">
        <Wordmark size="header" />
        <div className="flex-1" />
        <span className="font-mono text-[10.5px] tracking-[0.05em] text-n600 border border-rule py-[5px] px-[9px]">FREE · 3 LABELS · NO CARD</span>
        {step === 1 ? (
          <a
            href="/sign-in"
            className="kit-transition border border-n400 bg-paper rounded-control py-[6px] px-[11px] text-[12px] text-n700 no-underline hover:border-accent hover:text-accent-700"
          >
            Already have an account? Sign in
          </a>
        ) : null}
      </header>

      <Rail step={step} />

      <main className="flex-1 pt-[34px] pb-[60px] px-[16px] md:px-[32px]">
        <div className="max-w-[1040px] mx-auto">
          {step === 1 ? (
            sent ? (
              <CheckEmail email={account.email} />
            ) : (
              <AccountStep action={accountAction} pending={signingUp} problem={account.status === "problem" ? account.problem : null} />
            )
          ) : step === 2 ? (
            <RegionStep
              regions={props.regions}
              region={region}
              onPick={setRegion}
              action={createAction}
              problem={created.status === "problem" ? created.problem : null}
            />
          ) : (
            <OperatorStep
              workspaceId={props.workspaceId}
              workspaceName={props.workspaceName}
              action={operatorAction}
              problem={operator.status === "problem" ? operator.problem : null}
            />
          )}
        </div>
      </main>

      <div className="sticky bottom-0 border-t border-ink bg-paper py-[14px] px-[16px] md:px-[32px]">
        <div className="max-w-[1040px] mx-auto flex items-center gap-[16px] flex-wrap md:flex-nowrap">
          {/* The account exists from step 01 on and the workspace from step 02, so there is nothing to go back to. */}
          <button type="button" disabled className={cx(QUIET, "py-[11px] px-[18px] text-[14px] text-ink")}>
            Back
          </button>
          <p className="m-0 flex-1 font-mono text-[10.5px] tracking-[0.05em] text-n600">{NOTE[step]}</p>
          {step === 3 ? (
            <a href={`/w/${props.workspaceId}`} className={cx(QUIET, "py-[11px] px-[16px] text-[13.5px] text-n700 no-underline")}>
              I&apos;ll do this later — take me to the platform
            </a>
          ) : null}
          <button
            type="submit"
            form={FORM}
            disabled={!canContinue}
            aria-describedby={step === 2 && region !== FREE_REGION ? "onb-region-note" : undefined}
            className={cx(PRIMARY, "py-[11px] px-[22px] text-[14px]")}
          >
            {nextLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The five steps across the top. Steps are reached by finishing the one before, so the rail is a record, not a menu.
 * The design draws later steps at 60% opacity and the numbers in --n500; both are set in --n600 so the small text
 * passes axe (docs/10).
 */
function Rail({ step }: { step: Step }) {
  return (
    <nav aria-label="Onboarding steps" className="bg-paper border-b border-rule px-[16px] md:px-[32px] overflow-x-auto">
      <ol className="max-w-[1040px] mx-auto grid grid-cols-[repeat(5,minmax(120px,1fr))] list-none m-0 p-0">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const done = step > n;
          const active = step === n;
          return (
            <li
              key={label}
              aria-current={active ? "step" : undefined}
              className={cx(
                "pt-[14px] px-[14px] pb-[12px] border-b-[3px]",
                active ? "bg-accent-100 border-b-accent" : "border-b-transparent",
                step < n && "text-n600",
              )}
            >
              <span className="flex items-center gap-[8px]">
                <span
                  aria-hidden="true"
                  className={cx(
                    "w-[16px] h-[16px] flex-none flex items-center justify-center text-[10px] text-paper",
                    done ? "bg-clear" : active ? "bg-accent" : "border-[1.5px] border-n400",
                  )}
                >
                  {done ? "✓" : ""}
                </span>
                <span className={cx("font-mono text-[10px] tracking-[0.1em]", active ? "text-accent" : "text-n600")}>0{n}</span>
              </span>
              <span className={cx("block mt-[6px] text-[13px] text-left", active ? "font-semibold" : "font-normal")}>
                {label}
                {done ? <span className="sr-only"> (done)</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StepHead({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <>
      <p className={cx(MONO_TAG, "text-accent")}>Step 0{n} of 05</p>
      <h1 className="mt-[8px] mb-0 text-[27px] font-semibold leading-[1.1]">{title}</h1>
      <p className="mt-[8px] mb-0 text-[14px] leading-[1.5] text-n700 max-w-[88ch]">{children}</p>
    </>
  );
}

function Problem({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mt-[16px] mb-0 border-l-[3px] border-blocked pl-[12px] text-[12.5px] leading-[1.5] text-n800">
      {children}
    </p>
  );
}

const NOT_ASKED = ["Card details", "Company size", "Phone number", "Job title", "Number of SKUs", "How you heard about us", "A sales call"];
const FREE_ROWS = [
  { k: "First three labels", v: "The whole product, sending included" },
  { k: "Region", v: "One, sold whole" },
  { k: "Re-checks", v: "Never counted" },
  { k: "Card", v: "None" },
];

/**
 * S-ONB-001: email, full name, password; the workspace name follows the email domain until it is renamed. Every field
 * is controlled, so a refused submission keeps what was typed (a form action resets uncontrolled fields).
 */
function AccountStep({ action, pending, problem }: { action: (form: FormData) => void; pending: boolean; problem: string | null }) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [rename, setRename] = useState("");
  const derived = workspaceNameFromEmail(email, fullName);
  const workspaceName = renaming ? rename : derived.name;

  return (
    <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] gap-[24px] items-start">
      <section data-testid="onboarding-account" aria-labelledby="onb-title" className={cx(CARD, "py-[26px] px-[28px]")}>
        <div id="onb-title">
          <StepHead n={1} title="Create your workspace">
            Three fields. No card, and nobody will call you.
          </StepHead>
        </div>
        <form id={FORM} action={action} noValidate>
          <div className="mt-[22px] flex flex-col gap-[15px]">
            <div>
              <label htmlFor="f-email" className={LABEL}>Work email</label>
              <input id="f-email" name="email" type="email" autoComplete="email" required className={INPUT} value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label htmlFor="f-name" className={LABEL}>Full name</label>
              <input id="f-name" name="fullName" type="text" autoComplete="name" required className={INPUT} value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div>
              <div className="flex justify-between items-baseline gap-[12px] mb-[6px]">
                <label htmlFor="f-pass" className="text-[12.5px] font-medium">Password</label>
                <button
                  type="button"
                  aria-controls="f-pass"
                  aria-pressed={show}
                  onClick={() => setShow(!show)}
                  className="bg-transparent border-0 p-0 font-mono text-[10px] tracking-[0.06em] text-accent-700 cursor-pointer hover:text-accent"
                >
                  {show ? "HIDE" : "SHOW"}
                </button>
              </div>
              <input id="f-pass" name="password" type={show ? "text" : "password"} autoComplete="new-password" required minLength={12} aria-describedby="f-pass-hint" className={INPUT} value={password} onChange={(e) => setPassword(e.target.value)} />
              <p id="f-pass-hint" className="mt-[6px] mb-0 text-[12px] text-n600">
                One field, with a reveal. Twelve characters or more, and no rules about punctuation.
              </p>
            </div>
            {renaming ? (
              <div>
                <label htmlFor="f-ws" className={LABEL}>Workspace name</label>
                <input id="f-ws" name="workspaceName" type="text" required maxLength={MAX_WORKSPACE_NAME} autoFocus className={INPUT} value={rename} onChange={(e) => setRename(e.target.value)} />
              </div>
            ) : (
              <div className="border border-rule bg-panel py-[12px] px-[14px] grid grid-cols-[minmax(0,1fr)_auto] gap-[12px] items-baseline">
                <input type="hidden" name="workspaceName" value={workspaceName} />
                <span className="text-[12.5px] text-n700">
                  {email.includes("@") ? (
                    <>
                      Workspace will be called <strong className="font-semibold">{workspaceName}</strong>
                      {derived.fromDomain ? ", from your email domain." : "."}
                    </>
                  ) : (
                    "The workspace is named when you type your email. You can rename it."
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setRename(workspaceName);
                    setRenaming(true);
                  }}
                  className="bg-transparent border-0 p-0 font-mono text-[10px] tracking-[0.06em] text-accent-700 cursor-pointer hover:text-accent"
                >
                  RENAME
                </button>
              </div>
            )}
          </div>
          {problem ? <Problem>{problem}</Problem> : null}
          {/* As tall as the design's row, whose bordered SSO button is 47.7 px (left out until SSO exists). */}
          <div className="mt-[24px] flex items-center gap-[14px] min-h-[47.688px]">
            <button type="submit" disabled={pending} className={cx(PRIMARY, "py-[12px] px-[22px] text-[14.5px]")}>
              {pending ? "Creating…" : "Create workspace"}
            </button>
          </div>
        </form>
        <p className="mt-[16px] mb-0 pt-[14px] border-t border-n200 text-[12px] leading-[1.5] text-n600">
          By continuing you accept the terms. We never file a registration, pay a fee, correspond with an authority or guarantee acceptance.
        </p>
      </section>
      <div className="flex flex-col gap-[18px]">
        <section aria-labelledby="onb-not-asked" className={cx(CARD, "py-[20px] px-[22px]")}>
          <h2 id="onb-not-asked" className={cx(MONO_TAG, "text-na font-normal")}>Not asked</h2>
          <ul className="mt-[12px] mb-0 p-0 list-none flex flex-wrap gap-[7px]">
            {NOT_ASKED.map((na) => (
              <li key={na} className="border border-n300 bg-panel py-[5px] px-[9px] text-[11.5px] text-n700 line-through decoration-n400">
                {na}
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="onb-free" className={cx(CARD, "py-[20px] px-[22px]")}>
          <h2 id="onb-free" className={cx(MONO_TAG, "text-accent font-normal")}>Free, three labels</h2>
          <dl className="mt-[10px] mb-0">
            {FREE_ROWS.map((fr) => (
              <div key={fr.k} className="flex justify-between gap-[12px] items-baseline border-b border-n200 py-[8px]">
                <dt className="text-[12.5px] text-n700">{fr.k}</dt>
                <dd className="m-0 font-mono text-[11.5px] font-medium text-right">{fr.v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-[12px] mb-0 text-[12px] leading-[1.5] text-n600">Three labels, no card and no clock. Nothing is taken away when they are used.</p>
        </section>
      </div>
    </div>
  );
}

/**
 * After step 01. It reads the same whether the address was new (a confirmation link) or already had an account (a
 * sign-in link, A01.fail.1), so it never says which.
 */
function CheckEmail({ email }: { email: string }) {
  return (
    <section data-testid="onboarding-check-email" aria-labelledby="onb-sent" role="status" className={cx(CARD, "py-[26px] px-[28px] max-w-[640px]")}>
      <p className={cx(MONO_TAG, "text-clear")}>Link sent</p>
      <h1 id="onb-sent" className="mt-[8px] mb-0 text-[27px] font-semibold leading-[1.1]">Check your email</h1>
      <p className="mt-[8px] mb-0 text-[14px] leading-[1.5] text-n700">
        We sent a link to <strong className="font-semibold">{email}</strong>. Open it in this browser to carry on; it arrives within a minute and
        works once, for an hour. Nothing is created until the link is opened.
      </p>
      <p className="mt-[16px] mb-0 pt-[14px] border-t border-n200 text-[12px] leading-[1.5] text-n600">
        Wrong address?{" "}
        <a href="/onboarding" className="text-accent-700 hover:text-accent">
          Start again with another one
        </a>
      </p>
    </section>
  );
}

/** S-ONB-002: the region, sold whole. Free is the EU (docs/08-billing, A01 step 2); the UK and the US come with a paid plan. */
function RegionStep({
  regions,
  region,
  onPick,
  action,
  problem,
}: {
  regions: Region[];
  region: string;
  onPick: (id: string) => void;
  action: (form: FormData) => void;
  problem: string | null;
}) {
  const picked = regions.find((r) => r.id === region) ?? regions[0];
  return (
    <section data-testid="onboarding-region" aria-labelledby="onb-title" className={cx(CARD, "py-[26px] px-[28px]")}>
      <div id="onb-title">
        <StepHead n={2} title="Where do you sell">
          Free starts with the EU. A region is sold whole, because a state is one edition of a national rulebook rather than a rulebook of its
          own.
        </StepHead>
      </div>
      <form id={FORM} action={action}>
        <input type="hidden" name="region" value={region} />
        <div role="group" aria-label="Region" className="mt-[22px] grid grid-cols-1 md:grid-cols-3 gap-[16px]">
          {regions.map((r) => {
            const on = r.id === region;
            return (
              <button
                key={r.id}
                type="button"
                aria-pressed={on}
                onClick={() => onPick(r.id)}
                className={cx(
                  "kit-transition text-left cursor-pointer border border-t-4 py-[18px] px-[20px] block w-full font-head text-ink hover:border-accent",
                  on ? "border-accent bg-accent-100" : "border-n400 bg-paper",
                )}
              >
                <span className="flex justify-between items-baseline gap-[10px]">
                  <span className="text-[24px] font-semibold tracking-[-0.03em]">{r.k}</span>
                  <span
                    aria-hidden="true"
                    className={cx(
                      "w-[15px] h-[15px] flex-none rounded-full border-[1.5px]",
                      on ? "border-accent bg-accent shadow-[inset_0_0_0_3px_var(--paper)]" : "border-n400 bg-transparent",
                    )}
                  />
                </span>
                <span className="block mt-[8px] text-[12.5px] leading-[1.45] text-n700 text-left">{r.v}</span>
                <span className={cx("block mt-[12px] pt-[10px] border-t border-n200 font-mono text-[10px] tracking-[0.05em] text-left", on ? "text-n700" : "text-n600")}>{r.meta}</span>
              </button>
            );
          })}
        </div>
      </form>
      <div className="mt-[20px] border border-rule bg-panel py-[16px] px-[18px]">
        <p className="m-0 text-[13.5px] font-semibold">Inside {picked.k}</p>
        <ul className="mt-[12px] mb-0 p-0 list-none flex flex-wrap gap-[7px]">
          {picked.nodes.map((pn) => (
            <li key={pn} className="border border-n300 bg-paper py-[6px] px-[10px] font-mono text-[11px] tracking-[0.04em]">
              {pn}
            </li>
          ))}
        </ul>
        <p className="mt-[12px] mb-0 text-[12.5px] leading-[1.5] text-n700">
          Selling in more than one region? Pick the one you sell most in now. A second region is a plan change, not a second onboarding.
        </p>
        {picked.id !== FREE_REGION ? (
          <p id="onb-region-note" role="status" className="mt-[12px] mb-0 border-l-[3px] border-action pl-[12px] text-[12.5px] leading-[1.5] text-n800">
            Free covers the EU. {picked.k} comes with a paid plan.
          </p>
        ) : null}
      </div>
      <PasswordAgain />
      {problem ? <Problem>{problem}</Problem> : null}
    </section>
  );
}

/**
 * Below the design's step 02 card: the password, typed once more. Whoever signed an address up first and never
 * confirmed it chose the password Supabase Auth keeps, so the person who confirmed from the inbox sets it again before
 * the workspace exists, and every other session ends (issue #28, pre-account takeover). Controlled, so a refused
 * submission keeps it.
 */
function PasswordAgain() {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  return (
    <div className="mt-[20px] pt-[16px] border-t border-n200 max-w-[526px]">
      <div className="flex justify-between items-baseline gap-[12px] mb-[6px]">
        <label htmlFor="f-pass-again" className="text-[12.5px] font-medium">Your password, once more</label>
        <button
          type="button"
          aria-controls="f-pass-again"
          aria-pressed={show}
          onClick={() => setShow(!show)}
          className="bg-transparent border-0 p-0 font-mono text-[10px] tracking-[0.06em] text-accent-700 cursor-pointer hover:text-accent"
        >
          {show ? "HIDE" : "SHOW"}
        </button>
      </div>
      <input
        id="f-pass-again"
        name="password"
        form={FORM}
        type={show ? "text" : "password"}
        autoComplete="new-password"
        required
        minLength={12}
        aria-describedby="f-pass-again-hint"
        className={INPUT}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <p id="f-pass-again-hint" className="mt-[6px] mb-0 text-[12px] text-n600">
        The one you chose at step 01. It proves the account is yours before the workspace is created, and signs out anywhere else.
      </p>
    </div>
  );
}

/** S-ONB-003, the operator block (B01): exactly as printed; the approval number is optional. */
function OperatorStep({
  workspaceId,
  workspaceName,
  action,
  problem,
}: {
  workspaceId: string;
  workspaceName: string;
  action: (form: FormData) => void;
  problem: string | null;
}) {
  // Controlled, so a refused submission keeps what was typed (a form action resets uncontrolled fields).
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [approval, setApproval] = useState("");
  // The country line reads the address as it stands when the field is left or the form is sent, never per keystroke:
  // "Leeds LS…" or "PARIS" would otherwise flash Lesotho or Panama, and the live region would announce each one.
  const [committed, setCommitted] = useState("");
  // A refused submission's problem stays until the address is changed again.
  const [edited, setEdited] = useState(false);
  const country = countryOf(committed);
  return (
    <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] gap-[24px] items-start">
      <section data-testid="onboarding-operator" aria-labelledby="onb-title" className={cx(CARD, "py-[26px] px-[28px]")}>
        <div id="onb-title">
          <StepHead n={3} title="The responsible operator">
            {workspaceName} is ready. Name the business responsible for your labels; every product inherits it unless it names its own.
          </StepHead>
        </div>
        <form
          id={FORM}
          action={action}
          onSubmit={() => {
            setCommitted(address);
            setEdited(false);
          }}
        >
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <div data-testid="onboarding-operator-block" className="mt-[22px] pt-[16px] border-t border-n200">
            <div className="flex items-baseline gap-[10px]">
              <p id="onb-operator" className="m-0 text-[13.5px] font-semibold">Responsible operator, exactly as printed on the label</p>
              <span className="font-mono text-[9.5px] tracking-[0.08em] text-blocked">REQUIRED</span>
            </div>
            <div className="mt-[12px] flex flex-col gap-[12px]">
              <input name="operatorName" value={name} onChange={(e) => setName(e.target.value)} type="text" required maxLength={300} aria-label="Operator name" placeholder="Operator name" className={INPUT} />
              <input
                name="operatorAddress"
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  setEdited(true);
                }}
                onBlur={(e) => setCommitted(e.currentTarget.value)}
                type="text"
                required
                maxLength={500}
                aria-label="Operator address"
                placeholder="Exactly as printed on the label"
                aria-describedby="onb-country"
                className={INPUT}
              />
              <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-[12px] items-end">
                <input name="approval" value={approval} onChange={(e) => setApproval(e.target.value)} type="text" maxLength={100} aria-label="Establishment or approval number" aria-describedby="onb-approval-hint" className={INPUT} />
                <p id="onb-approval-hint" className="m-0 text-[11.5px] leading-[1.4] text-n600">Establishment number, if you hold one. Optional.</p>
              </div>
            </div>
          </div>
          {/* The country set_default_operator stores, read from the end of the address: shown, never silently guessed. */}
          <p id="onb-country" aria-live="polite" className="mt-[10px] mb-0 font-mono text-[10.5px] tracking-[0.05em] text-n700">
            {!committed.trim()
              ? "COUNTRY · READ FROM THE END OF THE ADDRESS"
              : country
                ? `COUNTRY TO BE SAVED · ${countryLabel(country).toUpperCase()}`
                : "COUNTRY · NOT FOUND AT THE END OF THE ADDRESS"}
          </p>
          {problem && !edited ? <Problem>{problem}</Problem> : null}
        </form>
      </section>
      <section aria-labelledby="onb-why" className="border border-ink border-l-4 border-l-blocked bg-paper py-[20px] px-[22px]">
        <h2 id="onb-why" className={cx(MONO_TAG, "text-blocked font-normal")}>Why the operator is required</h2>
        <p className="mt-[8px] mb-0 text-[13px] leading-[1.55] text-n700">
          Only the operator named on the label can register a product. Without it we can tell you what a label says, but not what you must register,
          with whom, or by when — and an unregistered market never renders as Clear.
        </p>
      </section>
    </div>
  );
}
