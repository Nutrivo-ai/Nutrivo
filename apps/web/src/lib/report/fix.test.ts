import { describe, expect, it } from "vitest";
import { bannerFor, buildFix, languageName, modelDetail, pinLine, requiredTerm, type FixFindingRow, type FixRows } from "./fix";
import type { CheckRow } from "./model";

const WS = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "44444444-4444-4444-8444-444444444444";
const JOB = "22222222-2222-4222-8222-222222222222";
const OLD_JOB = "33333333-3333-4333-8333-333333333333";
const RULESET = "2026.11-a";

function check(id: string, node: string, panel: string, language: string, extra: Partial<CheckRow> = {}): CheckRow {
  return {
    id,
    job_id: JOB,
    node_id: node,
    panel_id: panel,
    language,
    label_state: "not_assessed",
    ruleset_version: RULESET,
    artwork_version_id: "av-1",
    artwork_sha: "4f19aa00c02a77",
    at: "2026-11-27T10:00:00Z",
    ...extra,
  };
}

function finding(id: string, checkId: string, node: string, extra: Partial<FixFindingRow> = {}): FixFindingRow {
  return {
    id,
    check_id: checkId,
    node_id: node,
    rule_key: null,
    rule_version: null,
    gap_id: `GAP-${node}-CLAIMS`,
    state: "not_assessed",
    provenance: "not_assessed",
    citation: null,
    message: "Not assessed (claims wording).",
    recommended_action: null,
    panel_id: null,
    language: null,
    text_object_id: null,
    bbox_mm: null,
    measured_mm: null,
    required_mm: null,
    reason_code: "not_encoded",
    confidence: null,
    created_at: "2026-11-27T10:00:00Z",
    ...extra,
  };
}

const TYPE_OF_FEED = "EU.767.ART17.TYPE_OF_FEED";
const ADDITIVE_ID = "EU.767.ANNEX.ADDITIVE_ID";

function rows(extra: Partial<FixRows> = {}): FixRows {
  return {
    workspaceId: WS,
    productId: PRODUCT,
    markets: [
      { node_id: "EU-DE", name: "Germany", languages: ["de"], last_check_job_id: JOB },
      { node_id: "EU-SE", name: "Sweden", languages: ["sv"], last_check_job_id: JOB },
    ],
    checks: [
      check("c-de-de", "EU-DE", "p-de", "de", { label_state: "action" }),
      check("c-de-sv", "EU-DE", "p-sv", "sv"),
      check("c-se-de", "EU-SE", "p-de", "de"),
      check("c-se-sv", "EU-SE", "p-sv", "sv"),
    ],
    findings: [
      // Germany, German panel: the type of feed is missing (no place on the artwork), an additive lacks its number.
      finding("f-missing", "c-de-de", "EU-DE", {
        state: "action",
        provenance: "deterministic_rule",
        rule_key: TYPE_OF_FEED,
        rule_version: 1,
        gap_id: null,
        reason_code: null,
        citation: "Reg. (EC) 767/2009 Art. 17(1)(a)",
        message: "Type of feed is missing from the German panel",
      }),
      finding("f-additive", "c-de-de", "EU-DE", {
        state: "action",
        provenance: "deterministic_rule",
        rule_key: ADDITIVE_ID,
        rule_version: 1,
        gap_id: null,
        reason_code: null,
        citation: "Reg. (EC) 767/2009 Annex VI",
        message: "Additive printed without its identification number",
        text_object_id: "t-additive",
      }),
      finding("f-claim", "c-de-de", "EU-DE", { text_object_id: "t-claim" }),
      finding("f-se", "c-se-sv", "EU-SE", { gap_id: "GAP-EU-SE-CLAIMS" }),
    ],
    panels: [
      { id: "p-de", page: 1, panel_index: 0, bbox_mm: [0, 0, 105, 297], language: "de", status: "extracted", failure_code: null },
      { id: "p-sv", page: 1, panel_index: 1, bbox_mm: [105, 0, 210, 297], language: "sv", status: "extracted", failure_code: null },
    ],
    textObjects: [
      { id: "t-additive", panel_id: "p-de", text: "Ernährungsphysiologische Zusatzstoffe: Vitamin D3", bbox_mm: [8, 98, 97, 108], is_ocr: false, reading_order: 2 },
      { id: "t-claim", panel_id: "p-de", text: "Reich an Omega-3 für ein gesundes Fell", bbox_mm: [8, 36, 60, 44], is_ocr: false, reading_order: 1 },
    ],
    gaps: [
      { gap_id: "GAP-EU-DE-CLAIMS", node_id: "EU-DE", domain: "claims_wording", reason_code: "not_encoded", description: "Claims wording is not encoded for Germany yet." },
      { gap_id: "GAP-EU-SE-CLAIMS", node_id: "EU-SE", domain: "claims_wording", reason_code: "not_encoded", description: "Claims wording is not encoded for Sweden yet." },
    ],
    rules: [
      { rule_key: TYPE_OF_FEED, shape: "mandatory_particular" },
      { rule_key: ADDITIVE_ID, shape: "threshold" },
    ],
    ruleVersions: [
      { rule_key: TYPE_OF_FEED, version: 1, params: { detect: { term_keys: ["complete_feed"] } } },
      { rule_key: ADDITIVE_ID, version: 1, params: { detect: { term_keys: ["nutritional_additives"] } } },
    ],
    members: [
      { ruleset_version: RULESET, rule_key: TYPE_OF_FEED, version: 1 },
      { ruleset_version: RULESET, rule_key: ADDITIVE_ID, version: 1 },
    ],
    terms: [
      { term_key: "complete_feed", language: "de", term: "Alleinfuttermittel", ruleset_version: null },
      { term_key: "complete_feed", language: "sv", term: "Helfoder", ruleset_version: null },
      { term_key: "nutritional_additives", language: "de", term: "Ernährungsphysiologische Zusatzstoffe", ruleset_version: null },
    ],
    currentRuleset: RULESET,
    activeJob: null,
    viewedJob: null,
    ...extra,
  };
}

