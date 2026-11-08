// M03 (T-703): invoices as Stripe issued them, read from app.payment_events (admin-only RLS), where the
// stripe-webhook function stores every `invoice.paid` and `invoice.payment_failed` event whole (T-702). Pure: it maps
// a Stripe invoice object onto what S-BIL-002 and S-PLN-003 show. Stripe Tax decides the VAT (D-18, BE-35), and this
// only reports what was charged: net amounts, the VAT lines, and the reverse charge where Stripe applied it.
// It reads both shapes of the invoice's taxes: `total_tax_amounts` (older API versions) and `total_taxes` (newer).

export type Treatment =
  | "domestic" // Swedish VAT in full (the seller is Swedish)
  | "reverse_charge" // EU business with a validated VAT number: 0%, the invoice states the reverse charge
  | "oss" // EU customer without a VAT number: their country's rate, one-stop shop
  | "outside_eu" // no VAT charged
  | "none"; // nothing charged and no reason given (a €0 invoice)

export type InvoiceLine = { description: string; quantity: number | null; amount: number; periodStart: string | null; periodEnd: string | null };

export type Invoice = {
  id: string;
  number: string | null;
  status: string;
  /** invoice.payment_failed arrived for this invoice and it is not paid since. */
  failed: boolean;
  issuedAt: string;
  periodStart: string | null;
  periodEnd: string | null;
  currency: string;
  /** Net of VAT, in minor units. */
  subtotal: number;
  tax: number;
  total: number;
  amountPaid: number;
  amountDue: number;
  treatment: Treatment;
  /** The VAT rate charged, in percent (one decimal), when VAT was charged. */
  rate: number | null;
  /** The customer's billing country (ISO 3166-1 alpha-2), as on the invoice. */
  country: string | null;
  billedTo: { name: string | null; lines: string[]; vat: string | null };
  lines: InvoiceLine[];
  plan: string | null;
  term: "monthly" | "annual" | null;
  pdfUrl: string | null;
  hostedUrl: string | null;
};

/** The seller's country: Sunny Ventures AB is registered in Sweden (docs/14). */
export const SELLER_COUNTRY = "SE";

/** EU member states (ISO codes), for telling the one-stop shop from outside the EU. Greece is GR in Stripe. */
const EU = new Set("AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE".split(" "));
export const inEu = (country: string | null | undefined) => !!country && EU.has(country.toUpperCase());

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" ? (v as Raw) : {});
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? v.map(obj) : []);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const iso = (secs: unknown) => (typeof secs === "number" ? new Date(secs * 1000).toISOString() : null);

type Tax = { amount: number; taxable: number; reason: string | null };

function taxes(inv: Raw): Tax[] {
  const older = arr(inv.total_tax_amounts).map((t) => ({ amount: num(t.amount), taxable: num(t.taxable_amount), reason: str(t.taxability_reason) }));
  const newer = arr(inv.total_taxes).map((t) => ({ amount: num(t.amount), taxable: num(t.taxable_amount), reason: str(t.taxability_reason) }));
  return newer.length ? newer : older;
}

/** How VAT was treated on this invoice, from what Stripe Tax recorded. */
export function treatmentOf(inv: Raw): { treatment: Treatment; rate: number | null } {
  const ts = taxes(inv);
  const tax = ts.reduce((s, t) => s + t.amount, 0);
  const taxable = ts.reduce((s, t) => s + t.taxable, 0);
  const country = str(obj(inv.customer_address).country)?.toUpperCase() ?? null;
  if (inv.customer_tax_exempt === "reverse" || ts.some((t) => t.reason === "reverse_charge")) {
    return { treatment: "reverse_charge", rate: 0 };
  }
  if (tax > 0) {
    const rate = taxable > 0 ? Math.round((tax / taxable) * 1000) / 10 : null;
    return { treatment: country === SELLER_COUNTRY ? "domestic" : inEu(country) ? "oss" : "outside_eu", rate };
  }
  if (country && !inEu(country)) return { treatment: "outside_eu", rate: 0 };
  return { treatment: "none", rate: null };
}

/** nutrivo_plan_<plan>_<currency>_<interval> (docs/08 catalogue): the plan and term the invoice's plan line is for. */
function planOf(lines: Raw[]): { plan: string | null; term: "monthly" | "annual" | null } {
  for (const l of lines) {
    const price = obj(l.price);
    const details = obj(obj(l.pricing).price_details);
    const key = str(price.lookup_key) ?? str(obj(details.price).lookup_key);
    const m = key ? /^nutrivo_plan_([a-z]+)_[a-z]{3}_(month|year)$/.exec(key) : null;
    if (m) return { plan: m[1], term: m[2] === "year" ? "annual" : "monthly" };
    const meta = obj(price.metadata);
    if (meta.nutrivo_kind === "plan" && typeof meta.nutrivo_plan === "string") {
      return { plan: meta.nutrivo_plan, term: meta.nutrivo_interval === "year" ? "annual" : "monthly" };
    }
  }
  return { plan: null, term: null };
}

