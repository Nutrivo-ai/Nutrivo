import { describe, expect, it } from "vitest";
import {
  countLine,
  cursor,
  filterKey,
  formatWhen,
  kindFilter,
  kindLabel,
  shortName,
  toEvent,
  whatText,
  whoText,
  type AuditRow,
} from "./audit";

const NOW = new Date("2026-09-04T12:00:00Z");

function row(extra: Partial<AuditRow>): AuditRow {
  return {
    id: 1,
    at: "2026-09-04T09:41:00Z",
    kind: "check.completed",
    objectType: null,
    objectId: null,
    before: null,
    after: null,
    rulesetVersion: null,
    actorId: "p1",
    actorName: "Johanna Holm",
    actorIsExternal: false,
    ...extra,
  };
}

describe("audit log wording (S-WSS-005)", () => {
  it("[O02.must.1] the Who column reads the flag stamped on the event, not the person's membership today", () => {
    // The same person: external when the first event was written, internal by the second.
    expect(whoText(row({ actorName: "Karin Reuter", actorIsExternal: true }))).toBe("K. Reuter (external)");
    expect(whoText(row({ actorName: "Karin Reuter", actorIsExternal: false }))).toBe("K. Reuter");
    expect(toEvent(row({ actorIsExternal: true }), new Map(), NOW).external).toBe(true);
    // A person whose name is no longer readable still reads as external.
    expect(whoText(row({ actorName: null, actorIsExternal: true }))).toBe("A former member (external)");
    expect(whoText(row({ actorId: null, actorName: null }))).toBe("System");
  });

  it("formats the time as the design does, in UTC, with the year only when it is not this year", () => {
    expect(formatWhen("2026-09-04T09:41:00Z", NOW)).toBe("4 Sep · 09:41");
    expect(formatWhen("2025-12-31T23:05:00Z", NOW)).toBe("31 Dec 2025 · 23:05");
  });

  it("writes the count line", () => {
    expect(countLine(2418, "2026-05-04T08:00:00Z")).toBe("2,418 EVENTS · SINCE 4 MAY 2026");
    expect(countLine(1, "2026-05-04T08:00:00Z")).toBe("1 EVENT · SINCE 4 MAY 2026");
    expect(countLine(0, null)).toBe("0 EVENTS");
  });

  it("shortens names as the design's Who column does", () => {
    expect(shortName("Johanna Holm")).toBe("J. Holm");
    expect(shortName("Ada")).toBe("Ada");
    expect(shortName("ada@example.test")).toBe("ada@example.test");
  });

  it("labels kinds by family, with the design's colours", () => {
    expect(kindLabel("check.completed")).toEqual({ label: "CHECK", tone: "accent" });
    expect(kindLabel("certificate.issued")).toEqual({ label: "CERTIFICATE", tone: "clear" });
    expect(kindLabel("membership.changed")).toEqual({ label: "ACCESS", tone: "action" });
    expect(kindLabel("product.stage_changed")).toEqual({ label: "RECIPE", tone: "n600" });
    expect(kindLabel("something.new")).toEqual({ label: "SOMETHING", tone: "n600" });
  });

  it("says what happened from the stored row only", () => {
    expect(
      whatText(row({ kind: "check.completed", rulesetVersion: "2026.08-b", after: { check_ids: ["a", "b"], label_states: { "EU-DE": "x", "EU-FR": "y" } } })),
    ).toBe("Label checked against ruleset 2026.08-b for EU · DE, EU · FR · 2 panel checks");
    expect(whatText(row({ kind: "invitation.sent", after: { email: "k@reglar.eu", role: "editor", is_external: true } }))).toBe(
      "k@reglar.eu (external) invited as editor",
    );
    expect(whatText(row({ kind: "membership.created", after: { role: "portfolio_manager", is_external: false } }))).toBe(
      "Accepted an invitation as portfolio manager",
    );
    expect(
      whatText(
        row({
          kind: "membership.changed",
          before: { person_id: "p2", role: "editor", is_external: true, access_ends_at: "2026-12-31T00:00:00Z" },
          after: { person_id: "p2", role: "viewer", is_external: false, access_ends_at: null, signing_grants_revoked: 0 },
        }),
        new Map([["p2", "Karin Reuter"]]),
      ),
    ).toBe("Karin Reuter: role editor → viewer · now internal · no end date");
    expect(whatText(row({ kind: "membership.ended", before: { person_id: "p9" }, after: { ended_reason: "Left" } }))).toBe(
      "A member removed from the workspace · Left",
    );
    expect(whatText(row({ kind: "product.stage_changed", before: { stage: "active" }, after: { stage: "discontinued" } }))).toBe(
      "Recipe moved from active to discontinued",
    );
    expect(whatText(row({ kind: "session.started", after: { aal: "aal2" } }))).toBe("Signed in with two-step verification");
    expect(whatText(row({ kind: "certificate.issued", rulesetVersion: "r1", after: { node: "EU-DE" } }))).toBe(
      "Certificate of Check issued for EU · DE against ruleset r1",
    );
    expect(whatText(row({ kind: "brand.new_kind" }))).toBe("brand.new_kind");
  });

  it("reads the filter and the cursor from the query, refusing anything else", () => {
    expect(filterKey("access")).toBe("access");
    expect(filterKey("nope")).toBe("all");
    expect(filterKey(undefined)).toBe("all");
    expect(cursor("42")).toBe(42);
    expect(cursor("0")).toBeNull();
    expect(cursor("1,2")).toBeNull();
    expect(kindFilter("all")).toBeNull();
    expect(kindFilter("access")).toBe("kind.like.membership.*,kind.like.invitation.*,kind.like.session.*,kind.like.access.*");
  });
});
