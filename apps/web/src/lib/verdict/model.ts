// S-MOB-003 The verdict (Mobile design, "Read a verdict"): one product in one market, as a phone reads it. The state
// with its glyph, the one thing to do next, and where the answer came from. Pure, so its must-holds are tested
// without a database:
// - the state is the database's: app.product_nodes.display_state, rolled up by app.rollup_state for a parent node
//   (BE-15: a parent never conceals a failing child), so an unknown registration never reads Clear (BE-14);
// - Clear is shown only when every market it covers has a latest check job whose checks are all clear; anything less
//   is withheld as Not assessed (no rule, no verdict), never guessed;
// - every Not assessed names its coverage gap when the finding carries one (docs/04 contract 4);
// - the answer carries its provenance and is pinned to its ruleset and artwork hash (CLAUDE.md non-negotiable 5).
import { PROVENANCE_LABEL, type Provenance, type VerdictState } from "@/components/kit/states";
import { gapHref, nodeCode } from "@/lib/report/model";

export type NodeRow = {
  node_id: string;
  label_state: string;
  registration_state: string;
  display_state: string | null;
  open_actions: number;
  last_check_job_id: string | null;
};
export type JurisdictionRow = { id: string; name: string; parent_id: string | null };
export type VerdictCheckRow = {
  id: string;
  job_id: string | null;
  node_id: string;
  label_state: string;
  ruleset_version: string;
  artwork_sha: string | null;
  at: string;
};
export type VerdictFindingRow = {
  id: string;
  check_id: string;
  node_id: string;
  rule_key: string | null;
  gap_id: string | null;
  state: string;
  kind: string;
  provenance: string;
  citation: string | null;
  message: string;
  recommended_action: string | null;
  confidence: number | null;
};
export type VerdictGapRow = { gap_id: string; node_id: string };

export type VerdictRows = {
  workspaceId: string;
  productId: string;
  nodeId: string;
  /** The node itself and its children, as ref.jurisdictions names them. */
  jurisdictions: JurisdictionRow[];
  /** The product's rows for the node and its children (app.product_nodes). */
  nodes: NodeRow[];
  /** app.rollup_state(product, node): the database's roll-up. */
  rollup: string | null;
  checks: VerdictCheckRow[];
  findings: VerdictFindingRow[];
  gaps: VerdictGapRow[];
  currentRuleset: string | null;
};

export type VerdictLink = { label: string; href: string };

export type VerdictSource =
  | { kind: "rule"; provenance: Exclude<Provenance, "not_assessed">; ruleKey: string; citation: string; note: string }
  | { kind: "gap"; gapId: string; href: string; note: string }
  | { kind: "ungapped"; note: string }
  | { kind: "registration"; note: string }
  | { kind: "none"; note: string };

export type Verdict = {
  nodeId: string;
  /** The market's short code for the phone's chrome (US · TX, EU · DE). */
  chrome: string;
  nodeName: string;
  state: VerdictState;
  /** The market the state comes from: the node itself, or the child that sets a parent's roll-up. */
  subject: { nodeId: string; name: string; isSelf: boolean; href: string };
  title: string;
  body: string;
  todo: { body: string; link: VerdictLink | null };
  source: VerdictSource;
  pinned: { rulesetVersion: string; rulesetCurrent: boolean; artworkSha: string | null; checkedAt: string } | null;
  reportHref: string;
};

export class VerdictShapeError extends Error {
  constructor(message: string) {
    super(`verdict: ${message}`);
    this.name = "VerdictShapeError";
  }
}

const RANK: Record<VerdictState, number> = { blocked: 3, action: 2, not_assessed: 1, clear: 0 };

function asState(s: string | null): VerdictState {
  if (s === "clear" || s === "action" || s === "not_assessed" || s === "blocked") return s;
  return "not_assessed"; // anything the vocabulary does not know is withheld, never shown as a verdict
}

const PROVENANCE_ORDER = ["deterministic_rule", "authored_definition", "model_judgement"] as const;

