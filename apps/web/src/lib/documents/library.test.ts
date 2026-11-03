import { describe, expect, it } from "vitest";
import { buildLibrary, expiryOf, fileName, formatDay, typeLabel, type DocumentRow } from "./library";

const TODAY = "2026-11-03";

function doc(over: Partial<DocumentRow> & { id: string }): DocumentRow {
  return {
    docType: "specification",
    storagePath: `ws/documents/${over.id}.pdf`,
    validTo: null,
    scanStatus: "clean",
    supplierName: null,
    createdAt: "2026-05-01T10:00:00Z",
    ...over,
  };
}

describe("document library (H01)", () => {
  it("[H01.main] states expiry against today: expired, expiring within 60 days, current, none", () => {
    expect(expiryOf("2026-06-03", TODAY)).toEqual({ kind: "expired", on: "2026-06-03" });
    expect(expiryOf("2026-11-02", TODAY).kind).toBe("expired");
    expect(expiryOf("2026-11-03", TODAY)).toEqual({ kind: "expiring", on: "2026-11-03", days: 0 });
    expect(expiryOf("2027-01-02", TODAY)).toEqual({ kind: "expiring", on: "2027-01-02", days: 60 });
    expect(expiryOf("2027-01-03", TODAY)).toEqual({ kind: "current", on: "2027-01-03" });
    expect(expiryOf(null, TODAY)).toEqual({ kind: "no_expiry" });
  });

  it("[H01.main] a market with no encoded requirements is not encoded, never complete", () => {
    const lib = buildLibrary({
      today: TODAY,
      markets: [{ nodeId: "EU-DE", name: "Germany" }],
      requirements: [],
      documents: [doc({ id: "a" })],
    });
    expect(lib.markets).toEqual([{ nodeId: "EU-DE", name: "Germany", kind: "not_encoded" }]);
  });

  it("[H01.main] requirements are met only by a clean, unexpired document of the same type", () => {
    const lib = buildLibrary({
      today: TODAY,
      markets: [{ nodeId: "EU-BE", name: "Belgium" }],
      requirements: [
        { nodeId: "EU-BE", productClass: "pet_food", docType: "specification" },
        { nodeId: "EU-BE", productClass: "pet_food", docType: "certificate_of_analysis" },
        { nodeId: "EU-BE", productClass: "pet_food", docType: "test_protocol" },
        { nodeId: "EU-BE", productClass: "pet_food", docType: "establishment_registration" },
        { nodeId: "EU-BE", productClass: "dietetic", docType: "dietetic_evidence" },
        { nodeId: "EU-DE", productClass: "pet_food", docType: "specification" },
      ],
      documents: [
        doc({ id: "spec", docType: "specification", validTo: "2027-06-01" }),
        doc({ id: "coa", docType: "certificate_of_analysis", validTo: "2026-06-01" }), // expired
        doc({ id: "qa", docType: "test_protocol", scanStatus: "quarantine" }), // not yet clean
        doc({ id: "reg", docType: "establishment_registration", scanStatus: "rejected" }),
      ],
    });
    expect(lib.markets).toEqual([
      {
        nodeId: "EU-BE",
        name: "Belgium",
        kind: "assessed",
        met: 1,
        total: 4,
        outstanding: ["Certificate of analysis", "Test protocol", "Establishment registration"],
        notAssessed: 1,
      },
    ]);
  });

  it("[H01.main] lists every document, expired first, then expiring, current and undated, each by date", () => {
    const lib = buildLibrary({
      today: TODAY,
      markets: [],
      requirements: [],
      documents: [
        doc({ id: "none", validTo: null }),
        doc({ id: "cur", validTo: "2027-03-31", supplierName: "Aldrich Nutrition" }),
        doc({ id: "soon", validTo: "2026-11-30" }),
        doc({ id: "old", validTo: "2026-06-03" }),
        doc({ id: "older", validTo: "2026-03-01" }),
      ],
    });
    expect(lib.documents.map((d) => d.id)).toEqual(["older", "old", "soon", "cur", "none"]);
    expect(lib.expiringOrExpired).toBe(3);
    expect(lib.documents.find((d) => d.id === "cur")?.supplier).toBe("Aldrich Nutrition");
  });

  it("names a document by its stored file and type, never by an invented display name", () => {
    expect(fileName("ws/documents/SPEC-0442-premix-PMX-118.pdf")).toBe("SPEC-0442-premix-PMX-118.pdf");
    expect(typeLabel("certificate_of_analysis")).toBe("Certificate of analysis");
    expect(typeLabel("")).toBe("");
  });

  it("writes days as the design does, with the year only when it is not this year's", () => {
    expect(formatDay("2026-06-03", TODAY)).toBe("3 JUN");
    expect(formatDay("2027-03-31", TODAY)).toBe("31 MAR 2027");
  });
});