const market = (model: ReturnType<typeof buildFix>, node: string) => model.markets.find((m) => m.nodeId === node)!;

describe("Fix mode model (S-FIX-001, D07)", () => {
  it("[D07.main] the selected market's fixes come first, panel by panel, then what was not assessed, with pins that match", () => {
    const model = buildFix(rows());
    expect(model.initialMarket).toBe("EU-DE");
    const de = market(model, "EU-DE");
    expect(de.state).toBe("action");
    expect(de.heading).toEqual({
      text: "2 fixes left in Germany · 1 not assessed",
      sub: "Findings on the German panel come first. Pins on the label match the numbers here.",
      tone: "ink",
    });
    expect(de.groups).toHaveLength(1);
    expect(de.groups[0]).toMatchObject({ checkId: "c-de-de", title: "DE · German panel", open: 2 });
    // The missing particular heads its group, with no pin; the panel it is missing from is outlined.
    expect(de.groups[0].items.map((i) => [i.id, i.missing, i.pin])).toEqual([
      ["f-missing", true, null],
      ["f-additive", false, "1"],
    ]);
    expect(de.notAssessed.map((i) => [i.id, i.pin])).toEqual([["f-claim", "2"]]);
    const dePanel = de.panels.find((p) => p.id === "p-de")!;
    expect(dePanel.missing).toBe(true);
    expect(dePanel.pins.map((p) => [p.pin, p.kind, p.itemId])).toEqual([
      ["1", "fix", "f-additive"],
      ["2", "not_assessed", "f-claim"],
    ]);
    expect(dePanel.pins[0].label).toBe("Finding 1: Additive printed without its identification number");
    // Printed text is quoted from the panel's text object, in the panel's language, never translated.
    expect(de.groups[0].items[1]).toMatchObject({ printed: "Ernährungsphysiologische Zusatzstoffe: Vitamin D3", lang: "de", langName: "German" });
    // Every finding carries its provenance and its rule_key or gap.
    expect(de.groups[0].items.every((i) => i.provenance === "deterministic_rule" && !!i.ruleKey && !!i.citation)).toBe(true);
    expect(pinLine(de)).toBe("Pinned to ruleset 2026.11-a · artwork 4f19…2a77 · checked 27 Nov 2026, 10:00 UTC");
  });

  it("[D07.main] only the market's own language panels carry a state chip; the others say what they are not", () => {
    const de = market(buildFix(rows()), "EU-DE");
    expect(de.panels.map((p) => [p.code, p.judged, p.chip?.label ?? null, p.notLine])).toEqual([
      ["DE", true, "Action needed · 2 open", null],
      ["SV", false, null, "Not a German-language panel"],
    ]);
    const se = market(buildFix(rows()), "EU-SE");
    expect(se.panels.map((p) => [p.code, p.chip?.label ?? null, p.notLine])).toEqual([
      ["SV", "Not assessed", null],
      ["DE", null, "Not a Swedish-language panel"],
    ]);
  });

  it("[D07.must.1] one result set per language panel: each panel is its own check, holding only its own findings", () => {
    const model = buildFix(rows());
    for (const m of model.markets) {
      const own = rows().checks.filter((c) => c.node_id === m.nodeId);
      expect(m.panels.map((p) => p.checkId).sort()).toEqual(own.map((c) => c.id).sort());
      for (const item of [...m.groups.flatMap((g) => g.items), ...m.notAssessed]) {
        const row = rows().findings.find((f) => f.id === item.id)!;
        expect(item.checkId).toBe(row.check_id);
        expect(own.map((c) => c.id)).toContain(item.checkId);
      }
    }
    // Every finding appears once, in its own market.
    const ids = model.markets.flatMap((m) => [...m.groups.flatMap((g) => g.items), ...m.notAssessed].map((i) => i.id));
    expect(ids.sort()).toEqual(["f-additive", "f-claim", "f-missing", "f-se"]);
  });

  it("[D07.must.1] an older check job's results are never mixed into the latest; ?job= opens it read-only", () => {
    const stale = check("c-de-old", "EU-DE", "p-de", "de", { job_id: OLD_JOB, label_state: "clear", at: "2026-11-01T10:00:00Z" });
    const withOld = rows({ checks: [...rows().checks, stale] });
    const latest = market(buildFix(withOld), "EU-DE");
    expect(latest.panels.map((p) => p.checkId)).not.toContain("c-de-old");
    expect(latest.superseded).toBe(false);

    const older = market(buildFix({ ...withOld, viewedJob: OLD_JOB }), "EU-DE");
    expect(older.panels.map((p) => p.checkId)).toEqual(["c-de-old"]);
    expect(older.superseded).toBe(true);
    const banner = bannerFor(older, { workspaceId: WS, productId: PRODUCT, activeJob: null, currentRuleset: RULESET });
    expect(banner).toEqual({ kind: "superseded", title: "A newer result exists.", text: "This one is read-only.", href: `/w/${WS}/products/${PRODUCT}/report` });
    // A market the old job never checked keeps its latest result.
    expect(market(buildFix({ ...withOld, viewedJob: OLD_JOB }), "EU-SE").superseded).toBe(false);
  });

  it("[D07.must.2] every Not assessed links to its gap, or says that none was recorded", () => {
    const ungapped = finding("f-nogap", "c-se-sv", "EU-SE", { gap_id: null, reason_code: "model_unavailable" });
    const model = buildFix(rows({ findings: [...rows().findings, ungapped] }));
    const all = model.markets.flatMap((m) => m.notAssessed);
    for (const item of all.filter((i) => i.id !== "f-nogap")) {
      expect(item.gapHref).toBe(`/w/${WS}/library/coverage/${item.gapId!.includes("EU-SE") ? "EU-SE" : "EU-DE"}#${item.gapId}`);
    }
    expect(all.find((i) => i.id === "f-nogap")).toMatchObject({ gapId: null, gapHref: null, reasonCode: "model_unavailable" });
    expect(model.ungapped).toBe(1);
  });

  it("[D07] a market reads label clear only from the engine's state with nothing open and nothing withheld", () => {
    const clearRows = rows({
      checks: [check("c-de-de", "EU-DE", "p-de", "de", { label_state: "clear" }), check("c-se-sv", "EU-SE", "p-sv", "sv", { label_state: "clear" })],
      findings: [],
    });
    const de = market(buildFix(clearRows), "EU-DE");
    expect(de.state).toBe("clear");
    expect(de.heading).toEqual({ text: "Germany is label clear", sub: "No fixes left. Every German-language panel checked for Germany.", tone: "ink" });
    expect(de.panels[0].chip).toEqual({ state: "clear", label: "Label clear" });

    // S-FIX-013: nothing open, one item withheld: grey Not assessed, never label clear.
    const na = market(buildFix({ ...clearRows, findings: [finding("f-claim", "c-de-de", "EU-DE", { gap_id: "GAP-EU-DE-CLAIMS" })] }), "EU-DE");
    expect(na.state).toBe("not_assessed");
    expect(na.heading).toEqual({ text: "Germany: not assessed", sub: "No fixes left. 1 item isn’t covered by an accepted rule yet.", tone: "not_assessed" });

    // A fix alone: "before Germany is label clear" only when nothing is Not assessed.
    const fixOnly = market(buildFix(rows({ findings: rows().findings.filter((f) => f.state === "action") })), "EU-DE");
    expect(fixOnly.heading.text).toBe("2 fixes left before Germany is label clear");
    const one = market(buildFix(rows({ findings: rows().findings.filter((f) => f.id === "f-additive") })), "EU-DE");
    expect(one.heading.text).toBe("1 fix left before Germany is label clear");

    // A market whose latest job wrote no check is not checked, never clear.
    const tx = market(buildFix(rows({ markets: [...rows().markets, { node_id: "US-TX", name: "Texas", languages: ["en"], last_check_job_id: null }] })), "US-TX");
    expect(tx.state).toBe("unchecked");
    expect(tx.heading.tone).toBe("not_assessed");
  });

  it("[D07] S-FIX-007: a model abstention is withheld, shown Not assessed with its confidence, never passed", () => {
    const abstained = finding("f-abstain", "c-se-sv", "EU-SE", {
      rule_key: "EU.CLAIMS.NATURAL",
      gap_id: null,
      reason_code: "model_abstained",
      confidence: 0.31,
      text_object_id: null,
      message: "Claim · the model abstained, so this is not assessed",
    });
    const se = market(buildFix(rows({ findings: [abstained] })), "EU-SE");
    expect(se.state).toBe("not_assessed");
    expect(se.groups).toEqual([]);
    expect(se.notAssessed[0]).toMatchObject({ id: "f-abstain", provenance: "not_assessed", modelDetail: "model abstained · confidence 0.31" });
    expect(modelDetail({ confidence: 0.92, reason_code: null })).toBe("confidence 0.92");
  });

  it("[D07] S-FIX-006: a panel that could not be read carries no text and keeps its market from label clear", () => {
    const failed = rows({
      panels: rows().panels.map((p) => (p.id === "p-sv" ? { ...p, status: "failed", failure_code: "outlined_text" } : p)),
      checks: [check("c-se-sv", "EU-SE", "p-sv", "sv", { label_state: "not_assessed" })],
      findings: [finding("f-outlined", "c-se-sv", "EU-SE", { gap_id: null, rule_key: TYPE_OF_FEED, reason_code: "outlined_text" })],
    });
    const se = market(buildFix(failed), "EU-SE");
    expect(se.panels[0]).toMatchObject({ readable: false, chip: { state: "not_assessed", label: "Couldn’t read" } });
    expect(se.panels[0].failureNote).toMatch(/^Sweden can’t be checked on this panel until it is read/);
    expect(se.state).not.toBe("clear");
  });
});

