"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Blueprint, EmptyState, LoadingState, cx } from "@/components/kit";
import { Screen } from "@/components/shell";
import { treatmentNote, vatLabel, type Invoice } from "@/lib/billing/invoices";
import { plan as planOf } from "@/lib/public/pricing";
import { hrefFor } from "@/lib/shell/routes";
import { BillingNoPermission, KICKER, exact, longDay, period } from "./shared";

// S-PLN-003 Invoice and receipt (design: product/Nutrivo Plans and Checkout.dc.html, screen "invoice"). M03 (T-703).
// The invoice exactly as Stripe issued it, read from the stored `invoice.paid` event: net lines, the VAT Stripe Tax
// charged and, for an EU business with a validated VAT number, the reverse charge (M03.must.1). Checkout returns
// here with its session id; until Stripe's invoice event has arrived the screen says the payment is received and
// waits for it, rather than showing an invoice it does not have.

export const SELLER = {
  name: "Sunny Ventures AB",
  address: "Karlbergsvägen 48, 113 37 Stockholm, Sweden",
  companyId: "5594297151",
  vat: "SE559429715101",
};

export type InvoiceScreenView =
  | { kind: "no-permission"; workspace: string }
  | { kind: "unknown"; workspaceId: string }
  | { kind: "pending"; workspaceId: string }
  | {
      kind: "invoice";
      workspaceId: string;
      workspace: string;
      invoice: Invoice;
      /** Reached from Checkout, and the plan is live now: the banner and "Now on" show. */
      justSubscribed: boolean;
      inUse: { recipes: number; editorSeats: number };
    };

export function InvoiceView({ route, view }: { route: string; view: InvoiceScreenView }) {
  return (
    <Screen route={route}>
      {view.kind === "no-permission" ? (
        <BillingNoPermission workspace={view.workspace} title="Invoice and receipt" />
      ) : view.kind === "unknown" ? (
        <div className="max-w-[640px]">
          <EmptyState
            where="INVOICE"
            title="There is no such invoice in this workspace"
            body="It may belong to another workspace, or the link is incomplete. Every invoice this workspace has is listed in Billing settings."
            action={{ label: "All invoices", href: hrefFor("/w/[workspace]/settings/billing/invoices", view.workspaceId) }}
          />
        </div>
      ) : view.kind === "pending" ? (
        <Pending />
      ) : (
        <Receipt view={view} />
      )}
    </Screen>
  );
}

/** Paid at Stripe, invoice not here yet: refresh every few seconds for a minute, then say so plainly. */
function Pending() {
  const router = useRouter();
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (tries >= 20) return;
    const t = setTimeout(() => {
      setTries((n) => n + 1);
      router.refresh();
    }, 3000);
    return () => clearTimeout(t);
  }, [tries, router]);
  return (
    <div className="max-w-[640px]" data-testid="invoice-pending">
      <LoadingState label="PAYMENT RECEIVED · ISSUING THE INVOICE">
        {tries < 20
          ? "Stripe has taken the payment and is issuing the invoice. This page shows it as soon as it arrives, usually within a few seconds."
          : "Stripe has taken the payment; the invoice has not reached us yet. It will be under Billing settings, Invoices, and it is also emailed to the billing address."}
      </LoadingState>
    </div>
  );
}

