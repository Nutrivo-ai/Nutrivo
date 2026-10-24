import { describe, expect, it } from "vitest";
import { checkAccount, readOperator, regionCards, workspaceNameFromEmail, type JurisdictionRow } from "./rules";

const long = (n: number) => "w".repeat(n);

describe("workspaceNameFromEmail (S-ONB-001)", () => {
  it("names the workspace from the email domain", () => {
    expect(workspaceNameFromEmail("j.holm@haldenpet.com")).toBe("Haldenpet");
    expect(workspaceNameFromEmail("a@north-feed.co.uk")).toBe("North Feed");
  });

  it("uses the person's name for a personal mail provider, never the provider's", () => {
    expect(workspaceNameFromEmail("johanna@gmail.com", "Johanna Holm")).toBe("Johanna Holm's workspace");
    expect(workspaceNameFromEmail("johanna@outlook.com")).toBe("My workspace");
  });
});

describe("checkAccount (S-ONB-001)", () => {
  const ok = { email: "j@haldenpet.com", fullName: "Johanna Holm", password: long(12), workspaceName: "Haldenpet" };

  it("accepts three fields and a workspace name", () => expect(checkAccount(ok)).toBeNull());
  it("refuses an address that is not one", () => expect(checkAccount({ ...ok, email: "j@" })).toBe("email"));
  it("needs a name", () => expect(checkAccount({ ...ok, fullName: "  " })).toBe("name"));
  it("needs twelve characters, and reads no more than 72", () => {
    expect(checkAccount({ ...ok, password: long(11) })).toBe("password_short");
    expect(checkAccount({ ...ok, password: long(73) })).toBe("password_long");
  });
  it("keeps the workspace name within app.workspaces' 1 to 200 characters", () => {
    expect(checkAccount({ ...ok, workspaceName: "" })).toBe("workspace");
    expect(checkAccount({ ...ok, workspaceName: long(201) })).toBe("workspace");
  });
});

describe("readOperator (S-ONB-003, B01)", () => {
  it("reads the operator as printed, the country from the address, the approval number when there is one", () => {
    expect(readOperator({ name: " Halden Pet Nutrition AB ", address: "Industrivägen 4, 412 63 Göteborg, SE", approval: "SE 14 2231 α" })).toEqual({
      ok: true,
      operator: { name: "Halden Pet Nutrition AB", address: "Industrivägen 4, 412 63 Göteborg, SE", country: "SE", approval_number: "SE 14 2231 α" },
    });
    expect(readOperator({ name: "Halden", address: "Hauptstraße 1, 10115 Berlin DE", approval: " " })).toEqual({
      ok: true,
      operator: { name: "Halden", address: "Hauptstraße 1, 10115 Berlin DE", country: "DE" },
    });
  });

  it("asks for the country code when the address does not end with one", () => {
    expect(readOperator({ name: "Halden", address: "Industrivägen 4, Göteborg, Sweden", approval: "" })).toEqual({ ok: false, problem: "country" });
    expect(readOperator({ name: "Halden", address: "Industrivägen 4, Göteborg, se", approval: "" })).toEqual({ ok: false, problem: "country" });
  });

  it("needs a name and an address, and keeps set_default_operator's limits", () => {
    expect(readOperator({ name: "", address: "x, SE", approval: "" })).toEqual({ ok: false, problem: "name" });
    expect(readOperator({ name: "Halden", address: "", approval: "" })).toEqual({ ok: false, problem: "address" });
    expect(readOperator({ name: "Halden", address: "x, SE", approval: long(101) })).toEqual({ ok: false, problem: "approval" });
  });
});

describe("regionCards (S-ONB-002)", () => {
  const rows: JurisdictionRow[] = [
    { id: "EU", parent_id: null, node_type: "region", languages: [] },
    ...["DE", "FR", "NL", "IT", "SE", "FI"].map((c) => ({ id: `EU-${c}`, parent_id: "EU", node_type: "country", languages: [c.toLowerCase()] })),
    { id: "EU-BE", parent_id: "EU", node_type: "country", languages: ["nl", "fr", "de"] },
    { id: "UK", parent_id: null, node_type: "region", languages: ["en"] },
    { id: "UK-GB", parent_id: "UK", node_type: "country", languages: ["en"] },
    { id: "UK-NI", parent_id: "UK", node_type: "country", languages: ["en"] },
    { id: "US", parent_id: null, node_type: "region", languages: ["en"] },
    { id: "US-FED", parent_id: "US", node_type: "federal", languages: ["en"] },
    ...["TX", "CA", "NY"].map((s) => ({ id: `US-${s}`, parent_id: "US", node_type: "state", languages: ["en"] })),
  ];

  it("counts what ref.jurisdictions holds, with the design's featured nodes first", () => {
    expect(regionCards(rows).map(({ id, meta, nodes }) => ({ id, meta, nodes }))).toEqual([
      { id: "EU", meta: "7 MEMBER STATES · 6 LANGUAGES", nodes: ["EU · DE", "EU · FR", "EU · NL", "EU · IT", "+ 3 more"] },
      { id: "UK", meta: "2 NODES · ENGLISH", nodes: ["UK · GB", "UK · NI"] },
      { id: "US", meta: "FEDERAL + 3 STATES", nodes: ["US · Federal", "US · TX", "US · CA", "+ 1 more"] },
    ]);
  });

  it("leaves out a region that is not in the reference data", () => {
    expect(regionCards(rows.filter((r) => !r.id.startsWith("US"))).map((r) => r.id)).toEqual(["EU", "UK"]);
  });
});
