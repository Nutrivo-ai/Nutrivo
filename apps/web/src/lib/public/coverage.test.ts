import { describe, expect, it } from "vitest";
import { depthOf, nodeName, shapeCoverage, type SnapshotRow } from "./coverage";

const row = (node_id: string, domain: string, state: SnapshotRow["state"], rules = 0, last: string | null = null): SnapshotRow => ({
  node_id, domain, state, rules_encoded: rules, method: "machine_extraction_person_accepted", last_checked_at: last,
  gap_id: state === "complete" ? null : `GAP-${node_id}-${domain.toUpperCase()}`,
});

describe("public coverage, computed only from public.coverage_snapshot()", () => {
  it("[P01.must.1] every figure comes from the snapshot: depth, rules, dates and gaps per node, counts per region", () => {
    const coverage = shapeCoverage({
      ruleset_version: "2026.11-a",
      nodes: [
        row("EU-DE", "composition", "complete", 40, "2026-08-14"),
        row("EU-DE", "mandatory_particulars", "complete", 12, "2026-08-02"),
        row("EU-FR", "composition", "complete", 30, "2026-08-14"),
        row("EU-FR", "mandatory_particulars", "not_encoded"),
        row("US-TX", "registration", "not_encoded"),
      ],
    });
    expect(coverage.rulesetVersion).toBe("2026.11-a");
    expect(coverage.regions.map((r) => r.id)).toEqual(["EU", "US"]);
    const [eu, us] = coverage.regions;
    expect(eu.nodes.map((n) => [n.id, n.name, n.depth, n.rules, n.lastChecked, n.domainsEncoded, n.gaps])).toEqual([
      ["EU-DE", "Germany", "complete", 52, "2026-08-02", 2, []],
      ["EU-FR", "France", "partial", 30, "2026-08-14", 1, ["GAP-EU-FR-MANDATORY_PARTICULARS"]],
    ]);
    expect(eu.nodes[0].domains.map((d) => d.domain)).toEqual(["mandatory_particulars", "composition"]);
    expect([eu.complete, eu.partial, eu.notEncoded]).toEqual([1, 1, 0]);
    expect(eu.domains).toEqual([
      { domain: "mandatory_particulars", state: "partial" },
      { domain: "composition", state: "complete" },
    ]);
    expect(us.nodes[0]).toMatchObject({ name: "US-TX", depth: "not_encoded", rules: 0, lastChecked: null });
    expect([us.complete, us.partial, us.notEncoded]).toEqual([0, 0, 1]);
  });

  it("[P01.must.1] an empty snapshot yields no regions and no figures", () => {
    expect(shapeCoverage({ ruleset_version: null, nodes: [] })).toEqual({ rulesetVersion: null, regions: [] });
  });

  it("depth is complete only when every part is, and not encoded only when no part is encoded", () => {
    expect(depthOf(["complete", "complete"])).toBe("complete");
    expect(depthOf(["complete", "not_encoded"])).toBe("partial");
    expect(depthOf(["partial"])).toBe("partial");
    expect(depthOf(["not_encoded", "not_encoded"])).toBe("not_encoded");
  });

  it("names EU member states by ISO 3166 and leaves every other node as its id", () => {
    expect(nodeName("EU-SE")).toBe("Sweden");
    expect(nodeName("EU-GR")).toBe("Greece");
    expect(nodeName("UK-NI")).toBe("UK-NI");
    expect(nodeName("US-FED")).toBe("US-FED");
    expect(nodeName("EU")).toBe("EU");
  });
});
