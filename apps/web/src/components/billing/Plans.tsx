"use client";

import Link from "next/link";
import { useState } from "react";
import { Blueprint, ButtonLink, cx } from "@/components/kit";
import { Screen } from "@/components/shell";
import { buildPicker, NEVER_METERED, type Card } from "@/lib/billing/picker";
import type { LiveCounts, Term } from "@/lib/billing/plans";
import { hrefFor } from "@/lib/shell/routes";
import { BillingNoPermission, FreeChips, KICKER, PortalButton, Row, TONE } from "./shared";

// S-PLN-001 Plan picker (design: product/Nutrivo Plans and Checkout.dc.html, screen "plans"). M01, M02 (T-703).
// Read from the workspace's live counts on every request (BE-33, M02.must.1); the recommended plan is the smallest
// that holds what the workspace already has, and past a plan's ceiling the next one is offered (BE-34). Every price
// is net and says so (M01.must.1).

export type PlansView =
  | { kind: "no-permission"; workspace: string }
  | { kind: "loaded"; workspaceId: string; counts: LiveCounts; checksRun: number; plan: string; subscriptionStatus: string | null; term: Term };

export function Plans({ route, view }: { route: string; view: PlansView }) {
  return (
    <Screen route={route}>
      {view.kind === "no-permission" ? <BillingNoPermission workspace={view.workspace} title="Plan picker" /> : <Picker view={view} />}
    </Screen>
  );
}

