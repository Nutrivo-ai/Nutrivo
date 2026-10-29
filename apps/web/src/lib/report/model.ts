// S-NV2-003 Label report (D07): the rows a product's latest check wrote, read under RLS, shaped into what the screen
// shows. Pure, so the two must-holds are tested without a database:
// - one result set per app.checks row, that is per market × printed language panel (docs/04 contract 1); a set holds
//   only its own check's findings, and only the checks of each market's latest check job are shown;
// - every Not assessed that carries a gap_id links to that coverage gap (contract 4). A withheld finding without one
//   stays Not assessed, never Clear, and says that no gap was recorded (#46 question 4).
import type { Provenance, VerdictState, WithheldReason } from "@/components/kit/states";

export type MarketRow = { node_id: string; name: string; last_check_job_id: string | null };
export type CheckRow = {
  id: string;
  job_id: string | null;
  node_id: string;
  panel_id: string | null;
  language: string | null;
  label_state: string;
  ruleset_version: string;
  artwork_version_id: string | null;
  artwork_sha: string | null;
  at: string;
};
export type FindingRow = {
  id: string;
  check_id: string;
  node_id: string;
  rule_key: string | null;
  gap_id: string | null;
  state: string;
  provenance: string;
  citation: string | null;
  message: string;
  recommended_action: string | null;
  text_object_id: string | null;
  bbox_mm: number[] | null;
  measured_mm: number | null;
  required_mm: number | null;
  reason_code: string | null;
  created_at: string;
};
export type PanelRow = {
  id: string;
  page: number;
  panel_index: number;
  bbox_mm: number[];
  language: string | null;
  status: string;
  failure_code: string | null;
};
export type TextObjectRow = {
  id: string;
  panel_id: string;
  text: string;
  bbox_mm: number[];
  is_ocr: boolean;
  reading_order: number | null;
};
export type GapRow = { gap_id: string; node_id: string; domain: string; reason_code: string; description: string };

export type ReportRows = {
  workspaceId: string;
  markets: MarketRow[];
  checks: CheckRow[];
  findings: FindingRow[];
  panels: PanelRow[];
  textObjects: TextObjectRow[];
  gaps: GapRow[];
  /** The latest released ruleset, to say whether the pinned one is still current. */
  currentRuleset: string | null;
};

type FindingBase = {
  id: string;
  title: string;
  action: string;
  pin: string;
  measure?: string;
  ruleKey?: string;
  citation?: string;
};
export type ReportFinding =
  | (FindingBase & { state: "action"; provenance: Exclude<Provenance, "not_assessed">; ruleKey: string; citation: string })
  | (FindingBase & { state: "not_assessed"; provenance: Provenance; reasonCode: WithheldReason; gapId: string; gapHref: string })
  | (FindingBase & { state: "not_assessed"; provenance: Provenance; reasonCode: string; gapId: null })
  | (FindingBase & { state: "info"; provenance: Provenance });

export type Pin = {
  id: string;
  pin: string | null;
  /** The most urgent state among the findings pinned here; null when none is. */
  state: "action" | "not_assessed" | null;
  text: string;
  box: { x: number; y: number; w: number; h: number } };

export type ResultSet = {
  /** The app.checks id: one set per check row. */
  checkId: string;
  nodeId: string;
  nodeName: string;
  language: string | null;
  label: string;
  state: "clear" | "action" | "not_assessed";
  findings: ReportFinding[];
  /** What the check is pinned to (CLAUDE.md non-negotiable 5). */
  rulesetVersion: string;
  rulesetCurrent: boolean;
  artworkSha: string | null;
  checkedAt: string;
  panel: {
    id: string;
    caption: string;
    widthMm: number;
    heightMm: number;
    pins: Pin[];
  } | null;
};

export type MarketTile = { nodeId: string; code: string; name: string; state: VerdictState; detail: string };

