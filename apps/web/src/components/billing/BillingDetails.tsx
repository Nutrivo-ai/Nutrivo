"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Blueprint, Button, cx } from "@/components/kit";
import { HELP, INPUT, LABEL } from "@/components/settings/fields";
import { routeFor } from "@/lib/shell/routes";
import { SettingsHeader, SettingsMain } from "@/components/settings/SettingsFrame";
import { saveBillingDetails } from "@/lib/billing/actions";
import type { Chip } from "@/lib/billing/chip";
import { countryName, inEu, SELLER_COUNTRY } from "@/lib/billing/invoices";
import type { BillingDetails as Details } from "@/lib/billing/read";
import { EU_COUNTRIES, OTHER_COUNTRIES, PROBLEM_TEXT, type DetailsInput } from "@/lib/billing/rules";
import { BillingNoPermission, KICKER, refusalText } from "./shared";

// A select matches :read-only, so it takes the input class without the read-only greys.
const SELECT = INPUT.replace("read-only:bg-panel read-only:text-n700 ", "");

// S-BIL-004 Billing details (design: product/Nutrivo Billing Settings.dc.html, screen "details"). M03 (T-703).
// Decided on #64 (3 Nov 2026): the details live on the Stripe customer (D-18) and are read and saved there; Stripe
// validates the VAT number against VIES and Stripe Tax uses the country and the number to charge Swedish VAT, apply
// the reverse charge, use the one-stop shop or charge none. The status under the VAT number is the one Stripe
// reports. Billing details are not the operator on the label and change nothing in a report.

export type DetailsView =
  | { kind: "no-permission"; workspace: string }
  | { kind: "unavailable"; workspaceId: string; chip: Chip }
  | { kind: "loaded"; workspaceId: string; chip: Chip; details: Details };

const VAT_ROWS: { k: string; rate: string; tone: string; v: string }[] = [
  { k: "Sweden", rate: "25%", tone: "text-ink", v: "Swedish VAT is charged in full. Sunny Ventures AB is registered in Sweden." },
  { k: "EU, VAT number given", rate: "0% · REVERSE CHARGE", tone: "text-clear", v: "No VAT charged. The invoice states the reverse charge and your VAT number, validated against VIES." },
  { k: "EU, no VAT number", rate: "LOCAL RATE", tone: "text-action", v: "VAT at your own country's rate, under the one-stop shop." },
  { k: "Outside the EU", rate: "0%", tone: "text-clear", v: "No VAT charged. Any local tax on the import of services is yours to account for." },
];

const VIES: Record<string, { text: string; tone: string }> = {
  verified: { text: "VALIDATED AGAINST VIES", tone: "text-clear" },
  pending: { text: "BEING CHECKED AGAINST VIES", tone: "text-action" },
  unverified: { text: "NOT VALID IN VIES · NO REVERSE CHARGE", tone: "text-blocked" },
  unavailable: { text: "VIES DID NOT ANSWER · CHECKED AGAIN", tone: "text-action" },
};

/** What the "Applied to this workspace" box says for the saved country and VAT number. */
export function applied(country: string | null, vat: Details["vat"]): { k: string; rate: string; v: string } {
  const base = "All prices on the plan cards and in checkout are shown excluding VAT. It is added on the invoice.";
  if (!country) return { k: "No billing country yet", rate: "—", v: `${base} Stripe decides the VAT from the country and VAT number saved here or entered at checkout.` };
  if (country === SELLER_COUNTRY) return { k: "Sweden · standard rate", rate: "25%", v: base };
  if (inEu(country) && vat?.status === "verified") return { k: `${countryName(country)} · reverse charge`, rate: "0%", v: `${base} With a validated VAT number nothing is added, and the invoice states the reverse charge.` };
  if (inEu(country)) return { k: `${countryName(country)} · one-stop shop`, rate: "LOCAL RATE", v: `${base} Without a validated VAT number, VAT is charged at ${countryName(country)}'s rate.` };
  return { k: "Outside the EU", rate: "0%", v: `${base} Nothing is added for a customer outside the EU.` };
}