describe("Copy required term (D-31, D-33)", () => {
  const ctx = (r: FixRows) => ({
    rules: new Map(r.rules.map((x) => [x.rule_key, x])),
    versions: new Map(r.ruleVersions.map((v) => [`${v.rule_key}|${v.version}`, v])),
    members: new Map(r.members.map((m) => [`${m.ruleset_version}|${m.rule_key}`, m.version])),
    terms: r.terms,
  });

  it("offers the accepted register wording in the panel's language, and nothing for a rule that names no wording", () => {
    const de = market(buildFix(rows()), "EU-DE");
    const [missing, additive] = de.groups[0].items;
    expect(missing.term).toEqual({ text: "Alleinfuttermittel", lang: "de", langName: "German" });
    // A threshold judges text that is printed; it has no wording to copy, so the rule and citation stand alone.
    expect(additive.term).toBeNull();
  });

  it("is never the wording of another language: a panel with no entry in its language has none", () => {
    const r = rows();
    expect(requiredTerm({ rule_key: TYPE_OF_FEED, rule_version: 1 }, "da", RULESET, ctx(r))).toBeNull();
    expect(requiredTerm({ rule_key: TYPE_OF_FEED, rule_version: 1 }, "sv", RULESET, ctx(r))?.text).toBe("Helfoder");
    expect(requiredTerm({ rule_key: TYPE_OF_FEED, rule_version: 1 }, null, RULESET, ctx(r))).toBeNull();
    expect(requiredTerm({ rule_key: TYPE_OF_FEED, rule_version: 1 }, "und", RULESET, ctx(r))).toBeNull();
  });

  it("only accepted entries, pinned to the check's ruleset before unpinned ones, and none when two wordings would fit", () => {
    const base = rows();
    const pinned = { ...base, terms: [...base.terms, { term_key: "complete_feed", language: "de", term: "Alleinfutter", ruleset_version: RULESET }] };
    expect(requiredTerm({ rule_key: TYPE_OF_FEED, rule_version: 1 }, "de", RULESET, ctx(pinned))?.text).toBe("Alleinfutter");
    const candidate = { ...base, terms: base.terms.map((t) => ({ ...t, status: "candidate" })) };
    expect(requiredTerm({ rule_key: TYPE_OF_FEED, rule_version: 1 }, "de", RULESET, ctx(candidate))).toBeNull();
    const two = { ...base, terms: [...base.terms, { term_key: "complete_feed", language: "de", term: "Vollfutter", ruleset_version: null }] };
    expect(requiredTerm({ rule_key: TYPE_OF_FEED, rule_version: 1 }, "de", RULESET, ctx(two))).toBeNull();
    // The rule version comes from the ruleset's members when the finding does not carry it.
    expect(requiredTerm({ rule_key: TYPE_OF_FEED, rule_version: null }, "de", RULESET, ctx(base))?.text).toBe("Alleinfuttermittel");
    // A rule without links names no wording.
    const unlinked = { ...base, ruleVersions: [{ rule_key: TYPE_OF_FEED, version: 1, params: { particular: "type of feed" } }] };
    expect(requiredTerm({ rule_key: TYPE_OF_FEED, rule_version: 1 }, "de", RULESET, ctx(unlinked))).toBeNull();
  });

  it("a Not assessed item never offers a wording", () => {
    const de = market(buildFix(rows()), "EU-DE");
    expect(de.notAssessed.every((i) => i.term === null)).toBe(true);
  });
});

