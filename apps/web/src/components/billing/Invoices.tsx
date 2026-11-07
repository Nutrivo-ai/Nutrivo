"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { Blueprint, Button, EmptyState, cx } from "@/components/kit";
import { INPUT } from "@/components/settings/fields";
import { SettingsHeader, SettingsMain } from "@/components/settings/SettingsFrame";
import { saveFinanceEmail } from "@/lib/billing/actions";
import type { Invoice } from "@/lib/billing/invoices";
import { PROBLEM_TEXT } from "@/lib/billing/rules";
import { plan as planOf } from "@/lib/public/pricing";
import { hrefFor, routeFor } from "@/lib/shell/routes";
import { BillingNoPermission, day, exact, period, refusalText, TONE, type Tone } from "./shared";

// S-BIL-002 Invoices (design: product/Nutrivo Billing Settings.dc.html, screen "invoices"). M03 (T-703). Every invoice
// Stripe issued for the workspace, from the stored invoice events (admins only), newest first; each opens as
// S-PLN-003 and downloads as Stripe's own PDF. The finance address is the Stripe customer's email: Stripe sends it
// every invoice. It is not a seat and needs no account.

export type InvoicesView =
  | { kind: "no-permission"; workspace: string }
  | { kind: "loaded"; workspaceId: string; invoices: Invoice[]; financeEmail: string | null; chip: { text: string; tone: "n600" | "clear" | "blocked" } };

function stateOf(i: Invoice): { text: string; tone: Tone } {
  if (i.failed) return { text: "PAYMENT FAILED", tone: "blocked" };
  if (i.status === "paid") return { text: "PAID", tone: "clear" };
  if (i.status === "void") return { text: "VOID", tone: "n600" };
  if (i.status === "uncollectible") return { text: "UNCOLLECTIBLE", tone: "blocked" };
  return { text: "OPEN", tone: "action" };
}

export function Invoices({ route, view }: { route: string; view: InvoicesView }) {
  const title = routeFor(route).title;
  return (
    <>
      <SettingsHeader title={title} chip={view.kind === "loaded" ? view.chip.text : undefined} tone={view.kind === "loaded" ? view.chip.tone : undefined} />
      <SettingsMain>{view.kind === "no-permission" ? <BillingNoPermission workspace={view.workspace} title={title} /> : <Loaded view={view} />}</SettingsMain>
    </>
  );
}

const WIDTHS = ["128px", undefined, "120px", "108px", "112px", "104px"];