export function BillingDetails({ route, view }: { route: string; view: DetailsView }) {
  const title = routeFor(route).title;
  return (
    <>
      <SettingsHeader title={title} chip={view.kind === "no-permission" ? undefined : view.chip.text} tone={view.kind === "no-permission" ? undefined : view.chip.tone} />
      <SettingsMain>
        {view.kind === "no-permission" ? (
          <BillingNoPermission workspace={view.workspace} title={title} />
        ) : view.kind === "unavailable" ? (
          <p role="alert" className="max-w-[640px] m-0 border border-ink border-l-4 border-l-blocked bg-paper py-[16px] px-[18px] text-[13px] leading-[1.5]">
            Stripe did not answer, so the billing details cannot be shown or changed just now. Nothing about them has changed. Try again in a moment.
          </p>
        ) : (
          <Loaded workspaceId={view.workspaceId} details={view.details} />
        )}
      </SettingsMain>
    </>
  );
}

function Loaded({ workspaceId, details: d }: { workspaceId: string; details: Details }) {
  const router = useRouter();
  const ids = { name: useId(), a1: useId(), a2: useId(), zip: useId(), city: useId(), country: useId(), vat: useId(), cid: useId(), po: useId() };
  const [form, setForm] = useState<DetailsInput>({
    legalName: d.legalName,
    line1: d.address.line1 ?? "",
    line2: d.address.line2 ?? "",
    postalCode: d.address.postal_code ?? "",
    city: d.address.city ?? "",
    country: d.address.country ?? "",
    vat: d.vat?.value ?? "",
    companyId: d.companyId,
    poReference: d.poReference,
  });
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof DetailsInput) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const box = applied(d.address.country, d.vat);
  const vies = d.vat?.status ? VIES[d.vat.status] : null;

  function save() {
    setSaid(null);
    start(async () => {
      const r = await saveBillingDetails(workspaceId, form);
      if (r.ok) {
        setSaid({ ok: true, text: "Saved. The next invoice carries these details; a new VAT number is checked against VIES now." });
        router.refresh();
      } else {
        setSaid({ ok: false, text: r.problem && PROBLEM_TEXT[r.problem] ? PROBLEM_TEXT[r.problem] : refusalText(r.reason, r.problem) });
      }
    });
  }

  const optional = <span className="font-mono text-[9.5px] text-n600">OPTIONAL</span>;
  return (
    <div data-screen="S-BIL-004" className="grid gap-[20px] items-start grid-cols-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      <Blueprint as="section" className="py-[22px] px-[24px]">
        <form
          data-testid="details-form"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <p className={cx(KICKER, "text-n600")}>Appears on your invoices</p>
          <h2 className="mt-[8px] mb-0 text-[22px] font-semibold leading-[1.15]">Your billing details</h2>
          <div className="mt-[20px] flex flex-col gap-[14px]">
            <div>
              <label htmlFor={ids.name} className={LABEL}>
                Legal entity
              </label>
              <input id={ids.name} className={INPUT} type="text" required maxLength={200} value={form.legalName} onChange={set("legalName")} />
            </div>
            <fieldset className="m-0 p-0 border-0 border-t border-n200 pt-[15px]">
              <legend className="float-left w-full m-0 mb-[10px] p-0 font-mono text-[9.5px] tracking-[0.11em] uppercase text-n600">Registered address</legend>
              <div className="clear-both flex flex-col gap-[10px]">
                <div>
                  <label htmlFor={ids.a1} className={LABEL}>
                    Address line 1
                  </label>
                  <input id={ids.a1} className={INPUT} type="text" required maxLength={200} placeholder="Street and number" value={form.line1} onChange={set("line1")} />
                </div>
                <div>
                  <label htmlFor={ids.a2} className={LABEL}>
                    Address line 2 {optional}
                  </label>
                  <input id={ids.a2} className={INPUT} type="text" maxLength={200} placeholder="Floor, unit, care of" value={form.line2} onChange={set("line2")} />
                </div>
                <div className="grid grid-cols-[132px_minmax(0,1fr)] gap-[10px]">
                  <div>
                    <label htmlFor={ids.zip} className={LABEL}>
                      Zip code
                    </label>
                    <input id={ids.zip} className={INPUT} type="text" required maxLength={20} value={form.postalCode} onChange={set("postalCode")} />
                  </div>
                  <div>
                    <label htmlFor={ids.city} className={LABEL}>
                      City
                    </label>
                    <input id={ids.city} className={INPUT} type="text" required maxLength={100} value={form.city} onChange={set("city")} />
                  </div>
                </div>
                <div>
                  <label htmlFor={ids.country} className={LABEL}>
                    Country
                  </label>
                  <select id={ids.country} className={SELECT} required value={form.country} onChange={set("country")} aria-describedby={`${ids.country}-help`}>
                    <option value="">Choose a country</option>
                    <optgroup label="European Union">
                      {[...EU_COUNTRIES].sort((a, b) => countryName(a).localeCompare(countryName(b))).map((c) => (
                        <option key={c} value={c}>
                          {countryName(c)}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Elsewhere">
                      {OTHER_COUNTRIES.map((c) => (
                        <option key={c} value={c}>
                          {countryName(c)}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                  <p id={`${ids.country}-help`} className={HELP}>
                    The country decides how VAT is charged, which is set out opposite.
                  </p>
                </div>
              </div>
            </fieldset>
            <div className="border-t border-n200 pt-[15px] grid grid-cols-1 sm:grid-cols-2 gap-[14px]">
              <div>
                <label htmlFor={ids.vat} className={LABEL}>
                  VAT number
                </label>
                <input id={ids.vat} className={INPUT} type="text" maxLength={20} value={form.vat} onChange={set("vat")} aria-describedby={vies ? `${ids.vat}-status` : undefined} />
                {vies ? (
                  <p id={`${ids.vat}-status`} data-testid="vies" className={cx("mt-[5px] mb-0 font-mono text-[10px] tracking-[0.05em]", vies.tone)}>
                    {vies.text}
                  </p>
                ) : null}
              </div>
              <div>
                <label htmlFor={ids.cid} className={LABEL}>
                  Company ID {optional}
                </label>
                <input id={ids.cid} className={INPUT} type="text" maxLength={40} value={form.companyId} onChange={set("companyId")} />
              </div>
            </div>
            <div>
              <label htmlFor={ids.po} className={LABEL}>
                Purchase order reference {optional}
              </label>
              <input id={ids.po} className={INPUT} type="text" maxLength={30} placeholder="Appears on every invoice" value={form.poReference} onChange={set("poReference")} />
            </div>
          </div>
          <div aria-live="polite">
            {said ? (
              <p role={said.ok ? "status" : "alert"} className={cx("mt-[14px] mb-0 text-[12.5px] leading-[1.45]", said.ok ? "text-clear" : "text-blocked")}>
                {said.text}
              </p>
            ) : null}
          </div>
          <Button type="submit" variant="primary" size="md" className="mt-[20px] py-[11px] px-[20px] text-[14px]" disabled={pending} aria-busy={pending}>
            {pending ? "Saving…" : "Save billing details"}
          </Button>
        </form>
      </Blueprint>

      <div className="flex flex-col gap-[18px]">
        <Blueprint as="section" className="py-[20px] px-[22px]">
          <div data-testid="vat-rules">
            <h2 className={cx(KICKER, "text-accent font-normal")}>How VAT is charged</h2>
            <div data-testid="applied" className="mt-[12px] border border-ink bg-panel py-[13px] px-[15px]">
              <p className="m-0 font-mono text-[9.5px] tracking-[0.1em] uppercase text-n600">Applied to this workspace</p>
              <div className="mt-[8px] flex items-baseline justify-between gap-[14px]">
                <p className="m-0 text-[14px] font-semibold">{box.k}</p>
                <p className="m-0 font-mono text-[18px] leading-none">{box.rate}</p>
              </div>
              <p className="mt-[7px] mb-0 text-[12.5px] leading-[1.5] text-n700">{box.v}</p>
            </div>
            <div className="mt-[14px] flex flex-col gap-[9px]">
              {VAT_ROWS.map((r) => (
                <div key={r.k} className="border-b border-n200 pb-[9px]">
                  <div className="flex justify-between gap-[12px] items-baseline">
                    <h3 className="m-0 text-[13px] font-semibold leading-[1.55] tracking-normal">{r.k}</h3>
                    <span className={cx("font-mono text-[11px]", r.tone)}>{r.rate}</span>
                  </div>
                  <p className="mt-[4px] mb-0 text-[12px] leading-[1.45] text-n700">{r.v}</p>
                </div>
              ))}
            </div>
          </div>
        </Blueprint>
        <section className="border border-ink border-l-4 border-l-na bg-paper py-[18px] px-[20px]">
          <h2 className="m-0 text-[13.5px] font-semibold leading-[1.55] tracking-normal">Billing details are not the operator</h2>
          <p className="mt-[6px] mb-0 text-[12.5px] leading-[1.5] text-n700">
            The entity that pays us and the operator named on your label are often the same company and sometimes not.
            Registration obligations follow the operator on the label, never this address, so changing it here changes
            nothing in a report.
          </p>
        </section>
      </div>
    </div>
  );
}
