import { describe, expect, it } from "vitest";
import { buildReport, gapHref, latestChecks, ReportShapeError, setLabel, type CheckRow, type FindingRow, type ReportRows } from "./model";

const WS = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";
const OLD_JOB = "33333333-3333-4333-8333-333333333333";

function check(id: string, node: string, panel: string, language: string, extra: Partial<CheckRow> = {}): CheckRow {
  return {
    id,
    job_id: JOB,
    node_id: node,
    panel_id: panel,
    language,
    label_state: "not_assessed",
    ruleset_version: "0000.00-empty",
    artwork_version_id: "av",
    artwork_sha: "4f19aa00c02a",
    at: "2026-10-29T10:00:00Z",
    ...extra,
  };
}

function finding(id: string, checkId: string, node: string, extra: Partial<FindingRow> = {}): FindingRow {
  return {
    id,
    check_id: checkId,
    node_id: node,
    rule_key: null,
    gap_id: `GAP-${node}-COMPOSITION`,
    state: "not_assessed",
    provenance: "not_assessed",
    citation: null,
    message: "Not assessed (composition).",
    recommended_action: null,
    text_object_id: null,
    bbox_mm: null,
    measured_mm: null,
    required_mm: null,
    reason_code: "not_encoded",
    created_at: "2026-10-29T10:00:00Z",
    ...extra,
  };
}

function rows(extra: Partial<ReportRows> = {}): ReportRows {
  return {
    workspaceId: WS,
    markets: [
      { node_id: "EU-DE", name: "Germany", last_check_job_id: JOB },
      { node_id: "EU-BE", name: "Belgium", last_check_job_id: JOB },
    ],
    checks: [
      check("c-de-de", "EU-DE", "p-de", "de"),
      check("c-be-nl", "EU-BE", "p-nl", "nl"),
      check("c-be-fr", "EU-BE", "p-fr", "fr"),
    ],
    findings: [
      finding("f1", "c-de-de", "EU-DE"),
      finding("f2", "c-be-nl", "EU-BE", { gap_id: "GAP-EU-BE-LANGUAGE" }),
      finding("f3", "c-be-fr", "EU-BE", { gap_id: "GAP-EU-BE-LANGUAGE" }),
      finding("f4", "c-be-fr", "EU-BE"),
    ],
    panels: [
      { id: "p-de", page: 1, panel_index: 0, bbox_mm: [0, 0, 105, 297], language: "de", status: "extracted", failure_code: null },
      { id: "p-nl", page: 1, panel_index: 1, bbox_mm: [105, 0, 210, 297], language: "nl", status: "extracted", failure_code: null },
      { id: "p-fr", page: 1, panel_index: 2, bbox_mm: [210, 0, 315, 297], language: "fr", status: "extracted", failure_code: null },
    ],
    textObjects: [],
    gaps: [
      { gap_id: "GAP-EU-DE-COMPOSITION", node_id: "EU-DE", domain: "composition", reason_code: "not_encoded", description: "No rules are encoded for composition in Germany yet." },
      { gap_id: "GAP-EU-BE-LANGUAGE", node_id: "EU-BE", domain: "language", reason_code: "not_encoded", description: "No rules are encoded for language in Belgium yet." },
      { gap_id: "GAP-EU-BE-COMPOSITION", node_id: "EU-BE", domain: "composition", reason_code: "not_encoded", description: "No rules are encoded for composition in Belgium yet." },
    ],
    currentRuleset: "0000.00-empty",
    ...extra,
  };
}

