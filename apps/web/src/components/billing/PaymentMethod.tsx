"use client";

import { Blueprint, ButtonLink, cx } from "@/components/kit";
import { SettingsHeader, SettingsMain } from "@/components/settings/SettingsFrame";
import type { Chip } from "@/lib/billing/chip";
import type { CardOnFile } from "@/lib/billing/read";
import { hrefFor, routeFor } from "@/lib/shell/routes";
import { SELLER } from "./InvoiceView";
import { BillingNoPermission, KICKER, PortalButton } from "./shared";

// S-BIL-003 Payment method (design: product/Nutrivo Billing Settings.dc.html, screen "payment"). M04, M05 (T-703).
// Decided on #64 (3 Nov 2026): the card is read from Stripe at request time and nothing about it is stored in
// Nutrivo; replacing it or adding a backup opens the Stripe customer portal's payment-method flow. The dunning rows
// are BE-36 as docs/08 sets it out: a failed card never deletes anything and never makes a report unverifiable.

export type PaymentView =
  | { kind: "no-permission"; workspace: string }
  | { kind: "loaded"; workspaceId: string; chip: Chip; hasCustomer: boolean; cards: CardOnFile[] | null };

const DUNNING: { when: string; v: string; tone: string }[] = [
  { when: "DAY 0", v: "We email the person who pays and the finance address, name the amount, and retry in three days. Nothing changes in the product.", tone: "text-n600" },
  { when: "DAY 3", v: "Second attempt, second email. Still nothing changes in the product.", tone: "text-n600" },
  { when: "DAY 7", v: "Third attempt. A banner appears for admins only — not for the people doing the work.", tone: "text-action" },
  { when: "DAY 14", v: "The workspace stops accepting new labels. Nothing is deleted, everything already checked stays readable, and every report already sent stays verifiable.", tone: "text-blocked" },
];

const ENTITY: [string, string][] = [
  ["Legal entity", SELLER.name],
  ["Trading as", "Nutrivo.ai"],
  ["Company ID", SELLER.companyId],
  ["VAT number", SELLER.vat],
  ["Registered address", SELLER.address],
];

const BRAND: Record<string, string> = { visa: "VISA", mastercard: "MASTERCARD", amex: "AMEX", discover: "DISCOVER", jcb: "JCB", unionpay: "UNIONPAY", diners: "DINERS" };

export function PaymentMethod({ route, view }: { route: string; view: PaymentView }) {
  const title = routeFor(route).title;
  return (
    <>
      <SettingsHeader title={title} chip={view.kind === "loaded" ? view.chip.text : undefined} tone={view.kind === "loaded" ? view.chip.tone : undefined} />
      <SettingsMain>{view.kind === "no-permission" ? <BillingNoPermission workspace={view.workspace} title={title} /> : <Loaded view={view} />}</SettingsMain>
    </>
  );
}