function Receipt({ view }: { view: Extract<InvoiceScreenView, { kind: "invoice" }> }) {
  const inv = view.invoice;
  const p = inv.plan === "basic" || inv.plan === "standard" || inv.plan === "advanced" ? planOf(inv.plan) : null;
  const paid = inv.status === "paid";
  const note = treatmentNote(inv.treatment);
  const included = p
    ? [
        { k: "Recipes", sub: `${p.recipes === null ? "Unlimited" : `${p.recipes} included`} · ${view.inUse.recipes} in use`, qty: p.recipes === null ? "—" : String(p.recipes), amt: "Included" },
        { k: "Region · EU", sub: "27 member states, 24 official languages", qty: "1", amt: "Included" },
        { k: "Editor seats", sub: `${p.editors === null ? "No seat check" : `${p.editors} included`} · ${view.inUse.editorSeats} in use. Viewers unlimited and free`, qty: p.editors === null ? "—" : String(p.editors), amt: "Included" },
      ]
    : [];
  const ws = view.workspaceId;
  const links: [string, string][] = [
    ["ALL INVOICES", hrefFor("/w/[workspace]/settings/billing/invoices", ws)],
    ["PAYMENT METHOD", hrefFor("/w/[workspace]/settings/billing/payment", ws)],
    ["VAT AND BILLING ADDRESS", hrefFor("/w/[workspace]/settings/billing/details", ws)],
    ["RECIPES USED AGAINST ALLOWANCE", hrefFor("/w/[workspace]/settings/billing", ws)],
  ];
  return (
    <div className="max-w-[1120px] mx-auto" data-screen="S-PLN-003">
      {view.justSubscribed && p ? (
        <div data-testid="live-banner" role="status" className="border border-clear bg-clear-bg py-[16px] px-[20px] flex items-center gap-[14px] mb-[20px]">
          <span aria-hidden className="w-[12px] h-[12px] flex-none bg-clear" />
          <p className="m-0 text-[14.5px] font-semibold">{p.name} is live. New labels are no longer limited to the free three, for every recipe in this workspace.</p>
        </div>
      ) : null}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] gap-[22px] items-start">
        <Blueprint as="article" className="py-[26px] px-[28px]">
          <div data-testid="invoice">
            <div className="flex flex-col sm:flex-row justify-between items-start gap-[20px] border-b border-ink pb-[16px]">
              <div>
                <p className="m-0 flex items-end gap-[4px] text-[19px] font-semibold tracking-[-0.045em] leading-none">
                  <span>nutrivo</span>
                  <span aria-hidden className="w-[5px] h-[5px] bg-accent mb-[2px]" />
                </p>
                <p className="mt-[8px] mb-0 text-[12px] leading-[1.5] text-n600">
                  {SELLER.name} · {SELLER.address}
                  <br />
                  Company ID {SELLER.companyId} · VAT {SELLER.vat}
                </p>
              </div>
              <div className="sm:text-right">
                <h2 className="m-0 text-[20px] font-semibold leading-[1.55] tracking-normal">Invoice</h2>
                <p className="mt-[6px] mb-0 font-mono text-[11px] leading-[1.6] text-n700">
                  {inv.number ?? inv.id}
                  <br />
                  Issued {longDay(inv.issuedAt)}
                  <br />
                  <span data-testid="invoice-state" className={cx(inv.failed ? "text-blocked" : paid ? "" : "text-action")}>
                    {inv.failed ? `Payment failed · ${exact(inv.amountDue)} due` : paid ? "Paid · nothing due" : `${exact(inv.amountDue)} due`}
                  </span>
                </p>
              </div>
            </div>
            <div className="mt-[18px] grid grid-cols-1 sm:grid-cols-2 gap-[20px]">
              <div>
                <p className="m-0 font-mono text-[9.5px] tracking-[0.1em] uppercase text-n600">Billed to</p>
                <p data-testid="billed-to" className="mt-[7px] mb-0 text-[13px] leading-[1.55]">
                  {[inv.billedTo.name, ...inv.billedTo.lines, inv.billedTo.vat ? `VAT ${inv.billedTo.vat}` : null].filter(Boolean).map((l, i) => (
                    <span key={i} className="block">
                      {l}
                    </span>
                  ))}
                </p>
              </div>
              <div>
                <p className="m-0 font-mono text-[9.5px] tracking-[0.1em] uppercase text-n600">Period</p>
                <p className="mt-[7px] mb-0 text-[13px] leading-[1.55]">
                  <span className="block">{period(inv.periodStart, inv.periodEnd)}</span>
                  <span className="block">Workspace: {view.workspace}</span>
                  {p ? <span className="block">Plan: {p.name}</span> : null}
                </p>
              </div>
            </div>
            <table className="mt-[22px] w-full border border-rule border-collapse text-left" data-testid="invoice-lines">
              <thead className="bg-panel border-b border-ink">
                <tr>
                  {["Line", "Qty", "Amount"].map((h, i) => (
                    <th key={h} scope="col" className={cx("py-[9px] px-[14px] font-mono text-[9.5px] tracking-[0.1em] uppercase text-n600 font-normal", i === 2 && "text-right", i === 1 && "w-[92px]", i === 2 && "w-[120px]")}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {inv.lines.map((l, i) => (
                  <tr key={`l${i}`} className="border-b border-n200">
                    <td className="py-[11px] px-[14px]">
                      <p className="m-0 text-[13px] font-medium">{p && i === 0 ? `${p.name} plan` : l.description}</p>
                      <p className="mt-[3px] mb-0 text-[11.5px] leading-[1.4] text-n600">
                        {p && i === 0 ? (inv.term === "annual" ? "Twelve months, two of them free" : "One month, no minimum term") : period(l.periodStart, l.periodEnd)}
                      </p>
                    </td>
                    <td className="py-[11px] px-[14px] font-mono text-[12px] text-n700">{l.quantity ?? "—"}</td>
                    <td className="py-[11px] px-[14px] font-mono text-[12.5px] text-right">{exact(l.amount)}</td>
                  </tr>
                ))}
                {included.map((l) => (
                  <tr key={l.k} className="border-b border-n200">
                    <td className="py-[11px] px-[14px]">
                      <p className="m-0 text-[13px] font-medium">{l.k}</p>
                      <p className="mt-[3px] mb-0 text-[11.5px] leading-[1.4] text-n600">{l.sub}</p>
                    </td>
                    <td className="py-[11px] px-[14px] font-mono text-[12px] text-n700">{l.qty}</td>
                    <td className="py-[11px] px-[14px] font-mono text-[12.5px] text-right text-n600">{l.amt}</td>
                  </tr>
                ))}
                <tr className="border-b border-n200">
                  <td className="py-[11px] px-[14px]">
                    <p className="m-0 text-[13px] font-medium">Checks and re-checks</p>
                    <p className="mt-[3px] mb-0 text-[11.5px] leading-[1.4] text-n600">Never metered on any plan</p>
                  </td>
                  <td className="py-[11px] px-[14px] font-mono text-[12px] text-n700">—</td>
                  <td className="py-[11px] px-[14px] font-mono text-[12.5px] text-right text-clear">€0.00</td>
                </tr>
              </tbody>
            </table>
            <div className="mt-[16px] flex justify-end">
              <div className="w-full sm:w-[300px]" data-testid="invoice-totals">
                <div className="flex justify-between gap-[14px] items-baseline py-[7px] border-b border-n200">
                  <span className="text-[12.5px] text-n700">Subtotal</span>
                  <span className="font-mono text-[12.5px]" data-testid="subtotal">{exact(inv.subtotal)}</span>
                </div>
                <div className="flex justify-between gap-[14px] items-baseline py-[7px] border-b border-n200">
                  <span className="text-[12.5px] text-n700" data-testid="vat-label">{vatLabel(inv)}</span>
                  <span className="font-mono text-[12.5px]" data-testid="vat">{exact(inv.tax)}</span>
                </div>
                <div className="flex justify-between gap-[14px] items-baseline border-t border-ink pt-[12px] mt-[6px]">
                  <span className="text-[14px] font-semibold">{paid ? "Total paid" : "Total"}</span>
                  <span className="font-mono text-[20px] leading-none" data-testid="total">{exact(inv.total)}</span>
                </div>
              </div>
            </div>
            {note ? (
              <p data-testid="vat-note" className={cx("mt-[14px] mb-0 text-[12px] leading-[1.5]", inv.treatment === "reverse_charge" ? "text-ink font-medium" : "text-n700")}>
                {note}
              </p>
            ) : null}
            {inv.pdfUrl || inv.hostedUrl ? (
              <p className="mt-[14px] mb-0 flex gap-[16px] font-mono text-[10.5px] tracking-[0.05em]">
                {inv.pdfUrl ? <a href={inv.pdfUrl} rel="noopener noreferrer">DOWNLOAD PDF</a> : null}
                {inv.hostedUrl ? <a href={inv.hostedUrl} rel="noopener noreferrer">OPEN ON STRIPE</a> : null}
              </p>
            ) : null}
            <p className="mt-[22px] mb-0 pt-[14px] border-t border-n200 text-[11.5px] leading-[1.5] text-n600">
              Nutrivo names regulatory obligations and checks label artwork against encoded rules. It does not file registrations,
              pay fees, correspond with authorities, confirm that a registration is valid, or guarantee acceptance.
            </p>
          </div>
        </Blueprint>
        <div className="flex flex-col gap-[18px]">
          {view.justSubscribed && p ? (
            <Blueprint as="section" className="py-[20px] px-[22px]">
              <h2 className={cx(KICKER, "text-accent font-normal")}>Now on</h2>
              <ul className="mt-[12px] mb-0 p-0 list-none flex flex-col gap-[9px]">
                {[
                  `${p.recipes === null ? "Unlimited recipes" : `${p.recipes} recipes`} and ${p.editors === null ? "people unlimited and free" : `${p.editors} editor seats`}`,
                  "Every new label you add, past the free three",
                  "Checks, re-checks, viewers and supplier links, never metered",
                  "Everything already in the workspace, its reports and their verification, exactly as they were",
                ].map((t) => (
                  <li key={t} className="flex gap-[10px] items-baseline">
                    <span aria-hidden className="w-[10px] h-[10px] flex-none bg-clear mt-[4px]" />
                    <span className="text-[13px] leading-[1.45] text-n800">{t}</span>
                  </li>
                ))}
              </ul>
            </Blueprint>
          ) : null}
          <section className="border border-rule bg-paper py-[20px] px-[22px]">
            <h2 className="m-0 text-[13.5px] font-semibold leading-[1.55] tracking-normal">Billing lives in settings</h2>
            <p className="mt-[7px] mb-0 text-[12.5px] leading-[1.5] text-n700">
              Every invoice, the payment method, the VAT number and the recipe allowance against what you are using.
              Downgrading is the same three clicks as upgrading.
            </p>
            <nav aria-label="Billing settings" className="mt-[13px] flex flex-col gap-[7px]">
              {links.map(([k, href]) => (
                <Link key={k} href={href} className="font-mono text-[11px] tracking-[0.04em]">
                  {k}
                </Link>
              ))}
            </nav>
          </section>
        </div>
      </div>
    </div>
  );
}