export type ReportModel = {
  markets: MarketTile[];
  sets: ResultSet[];
  languages: number;
  /** Withheld findings that carry no gap (reported, #46 question 4). */
  ungapped: number;
};

const LABEL_ORDER: Record<string, number> = { action: 0, not_assessed: 1, clear: 2 };

/** The node's own code: EU-DE gives DE, US-TX gives TX. */
export function nodeCode(nodeId: string): string {
  const i = nodeId.indexOf("-");
  return i < 0 ? nodeId : nodeId.slice(i + 1);
}

/**
 * The switcher's name for a market × panel: the language alone in its home market (DE in Germany), otherwise the
 * market then the language (AT-DE, BE-FR, TX-EN). #46 question 1.
 */
export function setLabel(nodeId: string, language: string | null): string {
  const lang = (language ?? "und").toUpperCase();
  const code = nodeCode(nodeId);
  return code === lang ? lang : `${code}-${lang}`;
}

export function gapHref(workspaceId: string, nodeId: string, gapId: string): string {
  return `/w/${workspaceId}/library/coverage/${encodeURIComponent(nodeId)}#${encodeURIComponent(gapId)}`;
}

// What each withheld reason means for the reader, as one sentence. Interface copy, not regulatory content.
const REASON_ACTION: Record<string, string> = {
  not_encoded: "No rule is encoded for this yet, so it is withheld rather than passed.",
  partially_encoded: "Only part of this is encoded, so the rest is withheld rather than passed.",
  out_of_scope: "This is outside what Nutrivo assesses for this market, so it is withheld rather than passed.",
  pending_acceptance: "The rule is waiting for acceptance by a person, so it is withheld rather than passed.",
  outlined_text: "The text on this panel is outlined, so it could not be read. Supply a file with live text.",
  rasterised: "This panel is an image, so its text could not be measured. Supply a vector file.",
  missing_font: "A font is missing from the file, so the text could not be read reliably. Embed the fonts.",
  colour_space: "The panel's colour space could not be read. Supply a standard export.",
  no_true_scale: "The file has no true scale, so heights could not be measured. Supply a file at print size.",
  unreadable: "The panel could not be read. Supply the file again, for example as a fresh export.",
  data_missing: "Something the rule needs is missing, so it is withheld rather than passed.",
  model_abstained: "The model abstained, so this is withheld rather than passed.",
  model_unavailable: "The model was unavailable, so this is withheld rather than passed. A re-check runs it again.",
  model_refused: "The model refused, so this is withheld rather than passed.",
  evaluator_missing: "This rule cannot be evaluated yet, so it is withheld rather than passed.",
  evaluator_error: "Evaluating this rule failed, so it is withheld rather than passed.",
};

function reasonAction(code: string | null): string {
  return (code && REASON_ACTION[code]) || "This is withheld rather than passed.";
}

function mm(n: number): string {
  return n.toFixed(2);
}

function measureOf(f: FindingRow): string | undefined {
  if (f.measured_mm != null && f.required_mm != null) return `Measured ${mm(f.measured_mm)} mm · required ${mm(f.required_mm)} mm`;
  if (f.measured_mm != null) return `Measured ${mm(f.measured_mm)} mm`;
  return undefined;
}

function isProvenance(p: string): p is Provenance {
  return p === "deterministic_rule" || p === "model_judgement" || p === "authored_definition" || p === "not_assessed";
}

export class ReportShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportShapeError";
  }
}

/**
 * The checks shown: for each market, the checks its latest check job wrote, one per printed panel. A market whose
 * latest job wrote none shows nothing rather than an older job's result. Within a job a panel has one check; should
 * there be two, the later one is kept.
 */
export function latestChecks(markets: MarketRow[], checks: CheckRow[]): CheckRow[] {
  const jobOf = new Map(markets.map((m) => [m.node_id, m.last_check_job_id]));
  const kept = new Map<string, CheckRow>();
  for (const c of checks) {
    const job = jobOf.get(c.node_id);
    if (!job || c.job_id !== job) continue;
    const key = `${c.node_id}|${c.panel_id ?? c.language ?? "-"}`;
    const prev = kept.get(key);
    if (!prev || prev.at < c.at) kept.set(key, c);
  }
  return [...kept.values()];
}

