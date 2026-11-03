import { describe, expect, it } from "vitest";
import { DOMAINS, shapeCoverage, type SnapshotRow } from "@/lib/public/coverage";
import { coverageRow, headline, methodLabel, nodeAt, nodeHref, publicHref, type GapRow } from "./model";

const row = (node_id: string, domain: string, state: SnapshotRow["state"], rules = 0): SnapshotRow => ({
  node_id, domain, state, rules_encoded: rules, method: "machine_extraction_person_accepted", last_checked_at: "2026-08-14",
  gap_id: state === "complete" ? null : `GAP-${node_id}-${domain.toUpperCase()}`,
});

const rows = [
  row("EU-DE", "mandatory_particulars", "complete", 12),
  row("EU-DE", "composition", "complete", 40),
  row("EU-DE", "claims_wording", "not_encoded"),
  row("EU-PL", "composition", "partial", 3),
];

describe("coverage in the app, shaped as the public page shapes it (BE-10)", () => {
  it("[D09.must.1] a node in the app is the public page's node: same domains, counts, depth and gaps", () => {
    const publicNode = shapeCoverage({ ruleset_version: "2026.11-a", nodes: rows }).regions[0].nodes.find((n) => n.id === "EU-DE");
    expect(nodeAt("EU-DE", "2026.11-a", rows)).toEqual(publicNode);
  });

  it("a node with no rows is not encoded in all six domains, never complete", () => {
    const node = nodeAt("EU-SE", "2026.11-a", rows);
    expect(node.depth).toBe("not_encoded");
    expect(node.domains.map((d) => d.domain)).toEqual([...DOMAINS]);
    expect(node.domains.every((d) => d.state === "not_encoded")).toBe(true);
  });

  it("names each gap with its description and the ruleset it was opened in", () => {
    const gaps = new Map<string, GapRow>([
      ["GAP-EU-DE-CLAIMS_WORDING", { gap_id: "GAP-EU-DE-CLAIMS_WORDING", node_id: "EU-DE", domain: "claims_wording", reason_code: "not_encoded", description: "Claims not encoded.", opened_in: "0000.00-empty", closed_in: null }],
    ]);
    const r = coverageRow({ nodeId: "EU-DE", name: "Germany", rulesetVersion: "2026.11-a", pinned: true, rows, gaps });
    expect(r.gaps).toEqual([{ id: "GAP-EU-DE-CLAIMS_WORDING", domain: "claims_wording", description: "Claims not encoded.", openedIn: "0000.00-empty" }]);
    expect(r.node.rules).toBe(52);
  });

  it("words the headline as the design does", () => {
    const de = nodeAt("EU-DE", "x", rows);
    expect(headline("Germany", de, 1)).toBe("Germany: two domains encoded, one named as a gap.");
    expect(headline("Sweden", nodeAt("EU-SE", "x", []), 0)).toBe("Sweden: no domains encoded, no gaps named.");
    const all = nodeAt("EU-AT", "x", DOMAINS.map((d) => row("EU-AT", d, "complete", 1)));
    expect(headline("Austria", all, 0)).toBe("Austria: all six domains encoded, no gaps named.");
  });

  it("labels methods and builds the links", () => {
    expect(methodLabel("machine_extraction_person_accepted", "complete")).toBe("PERSON-ACCEPTED");
    expect(methodLabel("double_extracted", "complete")).toBe("DOUBLE EXTRACTED");
    expect(methodLabel("machine_extraction_person_accepted", "not_encoded")).toBe("NOT ENCODED");
    expect(publicHref("EU-PL")).toBe("/coverage?region=EU&node=EU-PL#node");
    expect(nodeHref("w", "EU-PL")).toBe("/w/w/library/coverage/EU-PL");
    expect(nodeHref("w", "EU-PL", "2026.08-b")).toBe("/w/w/library/coverage/EU-PL?ruleset=2026.08-b");
  });
});