describe("label report model (D07)", () => {
  it("[D07.must.1] one result set per market × printed language panel, each holding only its own check's findings", () => {
    const report = buildReport(rows());
    expect(report.sets.map((s) => [s.checkId, s.label])).toEqual([
      ["c-be-nl", "BE-NL"],
      ["c-be-fr", "BE-FR"],
      ["c-de-de", "DE"],
    ]);
    expect(report.sets.find((s) => s.checkId === "c-be-nl")!.findings.map((f) => f.id)).toEqual(["f2"]);
    expect(report.sets.find((s) => s.checkId === "c-be-fr")!.findings.map((f) => f.id).sort()).toEqual(["f3", "f4"]);
    // Every finding appears in exactly one set.
    const ids = report.sets.flatMap((s) => s.findings.map((f) => f.id));
    expect(ids.sort()).toEqual(["f1", "f2", "f3", "f4"]);
    // Belgium reads Dutch and French: two sets, two languages, one tile.
    expect(report.markets.map((m) => [m.code, m.detail])).toEqual([
      ["BE", "3 findings"],
      ["DE", "1 finding"],
    ]);
    expect(report.languages).toBe(3);
  });

  it("[D07.must.1] an older check job's results are never mixed into the latest set", () => {
    const stale = check("c-de-old", "EU-DE", "p-de", "de", { job_id: OLD_JOB, label_state: "action", at: "2026-10-01T10:00:00Z" });
    const report = buildReport(rows({ checks: [...rows().checks, stale], findings: [...rows().findings, finding("f-old", "c-de-old", "EU-DE")] }));
    expect(report.sets.map((s) => s.checkId)).not.toContain("c-de-old");
    expect(report.sets.flatMap((s) => s.findings.map((f) => f.id))).not.toContain("f-old");
    expect(latestChecks(rows().markets, [stale])).toEqual([]);
  });

  it("[D07.must.1] a market whose latest job wrote no check shows Not assessed, never Clear", () => {
    const report = buildReport(rows({ markets: [...rows().markets, { node_id: "US-TX", name: "Texas", last_check_job_id: null }] }));
    const tx = report.markets.find((m) => m.nodeId === "US-TX")!;
    expect(tx).toMatchObject({ state: "not_assessed", detail: "not checked yet" });
  });

  it("[D07.must.1] the switcher names a set by its language at home and by market and language elsewhere", () => {
    expect(setLabel("EU-DE", "de")).toBe("DE");
    expect(setLabel("EU-AT", "de")).toBe("AT-DE");
    expect(setLabel("EU-BE", "fr")).toBe("BE-FR");
    expect(setLabel("US-TX", "en")).toBe("TX-EN");
    expect(setLabel("EU-FR", null)).toBe("FR-UND");
  });

  it("[D07.must.2] every Not assessed with a gap links to that gap on its coverage node", () => {
    const report = buildReport(rows());
    const withheld = report.sets.flatMap((s) => s.findings).filter((f) => f.state === "not_assessed");
    expect(withheld).toHaveLength(4);
    for (const f of withheld) {
      if (f.state !== "not_assessed" || f.gapId === null) throw new Error("expected a gap");
      expect(f.gapHref).toBe(gapHref(WS, f.gapId.split("-").slice(1, 3).join("-"), f.gapId));
    }
    const be = report.sets.find((s) => s.checkId === "c-be-nl")!.findings[0];
    expect(be).toMatchObject({
      gapId: "GAP-EU-BE-LANGUAGE",
      gapHref: `/w/${WS}/library/coverage/EU-BE#GAP-EU-BE-LANGUAGE`,
      title: "No rules are encoded for language in Belgium yet.",
      reasonCode: "not_encoded",
    });
    expect(report.ungapped).toBe(0);
  });

  it("[D07.must.2] a withheld finding without a gap stays Not assessed and is counted, never shown as passed", () => {
    const ungapped = finding("f5", "c-de-de", "EU-DE", { gap_id: null, rule_key: "EU-767-2009-A17", citation: "EU 767/2009 Art. 17", reason_code: "data_missing", message: "Not assessed (data_missing)." });
    const report = buildReport(rows({ findings: [...rows().findings, ungapped] }));
    const f = report.sets.find((s) => s.checkId === "c-de-de")!.findings.find((x) => x.id === "f5")!;
    expect(f).toMatchObject({ state: "not_assessed", gapId: null, reasonCode: "data_missing", citation: "EU 767/2009 Art. 17" });
    expect(report.ungapped).toBe(1);
  });

  it("an action without a rule_key is refused rather than shown as a verdict", () => {
    const bad = finding("f6", "c-de-de", "EU-DE", { state: "action", provenance: "deterministic_rule", gap_id: null, reason_code: null });
    expect(() => buildReport(rows({ findings: [bad] }))).toThrow(ReportShapeError);
  });

  it("pins number the text objects findings point at, in reading order, and carry measured against required", () => {
    const objects = [
      { id: "t2", panel_id: "p-de", text: "Analytische Bestandteile", bbox_mm: [8, 80, 62, 85], is_ocr: false, reading_order: 3 },
      { id: "t1", panel_id: "p-de", text: "Alleinfuttermittel", bbox_mm: [8, 14, 97, 22], is_ocr: false, reading_order: 1 },
    ];
    const action = finding("f7", "c-de-de", "EU-DE", {
      state: "action", provenance: "deterministic_rule", gap_id: null, reason_code: null, rule_key: "EU-767-A2-1B",
      citation: "EU 767/2009 Annex II 1(b)", message: "Heading below minimum character height", text_object_id: "t2",
      measured_mm: 1.91, required_mm: 2,
    });
    const report = buildReport(rows({ textObjects: objects, findings: [...rows().findings, action] }));
    const de = report.sets.find((s) => s.checkId === "c-de-de")!;
    expect(de.panel!.pins.map((p) => [p.id, p.pin])).toEqual([["t1", null], ["t2", "1"]]);
    expect(de.panel!.caption).toBe("Page 1 · panel 1 · 105 × 297 mm · vector text extracted");
    expect(de.findings[0]).toMatchObject({ id: "f7", pin: "1", measure: "Measured 1.91 mm · required 2.00 mm" });
    expect(de.findings[1]).toMatchObject({ id: "f1", pin: "—" });
  });
});
