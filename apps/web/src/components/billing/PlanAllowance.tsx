"use client";

import Link from "next/link";
import { Blueprint, ButtonLink, cx } from "@/components/kit";
import { SettingsHeader, SettingsMain } from "@/components/settings/SettingsFrame";
import { billingChip } from "@/lib/billing/chip";
import { annualSaving, fitFor, isLive, isPaidPlan, NEXT_REGION_NOTE, nextPlan, type LiveCounts } from "@/lib/billing/plans";
import type { Subscription } from "@/lib/billing/read";
import { addonAmount, amount, plan as planOf } from "@/lib/public/pricing";
import { hrefFor, routeFor } from "@/lib/shell/routes";
import { BillingNoPermission, FreeChips, KICKER, PortalButton, Row, euros, monoDay } from "./shared";

// S-BIL-001 Plan and allowance (design: product/Nutrivo Billing Settings.dc.html, screen "plan"). M02, M05, B02
// (T-703). The three dials against what the plan includes, read now from app.live_billable_counts (M02.must.1); past a
// plan's ceiling the next plan is offered (BE-34). A plan is changed or cancelled in the Stripe customer portal, and
// the workspace follows through the webhook (M05). A subscription that ended leaves the workspace on Free with every
// recipe, report and verification as it was, and the full export free (M05.must.1, BE-44).

export type PlanAllowanceView =
  | { kind: "no-permission"; workspace: string }
  | {
      kind: "loaded";
      workspaceId: string;
      plan: string;
      status: string;
      counts: LiveCounts;
      subscription: Subscription | null;
      /** Stripe checkout just finished: the webhook may not have applied the plan yet. */
      returning: boolean;
    };

const FREE_THINGS = [
  "Checks and re-checks · never metered",
  "Viewers · free and unlimited",
  "Supplier upload links · not seats",
  "Pack sizes and artwork versions",
  "Reading your own answer",
];

export function PlanAllowance({ route, view }: { route: string; view: PlanAllowanceView }) {
  const title = routeFor(route).title;
  if (view.kind === "no-permission") {
    return (
      <>
        <SettingsHeader title={title} />
        <SettingsMain>
          <BillingNoPermission workspace={view.workspace} title={title} />
        </SettingsMain>
      </>
    );
  }
  const chip = billingChip(view.subscription, view.counts);
  return (
    <>
      <SettingsHeader title={title} chip={chip.text} tone={chip.tone} />
      <SettingsMain>
        <Loaded view={view} />
      </SettingsMain>
    </>
  );
}

function Dial({ k, count, pct, v, tone = "ink", testId }: { k: string; count: string; pct: number; v: string; tone?: "ink" | "action" | "blocked"; testId: string }) {
  return (
    <div data-testid={testId}>
      <div className="flex items-baseline justify-between gap-[14px]">
        <h3 className="m-0 text-[14px] font-semibold leading-[1.55] tracking-normal">{k}</h3>
        <p data-testid="count" className={cx("m-0 font-mono text-[12.5px]", tone === "ink" ? "text-ink" : tone === "action" ? "text-action" : "text-blocked")}>
          {count}
        </p>
      </div>
      <div className="mt-[8px] h-[8px] bg-n200 border border-n300" aria-hidden>
        <div className={cx("h-[8px]", tone === "ink" ? "bg-accent" : tone === "action" ? "bg-action" : "bg-blocked")} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
      <p className="mt-[7px] mb-0 text-[12.5px] leading-[1.45] text-n700">{v}</p>
    </div>
  );
}