function panelCaption(p: PanelRow, objects: TextObjectRow[]): string {
  const [x0, y0, x1, y1] = p.bbox_mm.map(Number);
  const size = `${Math.round(x1 - x0)} × ${Math.round(y1 - y0)} mm`;
  const read =
    p.status !== "extracted"
      ? `not assessable · ${(p.failure_code ?? "unreadable").replace(/_/g, " ")}`
      : objects.length === 0
        ? "no text extracted"
        : objects.some((o) => o.is_ocr)
          ? "text read by OCR"
          : "vector text extracted";
  return `Page ${p.page} · panel ${p.panel_index + 1} · ${size} · ${read}`;
}

function findingOf(f: FindingRow, pin: string, rows: ReportRows, gaps: Map<string, GapRow>): ReportFinding {
  const provenance: Provenance = isProvenance(f.provenance) ? f.provenance : "not_assessed";
  const base = {
    id: f.id,
    pin,
    measure: measureOf(f),
    ruleKey: f.rule_key ?? undefined,
    citation: f.citation ?? undefined,
  };
  if (f.state === "action") {
    if (!f.rule_key || provenance === "not_assessed") {
      // A verdict without a rule is never shown as one (CLAUDE.md non-negotiable 6).
      throw new ReportShapeError(`finding ${f.id} is an action without a rule_key`);
    }
    return {
      ...base,
      state: "action",
      provenance,
      ruleKey: f.rule_key,
      citation: f.citation ?? f.rule_key,
      title: f.message,
      action: f.recommended_action ?? "Follow the rule cited below.",
    };
  }
  if (f.state === "not_assessed") {
    const gap = f.gap_id ? gaps.get(f.gap_id) : undefined;
    const reasonCode = f.reason_code ?? gap?.reason_code ?? "not_encoded";
    if (f.gap_id) {
      return {
        ...base,
        state: "not_assessed",
        provenance,
        reasonCode: reasonCode as WithheldReason,
        gapId: f.gap_id,
        gapHref: gapHref(rows.workspaceId, gap?.node_id ?? f.node_id, f.gap_id),
        title: gap?.description ?? f.message,
        action: reasonAction(reasonCode),
      };
    }
    return {
      ...base,
      state: "not_assessed",
      provenance,
      reasonCode,
      gapId: null,
      title: f.message,
      action: reasonAction(reasonCode),
    };
  }
  return { ...base, state: "info", provenance, title: f.message, action: f.recommended_action ?? "" };
}

