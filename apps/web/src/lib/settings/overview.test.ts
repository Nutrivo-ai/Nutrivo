import { describe, expect, it } from "vitest";
import type { Usage } from "@/lib/billing/read";
import { marketCode, monthStart, pendingInvitations, personLines, planFacts, planLines, workspaceLines } from "./overview";
import type { InvitationRow, MemberRow } from "./people";

const NOW = new Date("2026-09-04T09:41:00Z");

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

describe("Settings & roles overview (S-NV2-017)", () => {
  it("[T-1110] signing authority comes only from grant rows, never from a role (BE-04)", () => {
    const team = [
      member("marit", "admin", { lastActive: "2026-09-04T09:29:00Z" }),
      member("jonas", "portfolio_manager"),
      member("katrin", "editor", { external: true }),
    ];
    const lines = personLines(team, [
      { personId: "p-marit", nodeId: "EU-DE" },
      { personId: "p-marit", nodeId: "EU-AT" },
    ], NOW);
    expect(lines.map((l) => [l.name, l.role, l.signing, l.signingTone, l.last])).toEqual([
      ["marit", "Admin", "DE · AT", "clear", "12 min ago"],
      ["jonas", "Portfolio manager", "None", "none", "Not yet"],
      ["katrin", "Editor · external", "None", "action", "Not yet"],
    ]);
  });

  it("[T-1110] a member whose end date has passed is not listed", () => {
    const team = [member("a", "admin"), member("b", "editor", { scope: { familyIds: null, nodeIds: null, endsAt: "2026-09-01T00:00:00Z" } })];
    expect(personLines(team, [], NOW).map((l) => l.name)).toEqual(["a"]);
  });

  it("[T-1110] workspace rows: ruleset, markets and signing policy only (#352)", () => {
    const rows = workspaceLines("2026.08-b", 27);
    expect(rows.map((r) => [r.k, r.v, r.tone])).toEqual([
      ["Ruleset version", "2026.08-b", "clear"],
      ["Markets enabled", "27 IN REACH", "clear"],
      ["Signing policy", "PER MARKET", "clear"],
    ]);
    expect(rows.map((r) => r.k)).not.toContain("Tenancy model");
    expect(workspaceLines(null, 0).map((r) => [r.v, r.tone])).toEqual([
      ["NONE RELEASED", "none"],
      ["0 IN REACH", "none"],
      ["PER MARKET", "clear"],
    ]);
  });

  it("[T-1110] the plan card shows what D-03 sells and never meters checks", () => {
    const lines = planLines({
      kind: "read",
      plan: "standard",
      recipes: 12,
      recipesIncluded: 30,
      editorSeats: 5,
      editorSeatsUsed: 2,
      regions: ["EU"],
      checksThisMonth: 1412,
    });
    expect(lines).toEqual([
      { k: "Plan", v: "Standard" },
      { k: "Recipes", v: "12 of 30" },
      { k: "Editor seats", v: "2 of 5 · viewers free" },
      { k: "Regions", v: "EU" },
      { k: "Checks this month", v: "1 412 · unmetered" },
    ]);
    const advanced = planLines({
      kind: "read",
      plan: "advanced",
      recipes: 140,
      recipesIncluded: null,
      editorSeats: null,
      editorSeatsUsed: 2,
      regions: ["EU"],
      checksThisMonth: 0,
    });
    expect(advanced[1]).toEqual({ k: "Recipes", v: "140 · no recipe limit" });
    expect(advanced[2]).toEqual({ k: "Editor seats", v: "2 · no seat limit · viewers free" });
  });

  it("[T-1110] the plan's figures agree with Plan and allowance: the mirror only while live, else the free allowance", () => {
    const usage = (subscription: Usage["subscription"], plan: string): Usage => ({
      counts: { recipes: 12, regions: [], editorSeats: 2, labelsUsed: 0, labelsAllowed: 3 },
      subscription,
      plan,
      status: "active",
      checksRun: 99,
    });
    const sub = (status: string, extra: Partial<NonNullable<Usage["subscription"]>> = {}) => ({
      plan: "standard",
      term: "monthly" as const,
      status,
      editorSeats: 7,
      recipesIncluded: 40,
      currentPeriodEnd: null,
      ...extra,
    });
    // Live: the mirror's seats and recipes, add-ons counted.
    expect(planFacts(usage(sub("active"), "standard"), ["EU"], 3)).toMatchObject({ plan: "standard", recipesIncluded: 40, editorSeats: 7 });
    // Live with an empty mirror: the plan's own figures (Standard: 30 recipes, 5 editors).
    expect(planFacts(usage(sub("past_due", { editorSeats: null, recipesIncluded: null }), "standard"), ["EU"], 3)).toMatchObject({
      recipesIncluded: 30,
      editorSeats: 5,
    });
    // Cancelled and back on Free: no recipe or seat check, never the stale mirror (D-21).
    const ended = planFacts(usage(sub("canceled"), "free"), ["EU"], 3);
    expect(ended).toMatchObject({ plan: "free", recipesIncluded: null, editorSeats: null, regions: ["EU"], checksThisMonth: 3 });
    expect(planLines(ended).slice(0, 3)).toEqual([
      { k: "Plan", v: "Free" },
      { k: "Recipes", v: "12 · no recipe limit" },
      { k: "Editor seats", v: "2 · no seat limit · viewers free" },
    ]);
    // Advanced has no recipe limit, whatever the mirror holds; seats used come from the live counts.
    const advanced = planFacts(usage(sub("active", { plan: "advanced", recipesIncluded: 25, editorSeats: null }), "advanced"), ["EU"], 0);
    expect(advanced).toMatchObject({ recipesIncluded: null, editorSeats: null, editorSeatsUsed: 2 });
    // Never subscribed.
    expect(planFacts(usage(null, "free"), ["EU"], 0)).toMatchObject({ plan: "free", recipesIncluded: null, editorSeats: null });
  });

  it("[T-1110] a lapsed invitation is not pending", () => {
    const inv = (id: string, expiresAt: string): InvitationRow => ({
      kind: "invitation",
      id,
      email: `${id}@example.test`,
      role: "editor",
      external: false,
      scope: { familyIds: null, nodeIds: null, endsAt: null },
      sentAt: "2026-08-20T00:00:00Z",
      expiresAt,
    });
    expect(pendingInvitations([inv("old", "2026-08-27T00:00:00Z"), inv("new", "2026-09-10T00:00:00Z")], NOW)).toBe(1);
    expect(pendingInvitations([inv("old", "2026-08-27T00:00:00Z")], NOW)).toBe(0);
  });

  it("[T-1110] market codes and the month boundary", () => {
    expect(["EU-DE", "US-TX", "EU"].map(marketCode)).toEqual(["DE", "TX", "EU"]);
    expect(monthStart(NOW)).toBe("2026-09-01T00:00:00.000Z");
  });
});