function Loaded({ view }: { view: Extract<PlanAllowanceView, { kind: "loaded" }> }) {
  const ws = view.workspaceId;
  const s = view.subscription;
  const live = !!s && isLive(s.status) && isPaidPlan(s.plan);
  const ended = !!s && !live && (s.status === "canceled" || s.status === "incomplete_expired");
  const key = live && isPaidPlan(s!.plan) ? s!.plan : null;
  const p = key ? planOf(key) : null;
  const c = view.counts;
  const regions = Math.max(1, c.regions.length);
  const fit = key ? fitFor(key, c) : null;
  const recipeAddon = key ? addonAmount("recipe", key, "month") : null;

  const recipes = p
    ? p.recipes === null
      ? { count: `${c.recipes} · no limit`, pct: 0, v: "Pack sizes, artwork versions and recipe variants hang off these and are never counted. Advanced has no recipe limit." }
      : {
          count: `${c.recipes} of ${p.recipes}`,
          pct: (c.recipes / p.recipes) * 100,
          v:
            "Pack sizes, artwork versions and recipe variants hang off these and are never counted." +
            (recipeAddon !== null && p.overageCap !== null
              ? ` Recipes ${p.recipes + 1} and beyond are ${euros(recipeAddon)} each per month, and the bill stops at ${euros(p.overageCap)}.`
              : ""),
        }
    : { count: `${c.recipes} · no limit`, pct: 0, v: "Pack sizes, artwork versions and recipe variants hang off these and are never counted. The free plan counts labels, not recipes." };
  const regionMax = p ? p.regionsIncluded : 1;
  const editors = p && p.editors !== null
    ? { count: `${c.editorSeats} of ${p.editors}`, pct: (c.editorSeats / p.editors) * 100 }
    : { count: `${c.editorSeats} · no seat check`, pct: 0 };

  return (
    <div data-screen="S-BIL-001" className="grid gap-[20px] items-start grid-cols-1 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
      <Blueprint as="section" className="py-[22px] px-[24px]">
        <div data-testid="dials">
          <p className={cx(KICKER, "text-n600")}>What you are using against what you pay for</p>
          <h2 className="mt-[8px] mb-0 text-[22px] font-semibold leading-[1.15]">Three dials, and none of them is a check</h2>
          <div className="mt-[20px] flex flex-col gap-[18px]">
            {!p ? (
              <Dial
                testId="dial-labels"
                k="Free labels"
                count={`${c.labelsUsed} of ${c.labelsAllowed}`}
                pct={(c.labelsUsed / Math.max(1, c.labelsAllowed)) * 100}
                tone={c.labelsUsed >= c.labelsAllowed ? "action" : "ink"}
                v="Three new label artworks, the whole product, no card and no clock. Re-checking them is always free; a fourth label needs a plan."
              />
            ) : null}
            <Dial testId="dial-recipes" k="Recipes" count={recipes.count} pct={recipes.pct} tone={fit && fit.extraRecipes ? (fit.pastCap ? "blocked" : "action") : "ink"} v={recipes.v} />
            <Dial
              testId="dial-regions"
              k="Regions"
              count={`${regions} of ${regionMax}`}
              pct={(regions / regionMax) * 100}
              v={`EU, sold whole: all 27 member states and all 24 official languages. ${NEXT_REGION_NOTE}${key === "standard" ? " Standard takes a second region when it launches." : ""}`}
            />
            <Dial
              testId="dial-editors"
              k="People who edit"
              count={editors.count}
              pct={editors.pct}
              tone={fit && fit.extraEditors ? "action" : "ink"}
              v="An external editor takes an editor seat like anybody else. Viewers are free whether they are yours or not, and suppliers upload by scoped link rather than by seat."
            />
          </div>
          {fit && key && fit.pastCap ? (
            <div data-testid="past-ceiling" role="status" className="mt-[18px] border border-ink border-l-4 border-l-action bg-paper py-[14px] px-[16px]">
              <p className="m-0 text-[13.5px] font-semibold">This workspace has outgrown {planOf(key).name}</p>
              <p className="mt-[6px] mb-0 text-[12.5px] leading-[1.5] text-n700">
                Past the ceiling we offer {planOf(nextPlan(key)).name} rather than keep charging: it holds everything you have at its own list price.
              </p>
              <ButtonLink href={hrefFor("/w/[workspace]/billing/plans", ws)} variant="primary" size="sm" className="mt-[10px]">
                See {planOf(nextPlan(key)).name}
              </ButtonLink>
            </div>
          ) : null}
          <div className="mt-[22px] pt-[16px] border-t border-n200">
            <FreeChips items={FREE_THINGS} />
          </div>
        </div>
      </Blueprint>

      <div className="flex flex-col gap-[18px]">
        <Blueprint as="section" className="py-[20px] px-[22px]">
          <div data-testid="current-plan">
            <p className={cx(KICKER, "text-accent")}>Current plan</p>
            <p data-testid="plan-name" className="mt-[10px] mb-0 text-[26px] font-semibold leading-none">
              {p ? p.name : "Free"}
            </p>
            <p className="mt-[6px] mb-0 font-mono text-[13px] text-n700">
              {p && key
                ? s!.term === "annual"
                  ? `${euros(amount(key, "year"))} per year · two months free`
                  : `${euros(amount(key, "month"))} per month · excl. VAT`
                : "€0 · three labels, no card, no clock"}
            </p>
            {view.returning && !live ? (
              <p role="status" data-testid="applying" className="mt-[12px] mb-0 text-[12.5px] leading-[1.5] text-action">
                Payment received. Stripe is confirming the subscription; this page shows the new plan within a minute.
              </p>
            ) : null}
            <div className="mt-[16px] flex flex-col gap-[6px]">
              {p && key && s ? (
                <>
                  <Row k="Term" v={s.term === "annual" ? "ANNUAL" : "MONTHLY"} tone={s.term === "annual" ? "clear" : "n700"} />
                  {s.currentPeriodEnd ? <Row k="Next renewal" v={monoDay(s.currentPeriodEnd)} /> : null}
                  {s.term === "annual" ? (
                    <Row k="Saving vs monthly" v={`${euros(annualSaving(key))}/YR`} tone="clear" />
                  ) : key !== "advanced" ? (
                    <Row k="If you paid annually" v={`SAVE ${euros(annualSaving(key))}/YR`} tone="action" />
                  ) : null}
                  <Row k="Minimum term" v="NONE" />
                  {s.status === "past_due" || s.status === "unpaid" ? (
                    <Row k="Last payment" v="FAILED · RETRYING" tone="blocked" testId="payment-failed" />
                  ) : null}
                </>
              ) : (
                <>
                  <Row k="Labels" v={`${c.labelsUsed} OF ${c.labelsAllowed}`} tone={c.labelsUsed >= c.labelsAllowed ? "action" : "n700"} />
                  <Row k="Card" v="NONE NEEDED" />
                </>
              )}
            </div>
            <div className="mt-[16px] flex flex-col gap-[8px]">
              {live ? (
                <>
                  <PortalButton workspaceId={ws} flow="subscription_update" className="w-full" testId="change-plan">
                    Change plan
                  </PortalButton>
                  <PortalButton workspaceId={ws} flow="subscription_cancel" variant="ghost" size="sm" className="w-full" testId="cancel-plan">
                    Cancel at the end of the period
                  </PortalButton>
                </>
              ) : (
                <ButtonLink href={hrefFor("/w/[workspace]/billing/plans", ws)} variant="primary" size="md" className="w-full box-border text-center">
                  See what a plan costs for this workspace
                </ButtonLink>
              )}
            </div>
          </div>
        </Blueprint>
        {ended ? (
          <section data-testid="ended" className="border border-ink border-l-4 border-l-clear bg-paper py-[18px] px-[20px]">
            <h2 className="m-0 text-[13.5px] font-semibold leading-[1.55] tracking-normal">Your {isPaidPlan(s!.plan) ? planOf(s!.plan).name : "paid"} plan has ended. Nothing was deleted</h2>
            <p className="mt-[6px] mb-0 text-[12.5px] leading-[1.5] text-n700">
              The workspace is on Free. Every recipe, every answer and every report you sent stays readable and verifiable,
              re-checking stays free, and a full export of everything stays free on every plan.
            </p>
            <Link href={hrefFor("/w/[workspace]/settings/data", ws)} className="inline-block mt-[10px] font-mono text-[10.5px] tracking-[0.05em]">
              EXPORT THE WORKSPACE →
            </Link>
          </section>
        ) : (
          <section className="border border-ink border-l-4 border-l-na bg-paper py-[18px] px-[20px]">
            <h2 className="m-0 text-[13.5px] font-semibold leading-[1.55] tracking-normal">Downgrading is the same three clicks</h2>
            <p className="mt-[6px] mb-0 text-[12.5px] leading-[1.5] text-n700">
              No call, no retention flow, no form asking why. A smaller plan starts at the next renewal, and cancelling keeps
              everything readable and every report verifiable; the export stays free.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
