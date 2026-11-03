"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { Blueprint, Button, EmptyState, cx } from "@/components/kit";
import { Screen } from "@/components/shell";
import { startCheckout } from "@/lib/billing/actions";
import { countryName, vatLabel } from "@/lib/billing/invoices";
import { annualSaving, annualSavingPercent, netPrice, type Term } from "@/lib/billing/plans";
import type { BillingDetails, TaxPreview } from "@/lib/billing/read";
import { plan as planOf } from "@/lib/public/pricing";
import { hrefFor } from "@/lib/shell/routes";
import { HELP, INPUT, LABEL } from "@/components/settings/fields";
import { BillingNoPermission, KICKER, PortalButton, Row, euros, exact, monoDay, refusalText } from "./shared";
import type { PaidPlanKey } from "../../../../../config/pricing";

// S-PLN-002 Checkout (design: product/Nutrivo Plans and Checkout.dc.html, screen "checkout"). M01, M03 (T-703).
// Decided on #64 (3 Nov 2026): payment is Stripe-hosted Checkout. This page is the review step: the order with every
// price net (M01.must.1), the exact VAT when Stripe already has the billing address (an invoice preview from Stripe
// Tax), and an optional PO reference for every invoice. The card, the billing address and the VAT number are entered
// on Stripe's page, which validates the VAT number; nothing card-related ever reaches Nutrivo.

export type CheckoutView =
  | { kind: "no-permission"; workspace: string }
  | { kind: "pick-a-plan"; workspaceId: string }
  | { kind: "live"; workspaceId: string; plan: string }
  | {
      kind: "loaded";
      workspaceId: string;
      plan: PaidPlanKey;
      term: Term;
      counts: { recipes: number; regions: number; editorSeats: number };
      details: BillingDetails | null;
      preview: TaxPreview | null;
      today: string;
    };

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const words = (n: number) => WORDS[n] ?? String(n);

export function Checkout({ route, view }: { route: string; view: CheckoutView }) {
  return (
    <Screen route={route}>
      {view.kind === "no-permission" ? (
        <BillingNoPermission workspace={view.workspace} title="Checkout" />
      ) : view.kind === "pick-a-plan" ? (
        <div className="max-w-[640px]">
          <EmptyState
            where="CHECKOUT"
            title="Choose a plan first"
            body="Checkout starts from the plan picker, which reads what this workspace already holds and names the plan that fits it."
            action={{ label: "See the plans", href: hrefFor("/w/[workspace]/billing/plans", view.workspaceId) }}
          />
        </div>
      ) : view.kind === "live" ? (
        <div className="max-w-[640px]">
          <Blueprint as="section" className="py-[22px] px-[24px]" >
            <p className={cx(KICKER, "text-accent")}>Checkout</p>
            <h2 className="mt-[8px] mb-0 text-[22px] font-semibold leading-[1.15]">This workspace is on {planOf(view.plan as PaidPlanKey).name}</h2>
            <p className="mt-[8px] mb-0 text-[13px] leading-[1.55] text-n700">
              A plan change is made on the subscription you already have, so nothing is paid twice. Upgrades start now; a
              downgrade waits for the next renewal.
            </p>
            <div className="mt-[16px]">
              <PortalButton workspaceId={view.workspaceId} flow="subscription_update" variant="primary">
                Change plan
              </PortalButton>
            </div>
          </Blueprint>
        </div>
      ) : (
        <Review view={view} />
      )}
    </Screen>
  );
}

