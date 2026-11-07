"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Button, NoPermissionState, cx, type ButtonSize, type ButtonVariant } from "@/components/kit";
import { openPortal, type PortalFlow, type Refusal } from "@/lib/billing/actions";

// The parts the billing screens share (T-703): the design's mono kicker and key/value rows, money and dates as the
// Plans and Checkout and Billing Settings files print them, the no-permission state billing has, and the one button
// that opens the Stripe customer portal.

export const KICKER = "m-0 font-mono text-[10px] leading-[1.55] tracking-[0.13em] uppercase";

const WHOLE = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const CENTS = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** €499: whole euros, as the plan cards print them. */
export const euros = (minor: number) => WHOLE.format(minor / 100);
/** €623.75: an invoice's exact amount. Whole amounts print without cents (€499). */
export const exact = (minor: number) => (minor % 100 === 0 ? WHOLE.format(minor / 100) : CENTS.format(minor / 100));

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const LONG = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
/** "4 Sep 2026". */
export const day = (iso: string) => DAY.format(new Date(iso)).replace("Sept", "Sep");
/** "4 September 2026". */
export const longDay = (iso: string) => LONG.format(new Date(iso));
/** "4 SEP 2027", for the mono chips. */
export const monoDay = (iso: string) => day(iso).toUpperCase();
/** "4 Sep – 3 Oct 2026", "4 Sep 2026 – 3 Sep 2027". */
export function period(start: string | null, end: string | null): string {
  if (!start || !end) return "";
  // A Stripe period ends at the start of the next one; the design prints the last day it covers.
  const last = new Date(Date.parse(end) - 86_400_000).toISOString();
  const s = new Date(start);
  const e = new Date(last);
  if (s.getUTCFullYear() === e.getUTCFullYear()) return `${day(start).replace(/ \d{4}$/, "")} – ${day(last)}`;
  return `${day(start)} – ${day(last)}`;
}

export type Tone = "ink" | "n600" | "n700" | "clear" | "action" | "blocked" | "accent" | "none";
export const TONE: Record<Tone, string> = {
  ink: "text-ink",
  n600: "text-n600",
  n700: "text-n700",
  clear: "text-clear",
  action: "text-action",
  blocked: "text-blocked",
  accent: "text-accent",
  none: "text-na",
};

/** A key on the left, a mono value on the right, on an n200 rule: the design's plan and order rows. */
export function Row({ k, v, tone = "n700", size = "sm", testId }: { k: ReactNode; v: ReactNode; tone?: Tone; size?: "sm" | "md"; testId?: string }) {
  return (
    <div
      data-testid={testId}
      className={cx(
        "flex justify-between gap-[12px] items-baseline border-b border-n200",
        size === "md" ? "py-[9px]" : "pb-[6px]",
      )}
    >
      <span className={cx(size === "md" ? "text-[13px]" : "text-[12.5px]", "text-n700")}>{k}</span>
      <span className={cx("font-mono text-right", size === "md" ? "text-[12.5px]" : "text-[11.5px]", TONE[tone])}>{v}</span>
    </div>
  );
}

/** Green-edged chips: what is never metered. */
export function FreeChips({ items, className, large }: { items: string[]; className?: string; /** The plan picker's chips (6 / 10 px). */ large?: boolean }) {
  return (
    <ul className={cx("m-0 p-0 list-none flex flex-wrap gap-[7px]", className)}>
      {items.map((t) => (
        <li key={t} className={cx("border border-clear bg-clear-bg text-[12px] text-n800", large ? "py-[6px] px-[10px]" : "py-[5px] px-[9px]")}>
          {t}
        </li>
      ))}
    </ul>
  );
}

/** Billing is for internal admins of the whole workspace only (app.billing_context, 42501 otherwise). */
export function BillingNoPermission({ workspace, title }: { workspace: string; title: string }) {
  return (
    <div className="max-w-[640px]" data-testid="billing-no-permission">
      <NoPermissionState
        where="NO PERMISSION · BILLING"
        title={`Your role cannot open ${title}`}
        body={`Billing in ${workspace} is managed by its admins. An external admin, or one whose access is limited to some recipes or markets, cannot change what the company pays for.`}
        aside={`An admin of ${workspace} can do it.`}
      />
    </div>
  );
}

/** What a refused billing action says, in the person's terms. */
export function refusalText(reason: Refusal, problem?: string): string {
  switch (reason) {
    case "no-permission":
      return "Only an admin of the whole workspace can manage billing.";
    case "live":
      return problem === "applying"
        ? "A payment for this workspace was just received and is being applied. Nothing more is charged; Plan and allowance shows the plan shortly."
        : "This workspace already has a plan. Change it from Plan and allowance.";
    case "no-customer":
      return "There is nothing on file yet. It appears here once you have a plan.";
    case "not-configured":
      return "Payments are not available right now. Nothing was charged. Try again later.";
    case "invalid":
      if (problem === "advanced_is_quoted") return "Advanced is quoted. Write to hello@nutrivo.ai.";
      if (problem === "does_not_fit") return "This plan cannot hold what the workspace has now. The plan picker names the one that does.";
      return "That could not be accepted. Check the details and try again.";
    default:
      return problem === "audit"
        ? "Saved at Stripe, but the change could not be written to the audit log. We have been alerted; nothing needs doing on your side."
        : "Stripe did not answer. Nothing was charged or changed. Try again.";
  }
}

/** Opens the Stripe customer portal at one flow. Server Action redirects; a refusal is said next to the button. */
export function PortalButton({
  workspaceId,
  flow,
  returnTo = "billing",
  variant = "secondary",
  size = "md",
  className,
  children,
  testId,
}: {
  workspaceId: string;
  flow: PortalFlow;
  returnTo?: "billing" | "payment" | "invoices";
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
  testId?: string;
}) {
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<string | null>(null);
  return (
    <div className="flex flex-col">
      <Button
        variant={variant}
        size={size}
        className={className}
        disabled={pending}
        aria-busy={pending}
        data-testid={testId}
        onClick={() => {
          setSaid(null);
          start(async () => {
            const r = await openPortal(workspaceId, flow, returnTo);
            if (!r.ok) setSaid(refusalText(r.reason, r.problem));
          });
        }}
      >
        {pending ? "Opening Stripe…" : children}
      </Button>
      <div aria-live="polite">
        {said ? (
          <p role="alert" className="mt-[6px] mb-0 text-[12px] leading-[1.45] text-blocked">
            {said}
          </p>
        ) : null}
      </div>
    </div>
  );
}