function Picker({ view }: { view: Extract<PlansView, { kind: "loaded" }> }) {
  const [term, setTerm] = useState<Term>(view.term);
  const p = buildPicker({ counts: view.counts, checksRun: view.checksRun, term, plan: view.plan, subscriptionStatus: view.subscriptionStatus });
  return (
    <div className="max-w-[1120px] mx-auto" data-screen="S-PLN-001" data-recommended={p.recommended}>
      <Blueprint as="section" className="py-[24px] px-[26px]">
        <div data-testid="plans-head" className="flex flex-col lg:flex-row lg:items-end justify-between gap-[18px] lg:gap-[26px]">
          <div>
            <p className={cx(KICKER, "text-accent")}>Your workspace today</p>
            <h2 className="mt-[8px] mb-0 text-[24px] md:text-[28px] font-semibold leading-[1.1]">{p.headline}</h2>
            <p className="mt-[8px] mb-0 text-[14px] leading-[1.55] text-n700 max-w-[84ch]">{p.lede}</p>
          </div>
          <div role="group" aria-label="Billing term" className="flex-none flex border border-n400 rounded-control overflow-hidden self-start lg:self-auto">
            {(["monthly", "annual"] as Term[]).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={term === t}
                onClick={() => setTerm(t)}
                className={cx(
                  "border-0 py-[9px] px-[15px] text-[12.5px] cursor-pointer",
                  term === t ? "bg-accent text-paper font-medium" : "bg-transparent text-n700 hover:text-accent-700",
                )}
              >
                {t === "monthly" ? "Monthly" : "Annual · two months free"}
              </button>
            ))}
          </div>
        </div>
        <dl data-testid="usage" className="mt-[20px] mb-0 grid grid-cols-2 lg:grid-cols-4 border border-rule">
          {p.usage.map((u, i) => (
            <div key={u.k} className={cx("py-[16px] px-[18px] border-rule", i < 3 && "lg:border-r", i % 2 === 0 && "border-r lg:border-r", i < 2 && "border-b lg:border-b-0")}>
              <dt className="m-0 font-mono text-[9.5px] tracking-[0.1em] uppercase text-n600">{u.k}</dt>
              <dd className={cx("mt-[8px] mx-0 mb-0 font-mono text-[24px] leading-none", TONE[u.tone])} data-testid={`usage-${u.k.toLowerCase().replace(/\s+/g, "-")}`}>
                {u.n}
              </dd>
              <dd className="mt-[6px] mx-0 mb-0 text-[12px] leading-[1.4] text-n700">{u.v}</dd>
            </div>
          ))}
        </dl>
      </Blueprint>

      <div data-testid="plan-cards" className="mt-[20px] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[14px] items-stretch">
        {p.cards.map((c) => (
          <PlanCard key={c.key} card={c} workspaceId={view.workspaceId} term={term} />
        ))}
      </div>

      <Blueprint edge="border-l-4 border-l-accent" className="mt-[16px] py-[18px] px-[20px] grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-[14px] md:gap-[22px] items-center">
        <div>
          <p className="m-0 text-[15px] font-semibold">Do you answer for other companies&apos; products?</p>
          <p className="mt-[6px] mb-0 text-[13px] leading-[1.55] text-n700 max-w-[96ch]">
            Consultancies, agencies and contract manufacturers hold a workspace per client rather than one large workspace.
            Twelve clients priced on Standard is the wrong shape and the wrong number. Partner prices client workspaces
            instead.
          </p>
        </div>
        <Link href="/pricing" className="flex-none font-mono text-[10.5px] tracking-[0.06em] whitespace-nowrap">
          SEE PARTNER →
        </Link>
      </Blueprint>

      <div className="mt-[20px] grid grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-[18px]">
        <Blueprint as="section" className="py-[20px] px-[22px]">
          <h2 className={cx(KICKER, "text-accent font-normal")}>Never metered, on any plan</h2>
          <FreeChips items={NEVER_METERED} className="mt-[12px]" large />
          <p className={cx(KICKER, "mt-[14px] pt-[12px] border-t border-n200 text-blocked tracking-[0.1em]")}>Not sold at any price</p>
          <p className="mt-[8px] mb-0 text-[13px] leading-[1.55] text-n700">
            We never file a registration, pay a fee, correspond with an authority, confirm that a registration is valid, or
            guarantee acceptance. Only the operator named on the label can do those things.
          </p>
        </Blueprint>
        {p.overage ? (
          <section data-testid="overage" className="border border-ink border-l-4 border-l-action bg-paper py-[20px] px-[22px]">
            <h2 className="m-0 text-[14px] font-semibold leading-[1.55] tracking-normal">If you outgrow {p.overage.plan === "basic" ? "Basic" : "Standard"} mid-term</h2>
            <p className="mt-[7px] mb-0 text-[13px] leading-[1.55] text-n700">{p.overage.body}</p>
            <div className="mt-[14px] flex flex-col gap-[6px]">
              {p.overage.rows.map((r) => (
                <Row key={r.k} k={r.k} v={r.v} tone={r.tone} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

const DASHED = "mt-[14px] w-full box-border text-center border border-dashed border-n400 rounded-control py-[11px] px-[16px] text-[13px] text-n600";

function PlanCard({ card: c, workspaceId, term }: { card: Card; workspaceId: string; term: Term }) {
  const checkout = (plan: string) => `${hrefFor("/w/[workspace]/billing/checkout", workspaceId)}?plan=${plan}&term=${term}`;
  return (
    <Blueprint
      as="article"
      edge={cx("border-t-4", c.on ? "border-t-accent" : "border-t-n400")}
      className={cx("p-[20px] flex flex-col", c.on && "border-accent bg-accent-100")}
    >
      <div data-testid={`plan-${c.key}`} data-on={c.on || undefined} className="flex flex-col flex-1">
        <div className="flex items-baseline justify-between gap-[10px] min-h-[20px]">
          <h3 className="m-0 text-[19px] font-semibold leading-[1.55] tracking-normal">{c.name}</h3>
          {c.tag ? (
            <span className={cx("font-mono text-[9px] tracking-[0.07em] py-[3px] px-[6px] border bg-paper whitespace-nowrap", c.on ? "border-accent text-accent-700" : "border-n400 text-n600")}>
              {c.tag}
            </span>
          ) : null}
        </div>
        <p data-testid="price" className={cx("mt-[14px] mb-0 font-mono text-[27px] leading-none", c.on ? "text-accent-700" : "text-ink")}>
          {c.price}
        </p>
        <p data-testid="per" className="mt-[6px] mb-0 font-mono text-[10px] tracking-[0.05em] text-n600">
          {c.per}
        </p>
        <p className="mt-[12px] mb-0 text-[12.5px] leading-[1.5] text-n700">{c.basis}</p>
        <div className="mt-[14px] border-t border-n200 pt-[11px] flex flex-col gap-[7px] flex-1">
          {c.rows.map((r) => (
            <div key={r.k} className="flex justify-between gap-[10px] items-baseline">
              <span className="text-[12px] text-n600">{r.k}</span>
              <span className={cx("font-mono text-[11px] text-right", TONE[r.tone])}>{r.v}</span>
            </div>
          ))}
        </div>
        <p data-testid="verdict" className={cx("mt-[12px] mb-0 pt-[10px] border-t border-n200 text-[12px] leading-[1.45]", TONE[c.verdictTone])}>
          {c.verdict}
        </p>
        {c.action.kind === "checkout" ? (
          <ButtonLink href={checkout(c.action.plan)} variant={c.action.primary ? "primary" : "secondary"} size="md" className="mt-[14px] w-full box-border text-center py-[11px]">
            {c.action.label}
          </ButtonLink>
        ) : c.action.kind === "switch" ? (
          <div className="mt-[14px]">
            <PortalButton workspaceId={workspaceId} flow="subscription_update" className="w-full py-[11px]">
              {c.action.label}
            </PortalButton>
          </div>
        ) : c.action.kind === "contact" ? (
          <ButtonLink href="mailto:hello@nutrivo.ai?subject=Advanced%20plan" size="md" className="mt-[14px] w-full box-border text-center py-[11px]">
            {c.action.label}
          </ButtonLink>
        ) : (
          <p className={DASHED}>{c.action.label}</p>
        )}
      </div>
    </Blueprint>
  );
}
