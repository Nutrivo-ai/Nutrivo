import { describe, expect, it } from "vitest";
import {
  isLastAdmin,
  relativeTime,
  scopeText,
  seatChip,
  seatCount,
  seatLine,
  type Family,
  type Market,
  type MemberRow,
} from "./people";

const NOW = new Date("2026-09-04T09:41:00Z");
const families: Family[] = [{ id: "f1", name: "Adult dog · complete dry · chicken" }, { id: "f2", name: "Puppy" }];
const markets: Market[] = [
  { id: "EU", name: "European Union", parentId: null },
  { id: "EU-DE", name: "Germany", parentId: "EU" },
  { id: "EU-FR", name: "France", parentId: "EU" },
  { id: "EU-SE", name: "Sweden", parentId: "EU" },
];

function member(id: string, role: MemberRow["role"], extra: Partial<MemberRow> = {}): MemberRow {
  return {
    kind: "member",
    id,
    personId: `p-${id}`,
    name: id,
    email: `${id}@example.test`,
    role,
    external: false,
    scope: { familyIds: null, nodeIds: null, endsAt: null },
    since: "2026-05-04T00:00:00Z",
    lastActive: null,
    ...extra,
  };
}

describe("People and roles wording (S-WSS-001)", () => {
  it("[A03.must.3] viewers never use a seat; external editors do", () => {
    const team = [
      member("johanna", "admin"),
      member("marit", "portfolio_manager"),
      member("erik", "editor"),
      member("katrin", "editor", { external: true }),
      member("petra", "viewer"),
      member("anders", "viewer", { external: true }),
    ];
    const count = seatCount(team, 5, NOW);
    expect(count).toEqual({ used: 4, seats: 5, viewers: 2, external: 2 });
    expect(seatLine(count)).toBe("4 OF 5 EDITOR SEATS USED · 2 VIEWERS, FREE · 2 EXTERNAL");
    expect(seatChip(count)).toBe("4 OF 5 EDITOR SEATS");
  });

  it("counts no seat for a membership whose end date passed, and says when a plan has no seat limit", () => {
    const team = [member("a", "admin"), member("b", "editor", { scope: { familyIds: null, nodeIds: null, endsAt: "2026-09-01T00:00:00Z" } })];
    const count = seatCount(team, null, NOW);
    expect(count.used).toBe(1);
    expect(seatLine(count)).toBe("1 EDITOR SEAT USED · NO SEAT LIMIT · 0 VIEWERS, FREE · 0 EXTERNAL");
    expect(seatChip(count)).toBe("1 EDITOR SEAT");
  });

  it("writes each scope the way the design does", () => {
    const all = { familyIds: null, nodeIds: null, endsAt: null };
    expect(scopeText("admin", false, all, families, markets, NOW)).toBe("The whole workspace");
    expect(scopeText("portfolio_manager", false, all, families, markets, NOW)).toBe("Every recipe and market");
    expect(scopeText("viewer", false, all, families, markets, NOW)).toBe("Reads answers and reports");
    expect(scopeText("editor", false, { familyIds: ["f1"], nodeIds: null, endsAt: null }, families, markets, NOW)).toBe(
      "Adult dog · complete dry · chicken",
    );
    expect(
      scopeText("editor", true, { familyIds: ["f1", "f2"], nodeIds: ["EU"], endsAt: "2026-12-31T00:00:00Z" }, families, markets, NOW),
    ).toBe("2 recipes · EU markets only · until 31 Dec 2026");
    expect(scopeText("viewer", true, all, families, markets, NOW)).toBe("Reads answers and reports · no end date");
    expect(scopeText("editor", false, { familyIds: null, nodeIds: ["EU-DE", "EU-FR"], endsAt: null }, families, markets, NOW)).toBe(
      "EU · DE, EU · FR",
    );
    expect(
      scopeText("editor", false, { familyIds: null, nodeIds: ["EU-DE", "EU-FR", "EU-SE"], endsAt: null }, families, markets, NOW),
    ).toBe("3 markets");
    expect(scopeText("editor", false, { familyIds: null, nodeIds: null, endsAt: "2026-09-01T00:00:00Z" }, families, markets, NOW)).toBe(
      "Every recipe and market · access ended 1 Sep 2026",
    );
  });

  it("reads last activity as the design's relative times", () => {
    const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
    expect(relativeTime(null, NOW)).toBe("Not yet");
    expect(relativeTime(ago(30_000), NOW)).toBe("Just now");
    expect(relativeTime(ago(12 * 60_000), NOW)).toBe("12 min ago");
    expect(relativeTime(ago(5 * 3_600_000), NOW)).toBe("5 hours ago");
    expect(relativeTime(ago(26 * 3_600_000), NOW)).toBe("Yesterday");
    expect(relativeTime(ago(3 * 86_400_000), NOW)).toBe("3 days ago");
    expect(relativeTime(ago(15 * 86_400_000), NOW)).toBe("2 weeks ago");
    expect(relativeTime("2026-05-04T08:00:00Z", NOW)).toBe("4 May 2026");
  });

  it("[A05.must.1] knows the last admin, who can never be removed or demoted", () => {
    const solo = [member("a", "admin"), member("b", "editor")];
    expect(isLastAdmin(solo[0], solo, NOW)).toBe(true);
    expect(isLastAdmin(solo[1], solo, NOW)).toBe(false);
    const pair = [member("a", "admin"), member("c", "admin")];
    expect(isLastAdmin(pair[0], pair, NOW)).toBe(false);
    // An admin with an end date does not count as the other admin, as in app.change_member.
    const ending = [member("a", "admin"), member("c", "admin", { scope: { familyIds: null, nodeIds: null, endsAt: "2027-01-01T00:00:00Z" } })];
    expect(isLastAdmin(ending[0], ending, NOW)).toBe(true);
  });
});
