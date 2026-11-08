// T-703 · M03: the billing details form, checked before anything is sent to Stripe. Pure, so the form and the
// Server Action say the same thing. Stripe validates the VAT number itself (against VIES for an EU number) and
// Stripe Tax decides the treatment; this only refuses what Stripe would refuse or could not use.

export type DetailsInput = {
  legalName: string;
  line1: string;
  line2: string;
  postalCode: string;
  city: string;
  country: string;
  vat: string;
  companyId: string;
  poReference: string;
};

export type Details = Omit<DetailsInput, "line2" | "vat"> & { line2: string | null; vat: string | null };

export type Problem = "legal_name" | "line1" | "postal_code" | "city" | "country" | "vat" | "vat_country" | "company_id" | "po";

/** What the form says for each problem. */
export const PROBLEM_TEXT: Record<Problem | string, string> = {
  legal_name: "Enter the legal entity, as it should appear on invoices.",
  line1: "Enter the first line of the registered address.",
  postal_code: "Enter the zip or postal code.",
  city: "Enter the city.",
  country: "Choose the country.",
  vat: "This does not look like a VAT number. An EU number starts with its country code, for example DE123456789.",
  vat_country: "A VAT number can be added for an EU country, the United Kingdom, Norway or Switzerland.",
  company_id: "The company ID is too long.",
  po: "A purchase order reference can be up to 30 characters.",
  tax_id_invalid: "Stripe could not accept this VAT number. Check it against the registration certificate.",
  email: "Enter an email address.",
};

/** Countries the form offers: the EU, then the rest of Europe and the US. Names come from Intl, in English. */
export const EU_COUNTRIES = "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE".split(" ");
export const OTHER_COUNTRIES = ["GB", "NO", "CH", "IS", "US"];

/** An EU VAT number's prefix: the country code, except Greece, whose VAT numbers start EL. */
const vatPrefix = (country: string) => (country === "GR" ? "EL" : country);

/** Stripe's tax ID type for a VAT number registered in this country, or null where the form takes none. */
export function taxIdType(country: string): string | null {
  if (EU_COUNTRIES.includes(country)) return "eu_vat";
  if (country === "GB") return "gb_vat";
  if (country === "NO") return "no_vat";
  if (country === "CH") return "ch_vat";
  return null;
}

/** "se 5567-3411 2801" → "SE556734112801". */
export const normaliseVat = (v: string) => v.replace(/[\s.\-]/g, "").toUpperCase();

export function checkDetails(input: DetailsInput): { ok: true; value: Details } | { ok: false; problem: Problem } {
  const t = (v: string | undefined) => (v ?? "").trim();
  const legalName = t(input.legalName);
  const line1 = t(input.line1);
  const line2 = t(input.line2);
  const postalCode = t(input.postalCode);
  const city = t(input.city);
  const country = t(input.country).toUpperCase();
  const vat = normaliseVat(t(input.vat));
  const companyId = t(input.companyId);
  const poReference = t(input.poReference);
  if (!legalName || legalName.length > 200) return { ok: false, problem: "legal_name" };
  if (!line1 || line1.length > 200 || line2.length > 200) return { ok: false, problem: "line1" };
  if (!postalCode || postalCode.length > 20) return { ok: false, problem: "postal_code" };
  if (!city || city.length > 100) return { ok: false, problem: "city" };
  if (!/^[A-Z]{2}$/.test(country) || ![...EU_COUNTRIES, ...OTHER_COUNTRIES].includes(country)) return { ok: false, problem: "country" };
  if (vat) {
    if (!taxIdType(country)) return { ok: false, problem: "vat_country" };
    if (!/^[A-Z0-9]{4,16}$/.test(vat)) return { ok: false, problem: "vat" };
    if (EU_COUNTRIES.includes(country) && !vat.startsWith(vatPrefix(country))) return { ok: false, problem: "vat" };
  }
  if (companyId.length > 40) return { ok: false, problem: "company_id" };
  if (poReference.length > 30) return { ok: false, problem: "po" };
  return {
    ok: true,
    value: { legalName, line1, line2: line2 || null, postalCode, city, country, vat: vat || null, companyId, poReference },
  };
}
