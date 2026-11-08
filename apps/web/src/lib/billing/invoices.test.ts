import { describe, expect, it } from "vitest";
import { FakeStripe } from "../../../tests/fake-stripe/core";
import { invoicesFrom, readInvoice, treatmentNote, vatLabel } from "./invoices";

type Json = Record<string, unknown>;

/** An invoice as the fake Stripe Tax issues it for a customer in `country`, with or without a validated VAT number. */
function invoiceFor(country: string, vat?: string) {
  const fake = new FakeStripe();
  const cust = { id: "cus_x", object: "customer", name: "Bergmann Tiernahrung GmbH", metadata: {}, tax_ids: [] as Json[],
    invoice_settings: {}, address: { line1: "Hafenstraße 12", line2: null, postal_code: "20457", city: "Hamburg", country } };
  if (vat) cust.tax_ids.push({ id: "txi_1", type: "eu_vat", value: vat, verification: { status: "verified" } });
  const price = fake.prices.get("nutrivo_plan_standard_eur_month")!;
  return fake.invoiceFor(cust, price, "in_t703", true);
}

describe("invoices and VAT (T-703)", () => {
  it("[M03.main] a paid invoice is read with its net subtotal, its VAT and the plan it is for", () => {
    const inv = readInvoice(invoiceFor("SE"))!;
    expect(inv.subtotal).toBe(499_00);
    expect(inv.tax).toBe(124_75);
    expect(inv.total).toBe(623_75);
    expect(inv.treatment).toBe("domestic");
    expect(inv.rate).toBe(25);
    expect(vatLabel(inv)).toBe("VAT · Sweden 25%");
    expect(inv.plan).toBe("standard");
    expect(inv.term).toBe("monthly");
    expect(inv.billedTo.lines).toEqual(["Hafenstraße 12", "20457 Hamburg, Sweden"]);
  });

  it("[M03.must.1] a German company with a valid VAT number pays zero VAT and the invoice states the reverse charge", () => {
    const inv = readInvoice(invoiceFor("DE", "DE123456789"))!;
    expect(inv.tax).toBe(0);
    expect(inv.total).toBe(inv.subtotal);
    expect(inv.treatment).toBe("reverse_charge");
    expect(inv.billedTo.vat).toBe("DE123456789");
    expect(vatLabel(inv)).toBe("VAT · reverse charge 0%");
    expect(treatmentNote(inv.treatment)).toMatch(/reverse charge/i);
  });

  it("[M03.main] an EU company without a VAT number pays its own rate (one-stop shop); outside the EU nothing", () => {
    expect(readInvoice(invoiceFor("DE"))!.treatment).toBe("oss");
    expect(readInvoice(invoiceFor("DE"))!.tax).toBeGreaterThan(0);
    const us = readInvoice(invoiceFor("US"))!;
    expect(us.treatment).toBe("outside_eu");
    expect(us.tax).toBe(0);
  });

  it("[M03.main] older API versions' total_tax_amounts are read the same way", () => {
    const inv = invoiceFor("DE", "DE123456789") as Json;
    const { total_taxes, ...rest } = inv;
    const older = { ...rest, total_tax_amounts: (total_taxes as Json[]).map((t) => ({ amount: t.amount, taxable_amount: t.taxable_amount, taxability_reason: t.taxability_reason })) };
    expect(readInvoice(older)!.treatment).toBe("reverse_charge");
  });

  it("[M03.main] the list has one row per invoice, newest first, and a later payment clears a failure", () => {
    const a = { ...invoiceFor("SE"), id: "in_a", created: 100 } as Json;
    const b = { ...invoiceFor("SE"), id: "in_b", created: 200, status: "open" } as Json;
    const ev = (id: string, type: string, object: Json, created: number) => ({ stripe_event_id: id, type, payload: { id, created, data: { object } }, received_at: new Date(created * 1000).toISOString() });
    const list = invoicesFrom([
      ev("evt_1", "invoice.paid", a, 101),
      ev("evt_2", "invoice.payment_failed", b, 201),
      ev("evt_3", "customer.subscription.updated", { object: "subscription", id: "sub_1" }, 202),
    ]);
    expect(list.map((i) => i.id)).toEqual(["in_b", "in_a"]);
    expect(list[0].failed).toBe(true);
    const later = invoicesFrom([ev("evt_2", "invoice.payment_failed", b, 201), ev("evt_4", "invoice.paid", { ...b, status: "paid" }, 300)]);
    expect(later[0].failed).toBe(false);
    expect(later[0].status).toBe("paid");
  });
});
