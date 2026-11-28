// S-FIX-001 to S-FIX-013 · the label report as Fix mode (D-33, T-1114; D07, D08). The rows a product's checks wrote,
// read under RLS, shaped into a checklist per market beside the label's panels. Pure, so every rule below is tested
// without a database (fix.test.ts):
// - one result set per app.checks row, that is per market × printed language panel (docs/04 contract 1): a panel shows
//   its own check's state and its own check's findings, never another's;
// - every Not assessed links to its coverage gap (contract 4), or says that none was recorded (#46 question 4);
// - "label clear" is read only from the engine's label_state, and only when nothing is open and nothing withheld;
// - Copy required term only for exactly one accepted ref.term_entries wording in the panel's language (D-31, D-33):
//   no wording is ever composed here, and a finding without one shows its rule and citation instead (CLAUDE.md 7);
// - pins clear only through a new check of a new artwork version: nothing here marks a finding done.
import type { Provenance } from "@/components/kit/states";
import { findingOf, nodeCode, type CheckRow, type FindingRow, type GapRow, type PanelRow, type TextObjectRow } from "./model";

export type FixFindingRow = FindingRow & {
  rule_version: number | null;
  panel_id: string | null;
  language: string | null;
  confidence: number | null;
};

export type FixMarketRow = {
  node_id: string;
  name: string;
  /** Official labelling languages (ref.jurisdictions.languages, ISO 639-1). */
  languages: string[];
  last_check_job_id: string | null;
};

export type RuleRow = { rule_key: string; shape: string };
export type RuleVersionRow = { rule_key: string; version: number; params: unknown };
export type MemberRow = { ruleset_version: string; rule_key: string; version: number };
export type TermRow = { term_key: string; language: string; term: string; ruleset_version: string | null; status?: string };
export type ActiveJobRow = { id: string; status: string; artwork_version_id: string | null };

export type FixRows = {
  workspaceId: string;
  productId: string;
  markets: FixMarketRow[];
  checks: CheckRow[];
  findings: FixFindingRow[];
  panels: PanelRow[];
  textObjects: TextObjectRow[];
  gaps: GapRow[];
  rules: RuleRow[];
  ruleVersions: RuleVersionRow[];
  members: MemberRow[];
  terms: TermRow[];
  /** The latest released ruleset. */
  currentRuleset: string | null;
  /** A check job of this product that is queued or running. */
  activeJob: ActiveJobRow | null;
  /** The check job named in the address (?job=), to read an older result; null for the latest. */
  viewedJob: string | null;
};

export type Box = { x: number; y: number; w: number; h: number };

export type FixItem = {
  id: string;
  checkId: string;
  panelId: string | null;
  kind: "fix" | "not_assessed";
  /** The number shared by the item and its pin on the label; null when the finding has no place on the artwork. */
  pin: string | null;
  /** A fix with no place on the artwork: something missing from the panel. */
  missing: boolean;
  /** "DE · German panel". */
  panelLabel: string;
  title: string;
  action: string;
  /** The printed text the finding points at, quoted as printed in the panel's language. */
  printed: string | null;
  lang: string | null;
  langName: string | null;
  provenance: Provenance;
  /** Beside the provenance tag, for a model call: "model abstained · confidence 0.42". */
  modelDetail: string | null;
  ruleKey: string | null;
  citation: string | null;
  gapId: string | null;
  gapHref: string | null;
  reasonCode: string | null;
  measure?: string;
  /** The accepted register wording to copy, in the panel's language; null when none, or more than one, applies. */
  term: { text: string; lang: string; langName: string } | null;
  /** Where the pin sits, in millimetres from the panel's top left. */
  box: Box | null;
};

export type PanelChip = { state: "clear" | "action" | "not_assessed"; label: string };

export type FixPanel = {
  id: string;
  checkId: string;
  /** "DE · German". */
  label: string;
  code: string;
  lang: string | null;
  langName: string;
  /** Printed in one of the market's languages: only these carry a state chip. */
  judged: boolean;
  chip: PanelChip | null;
  /** "Not a German-language panel", for a panel in none of the market's languages. */
  notLine: string | null;
  readable: boolean;
  failureNote: string | null;
  caption: string;
  widthMm: number;
  heightMm: number;
  objects: { id: string; text: string; box: Box }[];
  pins: { itemId: string; pin: string; kind: "fix" | "not_assessed"; box: Box; label: string }[];
  /** Something is missing from this panel: it is outlined. */
  missing: boolean;
};

