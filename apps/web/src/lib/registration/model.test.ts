// T-504: the registration screens' pure rules. Obligation rows here are plainly fake test data (non-negotiable 7).
import { describe, expect, it } from "vitest";
import {
  NOT_HELD,
  RECORD_REFUSAL,
  REGISTRATION_STATES,
  checklist,
  displayBadge,
  eligibleObligations,
  obligationFields,
  readRecordInput,
  recordRefusal,
  registrationWords,
  type ObligationRow,
} from "./model";

const FAKE: ObligationRow = {
  id: "00000000-0000-4000-8504-000000000001",
  node_id: "EU-DE",
  kind: "registration",
  authority: "SYNTHETIC TEST AUTHORITY",
  legal_basis: null,
  route: "SYNTHETIC ROUTE",
  evidence_list: ["SYNTHETIC ITEM A", "SYNTHETIC ITEM B"],
  fee: null,
  lead_time_days: 30,
  renewal_cycle: null,
  submission_language: null,
  source_url: "https://example.invalid/obligation",
  last_verified_at: "2026-10-01",
};

describe("registration state in words", () => {
  it.each(REGISTRATION_STATES)("[D06.must.1] %s never reads Clear", (state) => {
    expect(registrationWords(state)).not.toMatch(/clear/i);
  });

  it("[D06.must.1] unknown, or a value the vocabulary does not know, reads Unknown and never Clear", () => {
    expect(registrationWords("unknown")).toBe("Unknown");
    expect(registrationWords(null)).toBe("Unknown");
    expect(registrationWords("clear")).toBe("Unknown");
    expect(registrationWords("registered")).toBe("Registered");
    expect(registrationWords("not_registered")).toBe("Not registered");
    expect(registrationWords("expired")).toBe("Expired");
  });

  it("[D06.must.1] the badge is display_state alone: nothing unknown to it becomes Clear", () => {
    expect(displayBadge("blocked")).toBe("blocked");
    expect(displayBadge("not_assessed")).toBe("not_assessed");
    expect(displayBadge(null)).toBe("not_assessed");
    expect(displayBadge("registered")).toBe("not_assessed");
    expect(displayBadge("clear")).toBe("clear");
  });
});

describe("obligations", () => {
  it("[G01.main] every BE-12 field, the source and the last-verified date are listed; a missing field reads not held", () => {
    const fields = obligationFields(FAKE);
    expect(fields.map((f) => f.key)).toEqual([
      "authority",
      "legal_basis",
      "route",
      "evidence_list",
      "fee",
      "lead_time_days",
      "renewal_cycle",
      "submission_language",
      "source_url",
      "last_verified_at",
    ]);
    const by = Object.fromEntries(fields.map((f) => [f.key, f]));
    expect(by.authority.value).toBe("SYNTHETIC TEST AUTHORITY");
    expect(by.evidence_list.value).toBe("SYNTHETIC ITEM A; SYNTHETIC ITEM B");
    expect(by.lead_time_days.value).toBe("30 days");
    for (const k of ["legal_basis", "fee", "renewal_cycle", "submission_language"]) {
      expect(by[k]).toMatchObject({ value: NOT_HELD, held: false });
    }
    const empty = obligationFields({ ...FAKE, authority: "  ", evidence_list: [], source_url: null, last_verified_at: null, lead_time_days: null });
    for (const f of empty.filter((f) => ["authority", "evidence_list", "source_url", "last_verified_at", "lead_time_days"].includes(f.key))) {
      expect(f.value).toBe(NOT_HELD);
    }
    expect(empty.every((f) => f.value !== "")).toBe(true);
  });

  it("[G01.must.1] a sourced, dated registration obligation is not eligible while nothing can say it was accepted (#54 Q4)", () => {
    expect(eligibleObligations([FAKE])).toEqual([]);
    expect(eligibleObligations([{ ...FAKE, source_url: null }, { ...FAKE, last_verified_at: null }, { ...FAKE, kind: "notification" }])).toEqual([]);
  });

  it("[G02.main] with no eligible obligation the checklist is not assessed", () => {
    expect(checklist(null)).toEqual({ kind: "not_assessed" });
    expect(checklist({ ...FAKE, evidence_list: null })).toEqual({ kind: "not_assessed" });
    expect(checklist(FAKE)).toEqual({ kind: "listed", items: ["SYNTHETIC ITEM A", "SYNTHETIC ITEM B"] });
  });
});

describe("recording a registration", () => {
  it("[G03.main] the RPC's error codes map to clear refusals; anything else is an error", () => {
    expect(recordRefusal("42501")).toBe("no-permission");
    expect(recordRefusal("P0002")).toBe("no-market");
    expect(recordRefusal("22023")).toBe("invalid");
    expect(recordRefusal("XX000")).toBe("error");
    expect(recordRefusal(undefined)).toBe("error");
    for (const message of Object.values(RECORD_REFUSAL)) expect(message.length).toBeGreaterThan(20);
    expect(RECORD_REFUSAL["no-permission"]).toMatch(/editor/);
  });

  it("[G03.main] the form's values are checked before the RPC sees them", () => {
    const ok = { number: " REG-1 ", registeredOn: "2026-10-01", expiresAt: "", evidenceDoc: "" };
    expect(readRecordInput(ok)).toEqual({ number: "REG-1", registeredOn: "2026-10-01", expiresAt: null, evidenceDoc: null });
    expect(readRecordInput({ ...ok, number: "  " })).toBeNull();
    expect(readRecordInput({ ...ok, registeredOn: "" })).toBeNull();
    expect(readRecordInput({ ...ok, expiresAt: "2026-09-30" })).toBeNull();
    expect(readRecordInput({ ...ok, expiresAt: "2027-10-01" })?.expiresAt).toBe("2027-10-01");
    expect(readRecordInput({ ...ok, evidenceDoc: "not-a-uuid" })).toBeNull();
  });
});
