import { describe, expect, it } from "vitest";
import { EXPIRY_CHOICES, DEFAULT_EXPIRY_DAYS, looksLikeEmail, pinFacts, shareLine, shareStatus, shortHash } from "./model";

const NOW = new Date("2026-11-03T12:00:00Z");
const row = (over: Partial<Parameters<typeof shareLine>[0]> = {}) => ({
  id: "s1",
  channel: "link" as const,
  recipient: null,
  expires_at: null,
  revoked_at: null,
  created_at: "2026-11-01T09:00:00Z",
  ...over,
});

describe("share status (I02, BE-27)", () => {
  it("[I02.main] a share without expiry or revoke is live", () => {
    expect(shareStatus(row(), NOW)).toBe("live");
    expect(shareLine(row(), NOW)).toEqual({ who: "Link", when: "NO EXPIRY", status: "live" });
  });
  it("[I02.main] a share past its expiry is expired", () => {
    expect(shareStatus(row({ expires_at: "2026-11-03T11:59:00Z" }), NOW)).toBe("expired");
    expect(shareLine(row({ expires_at: "2026-12-03T12:00:00Z" }), NOW).when).toBe("UNTIL 2026-12-03");
  });
  it("[I02.must.1] revoked wins over expired", () => {
    const r = row({ expires_at: "2026-11-02T00:00:00Z", revoked_at: "2026-11-01T10:00:00Z" });
    expect(shareStatus(r, NOW)).toBe("revoked");
    expect(shareLine(r, NOW).when).toBe("REVOKED 2026-11-01");
  });
  it("an email share is named by its recipient", () => {
    expect(shareLine(row({ channel: "email", recipient: "buyer@retailer.test" }), NOW).who).toBe("buyer@retailer.test");
  });
});

describe("send screen helpers", () => {
  it("defaults to the design's 30 days and offers no expiry (BE-27: optional)", () => {
    expect(DEFAULT_EXPIRY_DAYS).toBe(30);
    expect(EXPIRY_CHOICES.map((c) => c.days)).toEqual([7, 30, 90, null]);
  });
  it("checks an address loosely; the database decides", () => {
    expect(looksLikeEmail(" a@b.test ")).toBe(true);
    expect(looksLikeEmail("not an address")).toBe(false);
    expect(looksLikeEmail("")).toBe(false);
  });
  it("prints the design's eight pinned facts from the report row, attested by nobody", () => {
    const facts = pinFacts({
      id: "r", ref: "NTV7QK42P9MXR31ABCDEFGHIJK", issuedAt: "2026-08-25T14:08:00Z", rulesetVersion: "2026.08",
      artworkSha: "4f1c" + "0".repeat(56) + "9ab2", hasNotAssessed: true, market: "Germany", languages: ["de"], hasPdf: true,
    });
    expect(facts.map((f) => f.k)).toEqual([
      "Reference", "Issued", "Ruleset", "Artwork hash", "Nodes reported", "Languages", "Not assessed", "Attested by",
    ]);
    expect(facts[1].v).toBe("2026-08-25 14:08 UTC");
    expect(facts[3].v).toBe("sha256 4f1c…9ab2");
    expect(facts[5].v).toBe("DE");
    expect(facts[7].v).toBe("Nobody");
    expect(shortHash("abc")).toBe("sha256 abc");
  });
});