function Review({ view }: { view: Extract<CheckoutView, { kind: "loaded" }> }) {
  const p = planOf(view.plan);
  const annual = view.term === "annual";
  const net = netPrice(view.plan, view.term);
  const poId = useId();
  const [po, setPo] = useState(view.details?.poReference ?? "");
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<string | null>(null);
  const preview = view.preview && view.preview.subtotal === net ? view.preview : null;
  const due = preview ? preview.total : null;
  const renews = new Date(view.today);
  if (annual) renews.setUTCFullYear(renews.getUTCFullYear() + 1);
  else renews.setUTCMonth(renews.getUTCMonth() + 1);
  const termLink = (t: Term) => `${hrefFor("/w/[workspace]/billing/checkout", view.workspaceId)}?plan=${view.plan}&term=${t}`;
  const d = view.details;
  const billedTo = d && (d.legalName || d.address.line1)
    ? [d.legalName, d.address.line1, [d.address.postal_code, d.address.city].filter(Boolean).join(" "), d.address.country ? countryName(d.address.country) : null, d.vat ? `VAT ${d.vat.value}` : null].filter(Boolean)
    : null;

  function pay() {
    setSaid(null);
    start(async () => {
      const r = await startCheckout(view.workspaceId, { plan: view.plan, term: view.term, poReference: po });
      if (!r.ok) setSaid(r.reason === "invalid" && r.problem === "po_too_long" ? "A purchase order reference can be up to 30 characters." : refusalText(r.reason, r.problem));
    });
  }

  return (
    <div data-screen="S-PLN-002" className="max-w-[1120px] mx-auto grid grid-cols-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] gap-[22px] items-start">
      <Blueprint as="section" className="py-[24px] px-[26px]">
        <div data-testid="checkout-form">
          <p className={cx(KICKER, "text-accent")}>Checkout</p>
          <h2 className="mt-[8px] mb-0 text-[26px] font-semibold leading-[1.1]">
            {p.name}, billed {annual ? "annually" : "monthly"}
          </h2>
          <div className="mt-[20px] flex flex-col gap-[15px]">
            <div>
              <p className={LABEL}>Billing name, address and VAT number</p>
              {billedTo ? (
                <p data-testid="billed-to" className="m-0 border border-rule bg-panel py-[10px] px-[12px] text-[13.5px] leading-[1.55]">
                  {billedTo.map((l, i) => (
                    <span key={i} className="block">
                      {l}
                    </span>
                  ))}
                </p>
              ) : null}
              <p className={HELP}>
                {billedTo
                  ? "Stripe shows these on the next page, where you can correct them before paying."
                  : "Entered on the next page, Stripe's secure payment page, together with the card. The VAT number is validated against VIES there."}
              </p>
            </div>
            <p className="m-0 text-[12px] leading-[1.45] text-n600">
              Every price we show excludes VAT. Swedish VAT at 25% is added for a Swedish company; an EU company outside Sweden
              with a valid VAT number is charged nothing under the reverse charge.
            </p>
            <div>
              <label htmlFor={poId} className={LABEL}>
                Purchase order reference <span className="font-mono text-[9.5px] tracking-[0.06em] text-n600">OPTIONAL</span>
              </label>
              <input id={poId} className={INPUT} type="text" maxLength={30} value={po} placeholder="Appears on every invoice" onChange={(e) => setPo(e.target.value)} />
            </div>
            <p className="m-0 text-[12px] leading-[1.45] text-n600">
              Paid by card on Stripe&apos;s page. {annual ? "One charge for the year." : "No minimum term: cancel any time and it ends with the month."}
            </p>
          </div>
          <div aria-live="polite">
            {said ? (
              <p role="alert" className="mt-[14px] mb-0 text-[12.5px] leading-[1.45] text-blocked">
                {said}
              </p>
            ) : null}
          </div>
          <Button variant="primary" size="md" className="mt-[22px] py-[13px] px-[24px] text-[15px]" disabled={pending} aria-busy={pending} onClick={pay} data-testid="pay">
            {pending ? "Opening Stripe…" : due !== null ? `Pay ${exact(due)} and start ${p.name}` : `Continue to payment and start ${p.name}`}
          </Button>
          <p className="mt-[14px] mb-0 text-[12px] leading-[1.5] text-n600">
            Your {words(view.counts.recipes)} {view.counts.recipes === 1 ? "recipe" : "recipes"}, your {view.counts.regions === 1 ? "region" : `${words(view.counts.regions)} regions`} and your{" "}
            {words(view.counts.editorSeats)} {view.counts.editorSeats === 1 ? "editor" : "editors"} carry over exactly as they are. Nothing is re-checked and nothing is re-entered.
          </p>
        </div>
      </Blueprint>

      <div className="flex flex-col gap-[18px]">
        <Blueprint as="section" className="py-[22px] px-[24px]">
          <div data-testid="order">
            <h2 className={cx(KICKER, "text-n600 font-normal")}>Order</h2>
            <div className="mt-[14px]">
              <div className="flex justify-between gap-[14px] items-baseline border-b border-n200 py-[9px]">
                <span className="text-[13px] text-ink">
                  {p.name} · {annual ? "12 months" : "1 month"}
                </span>
                <span data-testid="order-net" className="font-mono text-[12.5px] text-right text-ink">
                  {euros(net)}
                </span>
              </div>
              <Row size="md" k="Recipes included" v={p.recipes === null ? "UNLIMITED" : String(p.recipes)} />
              <Row size="md" k="Editor seats" v={p.editors === null ? "FREE, UNLIMITED" : String(p.editors)} tone={p.editors === null ? "clear" : "n700"} />
              <Row size="md" k="Viewers" v="FREE, UNLIMITED" tone="clear" />
              <Row size="md" k={annual ? "Annual discount · two months" : "If you paid annually"} v={annual ? "INCLUDED" : `SAVE ${euros(annualSaving(view.plan))}`} tone={annual ? "clear" : "action"} />
              <Row
                size="md"
                testId="order-vat"
                k={preview ? vatLabel(preview) : "VAT"}
                v={preview ? exact(preview.tax) : "ADDED AT PAYMENT"}
                tone={preview ? "n700" : "n600"}
              />
            </div>
            <div className="mt-[14px] flex justify-between items-baseline gap-[14px] border-t border-ink pt-[14px]">
              <span className="text-[15px] font-semibold">Due today</span>
              <span data-testid="due" className="font-mono text-[24px] leading-none">
                {due !== null ? exact(due) : `${euros(net)} + VAT`}
              </span>
            </div>
            <p className="mt-[10px] mb-0 font-mono text-[10px] tracking-[0.05em] text-n600">
              RENEWS {monoDay(renews.toISOString())} · {annual ? "CANCEL ANY TIME BEFORE" : "NO MINIMUM TERM"}
            </p>
          </div>
        </Blueprint>
        <section
          data-testid="annual"
          className={cx("border py-[20px] px-[22px] border-l-4", annual ? "border-clear border-l-clear bg-clear-bg" : "border-ink border-l-accent bg-accent-100")}
        >
          <h2 className="m-0 text-[14px] font-semibold leading-[1.55] tracking-normal">{annual ? "You are on annual" : "Annual is two months free"}</h2>
          <p className="mt-[7px] mb-0 text-[13px] leading-[1.55] text-n700">
            {euros(netPrice(view.plan, "annual"))} for twelve months instead of {euros(netPrice(view.plan, "monthly") * 12)}
            {annual
              ? ". The discount is the same on every plan — we concede on term, never on price."
              : `, a saving of ${euros(annualSaving(view.plan))}, and the same ${annualSavingPercent(view.plan)} on every plan. Nothing else changes.`}
          </p>
          <Link
            href={termLink(annual ? "monthly" : "annual")}
            className={cx(
              "inline-block mt-[13px] border rounded-control py-[9px] px-[15px] text-[13px] no-underline",
              annual ? "border-n400 text-n700 hover:border-accent hover:text-accent-700" : "border-accent text-accent-700 hover:bg-accent-100",
            )}
          >
            {annual ? "Switch to monthly" : "Switch to annual"}
          </Link>
        </section>
        <section className="border border-rule bg-paper py-[18px] px-[20px]">
          <h2 className="m-0 text-[13px] font-semibold leading-[1.55] tracking-normal">What you are not signing up to</h2>
          <p className="mt-[6px] mb-0 text-[12.5px] leading-[1.5] text-n700">
            No minimum term on monthly, no per-check fee, no charge for viewers, and no charge for your suppliers. Cancel and
            the workspace stops accepting new labels rather than closing — everything you have stays readable and every
            report you sent stays verifiable.
          </p>
        </section>
      </div>
    </div>
  );
}