function Loaded({ view }: { view: Extract<PaymentView, { kind: "loaded" }> }) {
  const cards = view.cards ?? [];
  return (
    <div data-screen="S-BIL-003" className="grid gap-[20px] items-start grid-cols-1 lg:grid-cols-2">
      <Blueprint as="section" className="py-[22px] px-[24px]">
        <div data-testid="on-file">
          <h2 className={cx(KICKER, "text-n600 font-normal")}>On file</h2>
          {view.cards === null ? (
            <p className="mt-[14px] mb-0 border border-rule bg-panel py-[14px] px-[16px] text-[13px] leading-[1.5] text-n700">
              Stripe did not answer, so the card cannot be shown just now. Nothing about it has changed.
            </p>
          ) : cards.length ? (
            <ul className="mt-[14px] mb-0 p-0 list-none flex flex-col gap-[10px]">
              {cards.map((c, i) => (
                <li key={`${c.brand}-${c.last4}-${i}`} data-testid="card" className="border border-ink py-[16px] px-[18px] flex items-center justify-between gap-[16px]">
                  <div>
                    <p className="m-0 font-mono text-[15px] tracking-[0.06em]">
                      {BRAND[c.brand] ?? c.brand.toUpperCase()} ···· {c.last4}
                    </p>
                    <p className="mt-[6px] mb-0 text-[12.5px] text-n700">
                      Expires {String(c.expMonth).padStart(2, "0")} / {c.expYear}
                      {c.name ? ` · ${c.name}` : ""}
                    </p>
                  </div>
                  {c.primary ? <span className="font-mono text-[10px] tracking-[0.06em] border border-clear bg-clear-bg py-[5px] px-[8px] text-n800">PRIMARY</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-[14px] mb-0 border border-rule bg-panel py-[14px] px-[16px] text-[13px] leading-[1.5] text-n700">
              No card on file. The free plan needs none; Stripe asks for one at checkout when you choose a plan.
            </p>
          )}
          <div className="mt-[14px] flex flex-wrap gap-[10px]">
            {view.hasCustomer ? (
              <>
                <PortalButton workspaceId={view.workspaceId} flow="payment_method_update" returnTo="payment" size="sm" className="py-[9px] px-[15px] text-[13px]" testId="replace-card">
                  {cards.length ? "Replace card" : "Add a card"}
                </PortalButton>
                {cards.length ? (
                  <PortalButton workspaceId={view.workspaceId} flow="payment_method_update" returnTo="payment" size="sm" className="py-[9px] px-[15px] text-[13px]" testId="backup-card">
                    Add a backup card
                  </PortalButton>
                ) : null}
              </>
            ) : (
              <ButtonLink href={hrefFor("/w/[workspace]/billing/plans", view.workspaceId)} size="sm">
                See the plans
              </ButtonLink>
            )}
          </div>
          <p className={cx(KICKER, "mt-[18px] pt-[16px] border-t border-n200 text-action")}>If a payment fails</p>
          <div className="mt-[12px] flex flex-col gap-[9px]">
            {DUNNING.map((d) => (
              <div key={d.when} className="grid grid-cols-[74px_minmax(0,1fr)] gap-[12px] items-baseline border-b border-n200 pb-[8px]">
                <span className={cx("font-mono text-[10.5px] tracking-[0.05em]", d.tone)}>{d.when}</span>
                <span className="text-[12.5px] leading-[1.45] text-n700">{d.v}</span>
              </div>
            ))}
          </div>
          <p className="mt-[13px] mb-0 text-[12.5px] leading-[1.5] text-n700">
            A failed card never deletes anything and never makes a report unverifiable. Somebody outside your company may be holding one.
          </p>
        </div>
      </Blueprint>
      <Blueprint as="section" className="py-[22px] px-[24px]">
        <div data-testid="who-you-pay">
          <h2 className={cx(KICKER, "text-n600 font-normal")}>Who you are paying</h2>
          <div className="mt-[14px] border border-rule bg-panel py-[16px] px-[18px]">
            <p className="m-0 flex items-end gap-[4px] text-[18px] font-semibold tracking-[-0.045em] leading-none">
              <span>nutrivo</span>
              <span aria-hidden className="w-[5px] h-[5px] bg-accent mb-[2px]" />
              <span className="text-[13px] font-normal text-n600 tracking-normal">.ai</span>
            </p>
            <dl className="mt-[14px] mb-0 flex flex-col gap-[7px]">
              {ENTITY.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[128px_minmax(0,1fr)] gap-[12px] items-baseline">
                  <dt className="font-mono text-[9.5px] tracking-[0.09em] uppercase text-n600">{k}</dt>
                  <dd className="m-0 text-[12.5px] leading-[1.45] text-n800">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <p className="mt-[14px] mb-0 text-[12.5px] leading-[1.55] text-n700">
            Nutrivo.ai is the product; Sunny Ventures AB is the company on the invoice and in the terms. Both names appear on every document so a finance department never has to ask which is which.
          </p>
        </div>
      </Blueprint>
    </div>
  );
}
