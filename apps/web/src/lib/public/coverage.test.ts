import { describe, expect, it } from "vitest";
import { depthOf, DOMAINS, nodeName, shapeCoverage, type SnapshotRow } from "./coverage";

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
      ["EU-DE", "Germany", "partial", 52, "2026-08-02", 2, []],
      ["EU-FR", "France", "partial", 30, "2026-08-14", 1, ["GAP-EU-FR-MANDATORY_PARTICULARS"]],
    ]);
    expect(eu.nodes[0].domains.map((d) => d.domain)).toEqual([...DOMAINS]);
    expect([eu.complete, eu.partial, eu.notEncoded]).toEqual([0, 2, 0]);
    expect(eu.domains.slice(0, 2)).toEqual([
      { domain: "mandatory_particulars", state: "partial" },
      { domain: "composition", state: "complete" },
    ]);
    expect(us.nodes[0]).toMatchObject({ name: "US-TX", depth: "not_encoded", rules: 0, lastChecked: null });
    expect([us.complete, us.partial, us.notEncoded]).toEqual([0, 0, 1]);
  });

  it("[P01.must.1] a node is judged on all six domains: one with no row is not encoded, so the node is never complete", () => {
    const encoded = DOMAINS.slice(0, 5).map((d) => row("EU-SE", d, "complete", 10, "2026-09-01"));
    const node = shapeCoverage({ ruleset_version: "2026.11-a", nodes: encoded }).regions[0].nodes[0];
    expect(node.depth).toBe("partial");
    expect(node.domains).toHaveLength(DOMAINS.length);
    expect(node.domains.find((d) => d.domain === "registration")).toMatchObject({ state: "not_encoded", rules_encoded: 0 });
    expect(node.domainsEncoded).toBe(5);
    const all = DOMAINS.map((d) => row("EU-SE", d, "complete", 10, "2026-09-01"));
    expect(shapeCoverage({ ruleset_version: "2026.11-a", nodes: all }).regions[0].nodes[0].depth).toBe("complete");
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
