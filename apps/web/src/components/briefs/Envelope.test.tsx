// T-1002 · E02 Design envelope (S-NV2-005): the envelope as written, with nothing turned into a verdict here. Every
// withheld item shows its reason and its gap (or that none is recorded), and nutrient adequacy is out of scope.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildEnvelope, type EnvelopeItemRow } from "@/lib/briefs/envelope";
import { Envelope } from "./Envelope";

const WS = "20000000-0000-4000-8102-00000000000a";
let n = 0;
const item = (p: Partial<EnvelopeItemRow>): EnvelopeItemRow => ({
  id: `i${++n}`,
  node_id: "EU-DE",
  language: null,
  kind: "requirement",
  rule_key: null,
  rule_version: null,
  gap_id: null,
  provenance: "deterministic_rule",
  reason_code: null,
  citation: null,
  payload: {},
  ...p,
});

const items: EnvelopeItemRow[] = [
  item({ language: "de", kind: "requirement", rule_key: "T.BATCH", rule_version: 1, citation: "TEST Art. 1", payload: { title: "Batch", wordings: ["Testcharge"] } }),
  item({ node_id: "EU-AT", language: "de", kind: "requirement", rule_key: "T.BATCH", rule_version: 1, citation: "TEST Art. 1", payload: { title: "Batch", wordings: ["Testcharge"] } }),
  item({ kind: "limit", rule_key: "T.MAX", rule_version: 1, citation: "TEST Art. 2", payload: { check: "within_max_content", additive_ref: "T-ZN", ingredient: "Test zinc", amount: 180, unit: "mg/kg", max_content: { value: 150, unit: "mg/kg" }, outcome: "exceeds" } }),
  item({ node_id: "EU-AT", kind: "not_assessed", rule_key: "T.MAX", rule_version: 1, provenance: "not_assessed", reason_code: "data_missing", payload: { check: "within_max_content", additive_ref: "T-ZN", ingredient: "Test zinc" } }),
  item({ node_id: "EU-AT", kind: "not_assessed", gap_id: "GAP-T-AT-COMP", provenance: "not_assessed", reason_code: "not_encoded", payload: { domain: "composition" } }),
];
const nodes = [
  { node_id: "EU-DE", state: "action", open_items: 1, withheld: 0 },
  { node_id: "EU-AT", state: "not_assessed", open_items: 0, withheld: 2 },
  { node_id: "EU-FR", state: "not_assessed", open_items: 0, withheld: 0 },
];

describe("Envelope", () => {
  it("[E02.main] limits per market, the register's wording grouped across markets, and the pinned ruleset", () => {
    const view = buildEnvelope(nodes, items, ["nutrient_adequacy"]);
    expect(view.limits).toEqual([
      {
        key: "T-ZN",
        name: "Test zinc",
        reg: "Additive T-ZN",
        used: "180 mg/kg",
        cells: { "EU-DE": { text: "150 max", state: "action" }, "EU-AT": { text: "N/A", state: "not_assessed" } },
      },
    ]);
    expect(view.wording).toHaveLength(1);
    expect(view.wording[0]).toMatchObject({ language: "de", text: "Testcharge", markets: ["EU-DE", "EU-AT"], citation: "TEST Art. 1" });
    const html = renderToStaticMarkup(
      <Envelope workspaceId={WS} data={{ id: "e1", rulesetVersion: "T-RS", createdAt: "2026-11-11T02:00:00Z", outOfScope: ["nutrient_adequacy"], nodes, items }} />,
    );
    expect(html).toContain("RULESET T-RS");
    expect(html).toContain("Testcharge");
    expect(html).toMatch(/data-card="action"(?:(?!data-card=)[\s\S])*>DE</);
  });

  it("[E02.must.1] every withheld item names its reason and its gap, and a market with nothing recorded says so", () => {
    const html = renderToStaticMarkup(
      <Envelope workspaceId={WS} data={{ id: "e1", rulesetVersion: "T-RS", createdAt: "2026-11-11T02:00:00Z", outOfScope: ["nutrient_adequacy"], nodes, items }} />,
    );
    expect(html).toContain(`href="/w/${WS}/library/coverage/EU-AT#GAP-T-AT-COMP"`);
    expect(html).toContain("NO COVERAGE GAP RECORDED");
    expect(html).toContain("FR · No coverage recorded for this market");
    expect(html).toMatch(/data-card="clear"(?:(?!data-card=)[\s\S])*>None</);
  });

  it("[E02.must.2] states that nutrient adequacy is out of scope until FEDIAF is licensed", () => {
    const html = renderToStaticMarkup(
      <Envelope workspaceId={WS} data={{ id: "e1", rulesetVersion: "T-RS", createdAt: "2026-11-11T02:00:00Z", outOfScope: ["nutrient_adequacy"], nodes: [], items: [] }} />,
    );
    expect(html).toContain("Nutrient adequacy is not assessed: it is out of scope until the FEDIAF guidelines are licensed.");
  });
});