function Loaded({ view }: { view: Extract<InvoicesView, { kind: "loaded" }> }) {
  return (
    <div data-screen="S-BIL-002">
      {view.invoices.length === 0 ? (
        <div className="max-w-[640px]">
          <EmptyState
            where="INVOICES"
            title="No invoices yet"
            body="The free plan needs no card and sends no invoice. Every invoice appears here once the workspace has a plan, itemised and with its VAT stated."
            action={{ label: "See the plans", href: hrefFor("/w/[workspace]/billing/plans", view.workspaceId), variant: "secondary" }}
          />
        </div>
      ) : (
        <Blueprint as="section" className="overflow-x-auto">
          <table className="w-full min-w-[760px] table-fixed border-collapse text-left align-top" data-testid="invoice-list">
            <colgroup>
              {WIDTHS.map((w, i) => (
                <col key={i} style={w ? { width: w } : undefined} />
              ))}
            </colgroup>
            <thead>
              <tr className="bg-panel border-b border-ink">
                {["Reference", "Line", "Issued", "Amount", "Status", ""].map((h, i) => (
                  <th key={i} scope="col" className="py-[10px] px-[14px] font-mono text-[9.5px] tracking-[0.1em] uppercase text-n600 font-normal">
                    {h || <span className="sr-only">Download</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.invoices.map((inv, i, a) => {
                const st = stateOf(inv);
                const p = inv.plan === "basic" || inv.plan === "standard" || inv.plan === "advanced" ? planOf(inv.plan) : null;
                return (
                  <tr key={inv.id} data-invoice={inv.id} className={cx(i < a.length - 1 && "border-b border-n200", i % 2 === 1 && "bg-panel")}>
                    <td className="py-[12px] px-[14px] font-mono text-[12px]">
                      <Link href={hrefFor("/w/[workspace]/billing/invoices/[invoice]", view.workspaceId).replace("[invoice]", inv.id)}>{inv.number ?? inv.id.slice(0, 14)}</Link>
                    </td>
                    <td className="py-[12px] px-[14px]">
                      <p className="m-0 text-[13px] font-medium">{p ? `${p.name} · ${inv.term === "annual" ? "annual" : "monthly"}` : (inv.lines[0]?.description ?? "Invoice")}</p>
                      <p className="mt-[3px] mb-0 text-[11.5px] text-n600">
                        {period(inv.periodStart, inv.periodEnd)}
                        {inv.treatment === "reverse_charge" ? " · reverse charge" : ""}
                      </p>
                    </td>
                    <td className="py-[12px] px-[14px] font-mono text-[11.5px] text-n700">{day(inv.issuedAt)}</td>
                    <td className="py-[12px] px-[14px] font-mono text-[12px]">{exact(inv.total)}</td>
                    <td className={cx("py-[12px] px-[14px] font-mono text-[10.5px] tracking-[0.05em]", TONE[st.tone])}>{st.text}</td>
                    <td className="py-[12px] px-[14px]">
                      {inv.pdfUrl ? (
                        <a href={inv.pdfUrl} rel="noopener noreferrer" className="font-mono text-[10.5px] tracking-[0.05em]">
                          PDF<span className="sr-only"> of {inv.number ?? "this invoice"}</span>
                        </a>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Blueprint>
      )}
      <div className="mt-[20px] grid grid-cols-1 lg:grid-cols-3 gap-[18px]">
        <section className="border border-ink bg-paper py-[18px] px-[20px]">
          <h2 className="m-0 text-[13.5px] font-semibold leading-[1.55] tracking-normal">Every invoice is itemised the same way</h2>
          <p className="mt-[6px] mb-0 text-[12.5px] leading-[1.5] text-n700">
            The plan line, then recipes, region, seats and checks shown as included at €0.00. Nothing arrives as a surprise
            line, because there is no line we could add without telling you first.
          </p>
        </section>
        <FinanceEmail workspaceId={view.workspaceId} initial={view.financeEmail} />
        <section className="border border-rule bg-paper py-[18px] px-[20px]">
          <h2 className="m-0 text-[13.5px] font-semibold leading-[1.55] tracking-normal">Need a different format?</h2>
          <p className="mt-[6px] mb-0 text-[12.5px] leading-[1.5] text-n700">
            PEPPOL e-invoicing and 30-day terms are available on Advanced, and on annual Standard by request. Ask{" "}
            <a href="mailto:hello@nutrivo.ai" className="underline">hello@nutrivo.ai</a>.
          </p>
        </section>
      </div>
    </div>
  );
}

function FinanceEmail({ workspaceId, initial }: { workspaceId: string; initial: string | null }) {
  const id = useId();
  const [email, setEmail] = useState(initial ?? "");
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <section className="border border-ink bg-paper py-[18px] px-[20px]" data-testid="finance-email">
      <h2 className="m-0 text-[13.5px] font-semibold leading-[1.55] tracking-normal">Send invoices to somebody else</h2>
      <p className="mt-[6px] mb-0 text-[12.5px] leading-[1.5] text-n700">A finance address receives every invoice as a PDF. It is not a seat and it does not need an account.</p>
      {initial === null ? (
        <p className="mt-[11px] mb-0 text-[12px] text-n600">The finance address can be set once Stripe is reachable again.</p>
      ) : (
        <form
          className="mt-[11px] flex gap-[8px]"
          onSubmit={(e) => {
            e.preventDefault();
            setSaid(null);
            start(async () => {
              const r = await saveFinanceEmail(workspaceId, email);
              setSaid(r.ok ? { ok: true, text: "Saved. Every invoice from now goes to this address." } : { ok: false, text: (r.problem && PROBLEM_TEXT[r.problem]) || refusalText(r.reason, r.problem) });
            });
          }}
        >
          <label htmlFor={id} className="sr-only">
            Finance email
          </label>
          <input id={id} className={INPUT} type="email" value={email} placeholder="finance@yourcompany.com" onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </form>
      )}
      <div aria-live="polite">
        {said ? (
          <p role={said.ok ? "status" : "alert"} className={cx("mt-[8px] mb-0 text-[12px]", said.ok ? "text-clear" : "text-blocked")}>
            {said.text}
          </p>
        ) : null}
      </div>
    </section>
  );
}