describe("re-check banners (S-FIX-005, S-FIX-008; D08)", () => {
  it("[D08.main] a check in flight on a new artwork version says the revision is being checked, and links to its progress", () => {
    const de = market(buildFix(rows()), "EU-DE");
    const banner = bannerFor(de, { workspaceId: WS, productId: PRODUCT, activeJob: { id: JOB, status: "queued", artwork_version_id: "av-2" }, currentRuleset: RULESET });
    expect(banner).toEqual({
      kind: "rechecking",
      title: "Revision uploaded.",
      text: "The new artwork is being checked. Pins turn clear only when that check passes.",
      href: `/w/${WS}/products/${PRODUCT}/checks/${JOB}`,
    });
  });

  it("[D08.main] a check against an older ruleset offers a re-check against the current one", () => {
    const de = market(buildFix(rows({ currentRuleset: "2026.12-a" })), "EU-DE");
    expect(de.rulesetCurrent).toBe(false);
    expect(bannerFor(de, { workspaceId: WS, productId: PRODUCT, activeJob: null, currentRuleset: "2026.12-a" })).toEqual({
      kind: "older",
      title: "Checked against ruleset 2026.11-a.",
      text: "The current ruleset is 2026.12-a.",
      current: "2026.12-a",
    });
    expect(bannerFor(market(buildFix(rows()), "EU-DE"), { workspaceId: WS, productId: PRODUCT, activeJob: null, currentRuleset: RULESET })).toBeNull();
  });

  it("[D08.must.2] history is never rewritten: the latest job's results stand beside the older job's, each pinned to its own artwork", () => {
    const old = rows().checks.map((c) => ({ ...c, id: `${c.id}-v1`, job_id: OLD_JOB, artwork_version_id: "av-1", artwork_sha: "aaaa000000bbbb", at: "2026-11-01T10:00:00Z" }));
    const latest = rows().checks.map((c) => ({ ...c, artwork_version_id: "av-2", artwork_sha: "cccc000000dddd" }));
    const both = rows({ checks: [...old, ...latest] });
    expect(market(buildFix(both), "EU-DE")).toMatchObject({ artworkVersionId: "av-2", artworkSha: "cccc000000dddd", superseded: false });
    expect(market(buildFix({ ...both, viewedJob: OLD_JOB }), "EU-DE")).toMatchObject({ artworkVersionId: "av-1", artworkSha: "aaaa000000bbbb", superseded: true });
  });
});

describe("language names", () => {
  it("names a language in English and never guesses an undetermined one", () => {
    expect(languageName("de")).toBe("German");
    expect(languageName("sv")).toBe("Swedish");
    expect(languageName("und")).toBe("Undetermined language");
    expect(languageName(null)).toBe("Undetermined language");
  });
});