export function buildReport(rows: ReportRows): ReportModel {
  const markets = [...rows.markets].sort((a, b) => a.node_id.localeCompare(b.node_id));
  const shown = latestChecks(markets, rows.checks);
  const panels = new Map(rows.panels.map((p) => [p.id, p]));
  const gaps = new Map(rows.gaps.map((g) => [g.gap_id, g]));
  const objectsByPanel = new Map<string, TextObjectRow[]>();
  for (const o of rows.textObjects) {
    const list = objectsByPanel.get(o.panel_id) ?? [];
    list.push(o);
    objectsByPanel.set(o.panel_id, list);
  }
  const findingsByCheck = new Map<string, FindingRow[]>();
  for (const f of rows.findings) {
    const list = findingsByCheck.get(f.check_id) ?? [];
    list.push(f);
    findingsByCheck.set(f.check_id, list);
  }
  const marketOrder = new Map(markets.map((m, i) => [m.node_id, i]));
  const panelIndex = (c: CheckRow) => (c.panel_id ? panels.get(c.panel_id)?.panel_index : undefined) ?? 0;
  shown.sort(
    (a, b) =>
      (marketOrder.get(a.node_id)! - marketOrder.get(b.node_id)!) ||
      panelIndex(a) - panelIndex(b) ||
      (a.language ?? "").localeCompare(b.language ?? ""),
  );

  let ungapped = 0;
  const sets: ResultSet[] = shown.map((c) => {
    const panel = c.panel_id ? panels.get(c.panel_id) : undefined;
    const objects = (panel ? objectsByPanel.get(panel.id) ?? [] : []).sort(
      (a, b) => (a.reading_order ?? 0) - (b.reading_order ?? 0),
    );
    const own = (findingsByCheck.get(c.id) ?? []).sort(
      (a, b) =>
        (LABEL_ORDER[a.state] ?? 9) - (LABEL_ORDER[b.state] ?? 9) ||
        (a.rule_key ?? a.gap_id ?? "").localeCompare(b.rule_key ?? b.gap_id ?? "") ||
        a.id.localeCompare(b.id),
    );
    // Pins: one number per text object a finding points at, in reading order; a finding with no coordinates gets "—".
    const pinned = new Map<string, string>();
    for (const o of objects) {
      if (own.some((f) => f.text_object_id === o.id)) pinned.set(o.id, String(pinned.size + 1));
    }
    const findings = own.map((f) => {
      const finding = findingOf(f, (f.text_object_id && pinned.get(f.text_object_id)) || "—", rows, gaps);
      if (finding.state === "not_assessed" && finding.gapId === null) ungapped++;
      return finding;
    });
    const state = (["clear", "action", "not_assessed"] as const).find((s) => s === c.label_state) ?? "not_assessed";
    return {
      checkId: c.id,
      nodeId: c.node_id,
      nodeName: markets.find((m) => m.node_id === c.node_id)?.name ?? c.node_id,
      language: c.language,
      label: setLabel(c.node_id, c.language),
      state,
      findings,
      rulesetVersion: c.ruleset_version,
      rulesetCurrent: c.ruleset_version === rows.currentRuleset,
      artworkSha: c.artwork_sha,
      checkedAt: c.at,
      panel: panel
        ? {
            id: panel.id,
            caption: panelCaption(panel, objects),
            widthMm: Number(panel.bbox_mm[2]) - Number(panel.bbox_mm[0]),
            heightMm: Number(panel.bbox_mm[3]) - Number(panel.bbox_mm[1]),
            pins: objects.map((o) => ({
              id: o.id,
              pin: pinned.get(o.id) ?? null,
              state: own.some((f) => f.text_object_id === o.id && f.state === "action")
                ? "action"
                : own.some((f) => f.text_object_id === o.id && f.state === "not_assessed")
                  ? "not_assessed"
                  : null,
              text: o.text,
              box: {
                x: Number(o.bbox_mm[0]) - Number(panel.bbox_mm[0]),
                y: Number(o.bbox_mm[1]) - Number(panel.bbox_mm[1]),
                w: Number(o.bbox_mm[2]) - Number(o.bbox_mm[0]),
                h: Number(o.bbox_mm[3]) - Number(o.bbox_mm[1]),
              },
            })),
          }
        : null,
    };
  });

  const tiles: MarketTile[] = markets.map((m) => {
    const own = sets.filter((s) => s.nodeId === m.node_id);
    if (own.length === 0) {
      return { nodeId: m.node_id, code: nodeCode(m.node_id), name: m.name, state: "not_assessed", detail: "not checked yet" };
    }
    const state = own.map((s) => s.state).sort((a, b) => LABEL_ORDER[a] - LABEL_ORDER[b])[0];
    const count = own.reduce((n, s) => n + s.findings.filter((f) => f.state !== "info").length, 0);
    return {
      nodeId: m.node_id,
      code: nodeCode(m.node_id),
      name: m.name,
      state,
      detail: `${count} finding${count === 1 ? "" : "s"}`,
    };
  });

  return {
    markets: tiles,
    sets,
    languages: new Set(rows.panels.map((p) => p.language ?? "und")).size,
    ungapped,
  };
}