export type FixGroup = { checkId: string; panelId: string | null; title: string; open: number; items: FixItem[] };

export type FixHeading = { text: string; sub: string; tone: "ink" | "not_assessed" };

export type FixMarket = {
  nodeId: string;
  code: string;
  name: string;
  languages: string[];
  /** The market's label state from the engine (worst panel), or unchecked when its job wrote no check. */
  state: "clear" | "action" | "not_assessed" | "unchecked";
  panels: FixPanel[];
  groups: FixGroup[];
  notAssessed: FixItem[];
  /** Informational findings: neither open nor withheld. */
  notes: { id: string; title: string; provenance: Provenance }[];
  fixes: number;
  heading: FixHeading;
  jobId: string | null;
  rulesetVersion: string | null;
  rulesetCurrent: boolean;
  artworkSha: string | null;
  artworkVersionId: string | null;
  checkedAt: string | null;
  /** A newer check of this product and market exists: read-only. */
  superseded: boolean;
};

export type FixBanner =
  | { kind: "rechecking"; title: string; text: string; href: string }
  | { kind: "superseded"; title: string; text: string; href: string }
  | { kind: "older"; title: string; text: string; current: string };

export type FixModel = {
  markets: FixMarket[];
  /** The market the page opens on: the first with something open, else the first. */
  initialMarket: string | null;
  activeJobId: string | null;
  /** Withheld findings without a gap (reported to Sentry, #46 question 4). */
  ungapped: number;
};

const LANGUAGE_NAMES = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" });
  } catch {
    return null;
  }
})();