/** A Stripe invoice object (the `data.object` of an invoice event) as the screens show it. */
export function readInvoice(raw: unknown, failed = false): Invoice | null {
  const inv = obj(raw);
  if (inv.object !== "invoice" || typeof inv.id !== "string") return null;
  const lines = arr(obj(inv.lines).data);
  const addr = obj(inv.customer_address);
  const { treatment, rate } = treatmentOf(inv);
  const tax = taxes(inv).reduce((s, t) => s + t.amount, 0);
  const subtotal = typeof inv.subtotal_excluding_tax === "number" ? inv.subtotal_excluding_tax : num(inv.subtotal);
  const cityLine = [str(addr.postal_code), str(addr.city)].filter(Boolean).join(" ");
  const country = str(addr.country)?.toUpperCase() ?? null;
  const vatIds = arr(inv.customer_tax_ids).map((t) => str(t.value)).filter((v): v is string => !!v);
  return {
    id: inv.id,
    number: str(inv.number),
    status: str(inv.status) ?? "open",
    failed: failed && inv.status !== "paid",
    issuedAt: iso(inv.created) ?? new Date(0).toISOString(),
    periodStart: iso(obj(lines[0]?.period).start) ?? iso(inv.period_start),
    periodEnd: iso(obj(lines[0]?.period).end) ?? iso(inv.period_end),
    currency: str(inv.currency) ?? "eur",
    subtotal,
    tax,
    total: num(inv.total),
    amountPaid: num(inv.amount_paid),
    amountDue: num(inv.amount_due),
    treatment,
    rate,
    country,
    billedTo: {
      name: str(inv.customer_name),
      lines: [str(addr.line1), str(addr.line2), [cityLine, country ? countryName(country) : null].filter(Boolean).join(", ")].filter(
        (l): l is string => !!l,
      ),
      vat: vatIds[0] ?? null,
    },
    lines: lines.map((l) => ({
      description: str(l.description) ?? "",
      quantity: typeof l.quantity === "number" ? l.quantity : null,
      amount: num(l.amount),
      periodStart: iso(obj(l.period).start),
      periodEnd: iso(obj(l.period).end),
    })),
    ...planOf(lines),
    pdfUrl: str(inv.invoice_pdf),
    hostedUrl: str(inv.hosted_invoice_url),
  };
}

export type PaymentEventRow = { stripe_event_id: string; type: string; payload: unknown; received_at: string };

/**
 * The workspace's invoices, newest first, one per Stripe invoice: the latest stored event of each wins, and an
 * `invoice.payment_failed` marks the invoice failed until an `invoice.paid` for it arrives.
 */
export function invoicesFrom(rows: PaymentEventRow[]): Invoice[] {
  const sorted = [...rows].filter((r) => r.type === "invoice.paid" || r.type === "invoice.payment_failed").sort((a, b) => {
    const ta = num(obj(a.payload).created) || Date.parse(a.received_at) / 1000;
    const tb = num(obj(b.payload).created) || Date.parse(b.received_at) / 1000;
    return ta - tb;
  });
  const byId = new Map<string, { raw: unknown; failed: boolean }>();
  for (const r of sorted) {
    const o = obj(obj(obj(r.payload).data).object);
    if (typeof o.id !== "string") continue;
    const prev = byId.get(o.id);
    byId.set(o.id, { raw: o, failed: r.type === "invoice.payment_failed" ? true : r.type === "invoice.paid" ? false : (prev?.failed ?? false) });
  }
  return [...byId.values()]
    .map(({ raw, failed }) => readInvoice(raw, failed))
    .filter((i): i is Invoice => !!i)
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
}

const NAMES = new Intl.DisplayNames(["en-GB"], { type: "region" });
export const countryName = (code: string) => {
  try {
    return NAMES.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
};

/** "VAT · Sweden 25%", "VAT · reverse charge": the VAT line as the design labels it. */
export function vatLabel(inv: Pick<Invoice, "treatment" | "rate" | "country">): string {
  if (inv.treatment === "reverse_charge") return "VAT · reverse charge 0%";
  if (inv.treatment === "outside_eu") return "VAT · outside the EU 0%";
  if (inv.treatment === "none") return "VAT";
  const where = inv.country ? countryName(inv.country) : "";
  const rate = inv.rate === null ? "" : ` ${Number.isInteger(inv.rate) ? inv.rate : inv.rate.toFixed(1)}%`;
  return `VAT · ${where}${rate}`.trim();
}

/** The statement the invoice carries for its VAT treatment (design: Billing details, "How VAT is charged"). */
export function treatmentNote(t: Treatment): string | null {
  switch (t) {
    case "reverse_charge":
      return "Reverse charge. No VAT charged: the invoice states the reverse charge and your VAT number, validated against VIES.";
    case "domestic":
      return "Swedish VAT is charged in full. Sunny Ventures AB is registered in Sweden.";
    case "oss":
      return "VAT at your own country's rate, under the one-stop shop.";
    case "outside_eu":
      return "No VAT charged. Any local tax on the import of services is yours to account for.";
    default:
      return null;
  }
}