function isAssessedProvenance(p: string): p is Exclude<Provenance, "not_assessed"> {
  return (PROVENANCE_ORDER as readonly string[]).includes(p);
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function buildVerdict(rows: VerdictRows): Verdict | null {
  const { workspaceId, productId, nodeId } = rows;
  const names = new Map(rows.jurisdictions.map((j) => [j.id, j.name]));
  const self = rows.jurisdictions.find((j) => j.id === nodeId);
  if (!self) return null;
  const covered = rows.nodes.filter((n) => n.node_id === nodeId || rows.jurisdictions.some((j) => j.id === n.node_id && j.parent_id === nodeId));
  if (!covered.length) return null;

  const base = `/w/${workspaceId}/products/${productId}`;
  const reportHref = `${base}/report`;

  // The latest job's checks per market: only those decide, never an older job's (the report's rule, T-404).
  const latest = (n: NodeRow) => (n.last_check_job_id ? rows.checks.filter((c) => c.node_id === n.node_id && c.job_id === n.last_check_job_id) : []);
  const own = (n: NodeRow) => asState(n.display_state);

  // The database's roll-up is the state. A row the roll-up did not see would be a shape error, not a better answer.
  let state = asState(rows.rollup);
  const worst = covered.reduce((w, n) => Math.max(w, RANK[own(n)]), 0);
  if (RANK[state] < worst) throw new VerdictShapeError(`roll-up ${rows.rollup} is better than a covered market`);
  // No rule, no verdict: Clear needs a latest check job, all clear, behind every market it covers.
  const clearBacked = covered.every((n) => {
    const cs = latest(n);
    return cs.length > 0 && cs.every((c) => c.label_state === "clear");
  });
  if (state === "clear" && !clearBacked) state = "not_assessed";

  // The market the state comes from: the node itself when it carries the state, else the first child that does.
  const subjectRow =
    covered.find((n) => n.node_id === nodeId && own(n) === state) ??
    covered.filter((n) => n.node_id !== nodeId).sort((a, b) => a.node_id.localeCompare(b.node_id)).find((n) => own(n) === state) ??
    covered.find((n) => n.node_id === nodeId) ??
    covered[0];
  const subjectName = names.get(subjectRow.node_id) ?? subjectRow.node_id;
  const subject = {
    nodeId: subjectRow.node_id,
    name: subjectName,
    isSelf: subjectRow.node_id === nodeId,
    href: `${base}/nodes/${encodeURIComponent(subjectRow.node_id)}`,
  };

  const checks = latest(subjectRow);
  const checkIds = new Set(checks.map((c) => c.id));
  const findings = rows.findings.filter((f) => checkIds.has(f.check_id));
  const actions = findings.filter((f) => f.state === "action");
  const withheld = findings.filter((f) => f.state === "not_assessed");
  const gapNode = new Map(rows.gaps.map((g) => [g.gap_id, g.node_id]));

  const pinnedCheck = [...checks].sort((a, b) => b.at.localeCompare(a.at))[0];
  const pinned = pinnedCheck
    ? {
        rulesetVersion: pinnedCheck.ruleset_version,
        rulesetCurrent: rows.currentRuleset === pinnedCheck.ruleset_version,
        artworkSha: pinnedCheck.artwork_sha,
        checkedAt: pinnedCheck.at,
      }
    : null;

  const because = subject.isSelf ? "" : ` ${self.name} shows it because ${subjectName} does: a market never hides a failing one inside it.`;
  const chrome = self.parent_id ? `${nodeCode(self.parent_id)} · ${nodeCode(self.id)}` : nodeCode(self.id);
  const common = { nodeId, chrome, nodeName: self.name, state, subject, pinned, reportHref };
  const registrationHref = `${base}/nodes/${encodeURIComponent(subjectRow.node_id)}/registration`;
  const reportLink: VerdictLink = { label: "Open the label report", href: reportHref };

  if (state === "blocked") {
    const label =
      subjectRow.label_state === "clear"
        ? "The label passes every encoded rule."
        : subjectRow.label_state === "action"
          ? `The label also has ${plural(Math.max(subjectRow.open_actions, actions.length), "open action")}.`
          : "The label is not fully assessed.";
    const registration =
      subjectRow.registration_state === "expired"
        ? `The product's registration in ${subjectName} has expired.`
        : `The product is not registered in ${subjectName}.`;
    const ruled = findings.find((f) => f.kind === "registration" && f.rule_key && isAssessedProvenance(f.provenance));
    return {
      ...common,
      title: `Cannot be sold in ${subjectName}`,
      body: `${label} ${registration}${because}`,
      todo: {
        body:
          subjectRow.registration_state === "expired"
            ? "Renew the registration. The registration pack lists what it needs and what your record already answers."
            : "Register the product. The registration pack lists what it needs and what your record already answers.",
        link: { label: "Open the registration pack", href: registrationHref },
      },
      source: ruled
        ? ruleSource(ruled)
        : { kind: "registration", note: `The registration state recorded for this product: ${subjectRow.registration_state.replace("_", " ")}. Not a model judgement.` },
    };
  }

  if (state === "action") {
    const first = actions.find((f) => f.rule_key && isAssessedProvenance(f.provenance));
    if (!first) throw new VerdictShapeError(`${subjectRow.node_id} is action with no action finding behind it`);
    const more = actions.length > 1 ? ` ${plural(actions.length - 1, "more finding")} on the label report.` : "";
    return {
      ...common,
      title: `Action needed in ${subjectName}`,
      body: `${first.message}${more}${because}`,
      todo: { body: first.recommended_action ?? "The label report shows the finding on the artwork.", link: reportLink },
      source: ruleSource(first),
    };
  }

  if (state === "not_assessed") {
    if (!checks.length) {
      return {
        ...common,
        title: `Not assessed in ${subjectName}`,
        body: `No check has run on this product in ${subjectName} yet, so there is no verdict.${because}`,
        todo: { body: "Run a check at a desk: upload the artwork and choose its markets.", link: { label: "Upload & scope", href: `${base}/check` } },
        source: { kind: "none", note: "No check yet, so nothing to cite." },
      };
    }
    const gapped = withheld.find((f) => f.gap_id);
    if (!withheld.length && subjectRow.label_state === "clear") {
      return {
        ...common,
        title: `Not assessed in ${subjectName}`,
        body: `The label passes every encoded rule, but no registration state is recorded for ${subjectName}, so this is not Clear.${because}`,
        todo: { body: "Record the registration, or that none is needed, at a desk.", link: { label: "Open the registration pack", href: registrationHref } },
        source: { kind: "registration", note: "The registration state recorded for this product: unknown. Unknown is never shown as Clear." },
      };
    }
    return {
      ...common,
      title: `Not assessed in ${subjectName}`,
      body: `${plural(withheld.length, "result")} ${withheld.length === 1 ? "is" : "are"} withheld because what applies here is not fully encoded. Nothing is Clear until it is.${because}`,
      todo: gapped
        ? { body: "Nothing to change on the label for these yet. The coverage page says what is not encoded.", link: { label: "See what is not covered", href: gapHref(workspaceId, gapNode.get(gapped.gap_id!) ?? gapped.node_id, gapped.gap_id!) } }
        : { body: "The label report lists every withheld result.", link: reportLink },
      source: gapped
        ? { kind: "gap", gapId: gapped.gap_id!, href: gapHref(workspaceId, gapNode.get(gapped.gap_id!) ?? gapped.node_id, gapped.gap_id!), note: "Not assessed. No rule, no verdict." }
        : { kind: "ungapped", note: "Not assessed, and no coverage gap was recorded for it. Never shown as Clear." },
    };
  }

  // Clear: backed by a latest job of clear checks for every covered market.
  const applied = checks.length;
  return {
    ...common,
    title: `Clear in ${subjectName}`,
    body: `The label passes every encoded rule and the registration is ${subjectRow.registration_state === "registered" ? "recorded" : "not required"}.`,
    todo: { body: "Nothing to do.", link: reportLink },
    source: { kind: "none", note: `${PROVENANCE_LABEL.deterministic_rule} · ${plural(applied, "check")} against the ruleset below.` },
  };
}

function ruleSource(f: VerdictFindingRow): VerdictSource {
  const provenance = f.provenance as Exclude<Provenance, "not_assessed">;
  const note =
    provenance === "model_judgement"
      ? `A model judgement${f.confidence != null ? `, confidence ${Math.round(f.confidence * 100)}%` : ""}, made against the rule.`
      : "Not a model judgement.";
  return { kind: "rule", provenance, ruleKey: f.rule_key!, citation: f.citation ?? f.rule_key!, note };
}