/** "de" → "German". An unknown or undetermined language reads as such, never as a guess. */
export function languageName(code: string | null | undefined): string {
  if (!code || code === "und") return "Undetermined language";
  try {
    return LANGUAGE_NAMES?.of(code) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

function joinOr(words: string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`;
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function shortSha(sha: string | null): string {
  return sha ? `${sha.slice(0, 4)}…${sha.slice(-4)}` : "not recorded";
}

export function when(iso: string): string {
  return (
    new Date(iso).toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }) + " UTC"
  );
}

/** "Pinned to ruleset 2026.11-a · artwork 4f19…c02a · checked 29 Oct 2026, 10:00 UTC" (CLAUDE.md 5). */
export function pinLine(m: Pick<FixMarket, "rulesetVersion" | "artworkSha" | "checkedAt">): string {
  if (!m.rulesetVersion || !m.checkedAt) return "Not checked yet";
  return `Pinned to ruleset ${m.rulesetVersion} · artwork ${shortSha(m.artworkSha)} · checked ${when(m.checkedAt)}`;
}

// ─── The required term (D-31) ─────────────────────────────────────────────────────────────────────
// Which of a rule's links name the wording a missing or wrong text needs. Only these two shapes say what must be
// printed; a threshold or a character height judges text that is already there, so it offers nothing to copy.
function linkedKeys(shape: string | undefined, params: unknown): string[] {
  if (!params || typeof params !== "object") return [];
  const p = params as Record<string, unknown>;
  if (shape === "prescribed_wording") return typeof p.term_key === "string" && p.term_key ? [p.term_key] : [];
  if (shape === "mandatory_particular") {
    const detect = p.detect as Record<string, unknown> | undefined;
    const keys = detect && Array.isArray(detect.term_keys) ? detect.term_keys : [];
    return keys.filter((k): k is string => typeof k === "string" && k.length > 0);
  }
  return [];
}

/**
 * The accepted register entries for a ruleset, as the engine reads them (worker fixtures_runner.accepted_terms): an
 * entry pinned to the ruleset, else the entries pinned to none, per term key and language.
 */
function termsFor(terms: TermRow[], rulesetVersion: string, key: string, language: string): string[] {
  const own = terms.filter((t) => (t.status ?? "accepted") === "accepted" && t.term_key === key && t.language === language);
  const pinned = own.filter((t) => t.ruleset_version === rulesetVersion);
  const chosen = pinned.length ? pinned : own.filter((t) => t.ruleset_version === null);
  return [...new Set(chosen.map((t) => t.term))];
}

/**
 * The one wording a fix can copy: the accepted register entry, in the panel's language, that the finding's rule links
 * to. None when the language is unknown, the rule links no wording, or more than one wording would fit (the person
 * chooses from the rule and its citation instead). Never written here, never translated.
 */
export function requiredTerm(
  f: Pick<FixFindingRow, "rule_key" | "rule_version">,
  language: string | null,
  rulesetVersion: string,
  ctx: { rules: Map<string, RuleRow>; versions: Map<string, RuleVersionRow>; members: Map<string, number>; terms: TermRow[] },
): { text: string; lang: string; langName: string } | null {
  if (!f.rule_key || !language || language === "und") return null;
  const version = f.rule_version ?? ctx.members.get(`${rulesetVersion}|${f.rule_key}`);
  if (version == null) return null;
  const rv = ctx.versions.get(`${f.rule_key}|${version}`);
  if (!rv) return null;
  const keys = linkedKeys(ctx.rules.get(f.rule_key)?.shape, rv.params);
  const wordings = [...new Set(keys.flatMap((k) => termsFor(ctx.terms, rulesetVersion, k, language)))];
  return wordings.length === 1 ? { text: wordings[0], lang: language, langName: languageName(language) } : null;
}

// ─── Building the model ───────────────────────────────────────────────────────────────────────────
const STATE_ORDER: Record<string, number> = { action: 0, not_assessed: 1, clear: 2, unchecked: 3 };

/**
 * What a model call adds to the provenance tag: its confidence, and that it abstained or was unavailable. The tag
 * itself is always the finding's own provenance value; an abstention is withheld, so it reads Not assessed.
 */
export function modelDetail(f: Pick<FixFindingRow, "confidence" | "reason_code">): string | null {
  const parts: string[] = [];
  if (f.reason_code === "model_abstained") parts.push("model abstained");
  else if (f.reason_code === "model_unavailable") parts.push("model unavailable");
  else if (f.reason_code === "model_refused") parts.push("model refused");
  if (f.confidence != null) parts.push(`confidence ${Number(f.confidence).toFixed(2)}`);
  return parts.length ? parts.join(" · ") : null;
}

function panelCaption(p: PanelRow, objects: TextObjectRow[]): string {
  const [x0, y0, x1, y1] = p.bbox_mm.map(Number);
  const size = `${Math.round(x1 - x0)} × ${Math.round(y1 - y0)} mm`;
  const read =
    p.status !== "extracted"
      ? `not read · ${(p.failure_code ?? "unreadable").replace(/_/g, " ")}`
      : objects.length === 0
        ? "no text extracted"
        : objects.some((o) => o.is_ocr)
          ? "text read by OCR"
          : "vector text extracted";
  return `Page ${p.page} · panel ${p.panel_index + 1} · ${size} · ${read}`;
}

function relBox(bbox: number[], panel: PanelRow): Box {
  const [px, py] = panel.bbox_mm.map(Number);
  const [x0, y0, x1, y1] = bbox.map(Number);
  return { x: x0 - px, y: y0 - py, w: x1 - x0, h: y1 - y0 };
}

function heading(name: string, state: FixMarket["state"], fixes: number, withheld: FixItem[], languages: string[]): FixHeading {
  const langs = joinOr(languages.map(languageName));
  const nF = fixes;
  const nN = withheld.length;
  if (state === "unchecked") {
    return { text: `${name}: not checked yet`, sub: "This market has no check on the current artwork yet.", tone: "not_assessed" };
  }
  if (nF && nN) {
    return {
      text: `${plural(nF, "fix", "fixes")} left in ${name} · ${nN} not assessed`,
      sub: `Findings on the ${langs ? `${langs} ` : ""}panel${languages.length > 1 ? "s" : ""} come first. Pins on the label match the numbers here.`,
      tone: "ink",
    };
  }
  if (nF) return { text: `${plural(nF, "fix", "fixes")} left before ${name} is label clear`, sub: "Pins on the label match the numbers here.", tone: "ink" };
  // Label clear only from the engine's own state, with nothing withheld (docs/05; CLAUDE.md 3).
  if (state === "clear" && nN === 0) {
    return {
      text: `${name} is label clear`,
      sub: `No fixes left. Every ${langs ? `${langs}-language ` : ""}panel checked for ${name}.`,
      tone: "ink",
    };
  }
  const coverageOnly = nN > 0 && withheld.every((i) => i.gapId !== null && ["not_encoded", "partially_encoded", "out_of_scope", "pending_acceptance"].includes(i.reasonCode ?? ""));
  const sub =
    nN === 0
      ? "No fixes left, but nothing here could be assessed, so this market cannot read label clear."
      : coverageOnly
        ? `No fixes left. ${nN === 1 ? "1 item isn’t" : `${nN} items aren’t`} covered by an accepted rule yet.`
        : `No fixes left. ${nN === 1 ? "1 item was" : `${nN} items were`} not assessed, so this market cannot read label clear.`;
  return { text: `${name}: not assessed`, sub, tone: "not_assessed" };
}

/** The check job each market shows: the one named in the address when it wrote checks for the market, else its latest. */
function jobFor(m: FixMarketRow, checks: CheckRow[], viewed: string | null): string | null {
  if (viewed && checks.some((c) => c.node_id === m.node_id && c.job_id === viewed)) return viewed;
  return m.last_check_job_id;
}

export function buildFix(rows: FixRows): FixModel {
  const panels = new Map(rows.panels.map((p) => [p.id, p]));
  const gaps = new Map(rows.gaps.map((g) => [g.gap_id, g]));
  const objects = new Map(rows.textObjects.map((o) => [o.id, o]));
  const objectsByPanel = new Map<string, TextObjectRow[]>();
  for (const o of rows.textObjects) {
    const list = objectsByPanel.get(o.panel_id) ?? [];
    list.push(o);
    objectsByPanel.set(o.panel_id, list);
  }
  for (const list of objectsByPanel.values()) list.sort((a, b) => (a.reading_order ?? 0) - (b.reading_order ?? 0));
  const findingsByCheck = new Map<string, FixFindingRow[]>();
  for (const f of rows.findings) {
    const list = findingsByCheck.get(f.check_id) ?? [];
    list.push(f);
    findingsByCheck.set(f.check_id, list);
  }
  const ctx = {
    rules: new Map(rows.rules.map((r) => [r.rule_key, r])),
    versions: new Map(rows.ruleVersions.map((v) => [`${v.rule_key}|${v.version}`, v])),
    members: new Map(rows.members.map((m) => [`${m.ruleset_version}|${m.rule_key}`, m.version])),
    terms: rows.terms,
  };

  let ungapped = 0;
  const markets: FixMarket[] = [...rows.markets]
    .sort((a, b) => a.node_id.localeCompare(b.node_id))
    .map((m) => {
      const job = jobFor(m, rows.checks, rows.viewedJob);
      // One check per printed panel; should a job hold two for one panel, the later one is kept.
      const byPanel = new Map<string, CheckRow>();
      for (const c of rows.checks) {
        if (!job || c.job_id !== job || c.node_id !== m.node_id) continue;
        const key = c.panel_id ?? c.language ?? c.id;
        const prev = byPanel.get(key);
        if (!prev || prev.at < c.at) byPanel.set(key, c);
      }
      const languages = m.languages ?? [];
      const judgedLanguage = (lang: string | null) => languages.length === 0 || (!!lang && languages.includes(lang));
      const checks = [...byPanel.values()].sort((a, b) => {
        const pa = a.panel_id ? panels.get(a.panel_id) : undefined;
        const pb = b.panel_id ? panels.get(b.panel_id) : undefined;
        const ja = judgedLanguage(pa?.language ?? a.language) ? 0 : 1;
        const jb = judgedLanguage(pb?.language ?? b.language) ? 0 : 1;
        return ja - jb || (pa?.page ?? 0) - (pb?.page ?? 0) || (pa?.panel_index ?? 0) - (pb?.panel_index ?? 0) || a.id.localeCompare(b.id);
      });

      // Items, panel by panel: fixes first, then the withheld ones; numbered in that order where they have a place.
      const groups: FixGroup[] = [];
      const withheld: FixItem[] = [];
      const notes: FixMarket["notes"] = [];
      const fixesByCheck = new Map<string, FixItem[]>();
      for (const c of checks) {
        const panel = c.panel_id ? panels.get(c.panel_id) : undefined;
        const lang = panel?.language ?? c.language;
        const code = (lang ?? "und").toUpperCase();
        const panelLabel = `${code} · ${languageName(lang)} panel`;
        const own = (findingsByCheck.get(c.id) ?? []).sort(
          (a, b) => (a.rule_key ?? a.gap_id ?? "").localeCompare(b.rule_key ?? b.gap_id ?? "") || a.id.localeCompare(b.id),
        );
        for (const f of own) {
          if (f.state === "info") {
            notes.push({ id: f.id, title: f.message, provenance: findingOf(f, "—", rows.workspaceId, gaps).provenance });
            continue;
          }
          const shown = findingOf(f, "—", rows.workspaceId, gaps);
          const object = f.text_object_id ? objects.get(f.text_object_id) : undefined;
          const box = panel
            ? object
              ? relBox(object.bbox_mm, panel)
              : f.bbox_mm && f.bbox_mm.length === 4
                ? relBox(f.bbox_mm.map(Number), panel)
                : null
            : null;
          const item: FixItem = {
            id: f.id,
            checkId: c.id,
            panelId: c.panel_id,
            kind: shown.state === "action" ? "fix" : "not_assessed",
            pin: null,
            missing: shown.state === "action" && !box,
            panelLabel,
            title: shown.title,
            action: shown.action,
            printed: object?.text ?? null,
            lang: lang ?? null,
            langName: lang ? languageName(lang) : null,
            provenance: shown.provenance,
            modelDetail: modelDetail(f),
            ruleKey: f.rule_key,
            citation: f.citation ?? f.rule_key,
            gapId: shown.state === "not_assessed" ? shown.gapId : null,
            gapHref: shown.state === "not_assessed" && shown.gapId !== null ? shown.gapHref : null,
            reasonCode: shown.state === "not_assessed" ? shown.reasonCode : null,
            measure: shown.measure,
            term: shown.state === "action" ? requiredTerm(f, f.language ?? lang ?? null, c.ruleset_version, ctx) : null,
            box,
          };
          if (item.kind === "fix") {
            const list = fixesByCheck.get(c.id) ?? [];
            list.push(item);
            fixesByCheck.set(c.id, list);
          } else {
            if (item.gapId === null) ungapped++;
            withheld.push(item);
          }
        }
        const fixes = fixesByCheck.get(c.id) ?? [];
        // A missing particular heads its panel's group: it has no pin, and the panel is outlined.
        fixes.sort((a, b) => Number(b.missing) - Number(a.missing));
        if (fixes.length) groups.push({ checkId: c.id, panelId: c.panel_id, title: panelLabel, open: fixes.length, items: fixes });
      }
      let n = 0;
      for (const item of [...groups.flatMap((g) => g.items), ...withheld]) if (item.box) item.pin = String(++n);

      const fixes = groups.reduce((s, g) => s + g.open, 0);
      const marketPanels: FixPanel[] = checks.flatMap((c) => {
        const panel = c.panel_id ? panels.get(c.panel_id) : undefined;
        if (!panel) return [];
        const lang = panel.language ?? c.language;
        const judged = judgedLanguage(lang);
        const readable = panel.status === "extracted";
        const items = [...(fixesByCheck.get(c.id) ?? []), ...withheld.filter((i) => i.checkId === c.id)];
        const open = (fixesByCheck.get(c.id) ?? []).length;
        const labelState = (["clear", "action", "not_assessed"] as const).find((s) => s === c.label_state) ?? "not_assessed";
        const chip: PanelChip | null = !judged
          ? null
          : !readable
            ? { state: "not_assessed", label: "Couldn’t read" }
            : open
              ? { state: "action", label: `Action needed · ${open} open` }
              : labelState === "clear" && items.length === 0
                ? { state: "clear", label: "Label clear" }
                : { state: "not_assessed", label: "Not assessed" };
        const own = objectsByPanel.get(panel.id) ?? [];
        return [
          {
            id: panel.id,
            checkId: c.id,
            code: (lang ?? "und").toUpperCase(),
            label: `${(lang ?? "und").toUpperCase()} · ${languageName(lang)}`,
            lang: lang ?? null,
            langName: languageName(lang),
            judged,
            chip,
            notLine: judged ? null : `Not a ${joinOr(languages.map(languageName))}-language panel`,
            readable,
            failureNote: readable
              ? null
              : judged
                ? `${m.name} can’t be checked on this panel until it is read. Upload a revision with live text.`
                : "Upload a revision with live text to read it.",
            caption: panelCaption(panel, own),
            widthMm: Number(panel.bbox_mm[2]) - Number(panel.bbox_mm[0]),
            heightMm: Number(panel.bbox_mm[3]) - Number(panel.bbox_mm[1]),
            objects: own.map((o) => ({ id: o.id, text: o.text, box: relBox(o.bbox_mm, panel) })),
            pins: items
              .filter((i): i is FixItem & { pin: string; box: Box } => !!i.pin && !!i.box)
              .map((i) => ({
                itemId: i.id,
                pin: i.pin,
                kind: i.kind,
                box: i.box,
                label: `${i.kind === "fix" ? "Finding" : "Not assessed item"} ${i.pin}: ${i.title}`,
              })),
            missing: items.some((i) => i.missing),
          },
        ];
      });

      const first = checks[0];
      const state: FixMarket["state"] = checks.length
        ? checks.map((c) => (["clear", "action", "not_assessed"] as const).find((s) => s === c.label_state) ?? "not_assessed").sort((a, b) => STATE_ORDER[a] - STATE_ORDER[b])[0]
        : "unchecked";
      // The engine's state is the floor: a fix makes the market action, and anything withheld keeps it from clear.
      const shownState: FixMarket["state"] =
        state === "unchecked" ? state : fixes > 0 ? "action" : state === "clear" && withheld.length > 0 ? "not_assessed" : state;
      const rulesetVersion = first?.ruleset_version ?? null;
      return {
        nodeId: m.node_id,
        code: nodeCode(m.node_id),
        name: m.name,
        languages,
        state: shownState,
        panels: marketPanels,
        groups,
        notAssessed: withheld,
        notes,
        fixes,
        heading: heading(m.name, shownState, fixes, withheld, languages),
        jobId: checks.length ? (job ?? null) : null,
        rulesetVersion,
        rulesetCurrent: !!rulesetVersion && rulesetVersion === rows.currentRuleset,
        artworkSha: first?.artwork_sha ?? null,
        artworkVersionId: first?.artwork_version_id ?? null,
        checkedAt: first ? checks.map((c) => c.at).sort()[checks.length - 1] : null,
        superseded: !!job && !!m.last_check_job_id && job !== m.last_check_job_id,
      };
    });

  const ordered = [...markets].sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state]);
  return {
    markets,
    initialMarket: ordered[0]?.nodeId ?? null,
    activeJobId: rows.activeJob?.id ?? null,
    ungapped,
  };
}

/** The banner a market shows, at most one, in this order: a check in flight, a newer result, an older ruleset. */
export function bannerFor(
  m: FixMarket,
  ctx: { workspaceId: string; productId: string; activeJob: ActiveJobRow | null; currentRuleset: string | null },
): FixBanner | null {
  const base = `/w/${ctx.workspaceId}/products/${ctx.productId}`;
  if (ctx.activeJob && !m.superseded) {
    const revision = !!ctx.activeJob.artwork_version_id && ctx.activeJob.artwork_version_id !== m.artworkVersionId;
    return {
      kind: "rechecking",
      title: revision ? "Revision uploaded." : "A check is running.",
      text: revision
        ? "The new artwork is being checked. Pins turn clear only when that check passes."
        : "These results stay until it finishes. Pins turn clear only when a check passes.",
      href: `${base}/checks/${ctx.activeJob.id}`,
    };
  }
  if (m.superseded) {
    return { kind: "superseded", title: "A newer result exists.", text: "This one is read-only.", href: `${base}/report` };
  }
  if (m.rulesetVersion && ctx.currentRuleset && m.rulesetVersion !== ctx.currentRuleset) {
    return {
      kind: "older",
      title: `Checked against ruleset ${m.rulesetVersion}.`,
      text: `The current ruleset is ${ctx.currentRuleset}.`,
      current: ctx.currentRuleset,
    };
  }
  return null;
}
