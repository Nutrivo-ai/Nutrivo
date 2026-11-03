// D09: coverage for a product, in the app (S-NV2-013 Coverage & confidence, S-NV2-021 Coverage node). The rows are
// ref.coverage_nodes, the table the engine queries at check time and public.coverage_snapshot() publishes (BE-10).
// Every node is shaped by the public page's own shapeCoverage, so a node reads the same here as on /coverage: the
// same six domains, the same counts, the same depth, the same gap ids, and a domain with no row is Not encoded.
import { DOMAINS, DOMAIN_LABEL, shapeCoverage, type Domain, type DomainState, type NodeCoverage, type SnapshotRow } from "@/lib/public/coverage";

export type GapRow = {
  gap_id: string;
  node_id: string;
  domain: string;
  reason_code: string;
  description: string;
  opened_in: string | null;
  closed_in: string | null;
};

/** The design's short column heads, one per coverage domain (the design's five are placeholders, #55 q3). */
export const DOMAIN_SHORT: Record<Domain, string> = {
  mandatory_particulars: "Particulars",
  composition: "Composition",
  claims_wording: "Claims",
  type_geometry: "Type size",
  language: "Language",
  registration: "Registration",
};

export const domainLabel = (domain: string) => DOMAIN_LABEL[domain as Domain] ?? domain;

/** How a domain was encoded, as the design prints it in mono caps under its count. */
export function methodLabel(method: string, state: DomainState): string {
  if (state === "not_encoded" || !method) return "NOT ENCODED";
  if (method === "machine_extraction_person_accepted") return "PERSON-ACCEPTED";
  return method.replace(/_/g, " ").toUpperCase();
}

export const STATE_WORD: Record<DomainState, string> = { complete: "Complete", partial: "Partial", not_encoded: "Not encoded" };
export const STATE_COLOR: Record<DomainState, string> = { complete: "text-clear", partial: "text-action", not_encoded: "text-na" };
export const STATE_EDGE: Record<DomainState, string> = { complete: "border-t-clear", partial: "border-t-action", not_encoded: "border-t-na" };

/** The three node states, in the public page's own words (S-COV-001), so the two never disagree. */
export const NODE_STATES: { state: DomainState; k: string; v: string }[] = [
  { state: "complete", k: "COMPLETE", v: "Every domain we check is encoded. Nothing is withheld for want of a rule, and every domain returns an answer." },
  { state: "partial", k: "PARTIAL", v: "Some domains encoded, the excluded ones named. A result in an excluded domain returns Not assessed, citing the gap." },
  { state: "not_encoded", k: "NOT ENCODED", v: "We hold no rules. No verdict is offered and the node can never render Clear." },
];

export type CoverageGap = { id: string; domain: string; description: string; openedIn: string | null };

export type CoverageRow = {
  nodeId: string;
  name: string;
  /** The ruleset this row is read at: the market's pinned ruleset, or the latest release when it has none. */
  rulesetVersion: string | null;
  pinned: boolean;
  node: NodeCoverage;
  gaps: CoverageGap[];
};

const toGap = (id: string, gaps: Map<string, GapRow>, fallbackDomain: string): CoverageGap => {
  const g = gaps.get(id);
  return { id, domain: g?.domain ?? fallbackDomain, description: g?.description ?? "", openedIn: g?.opened_in ?? null };
};

/** One node at one ruleset, exactly as the public page shapes it. */
export function nodeAt(nodeId: string, rulesetVersion: string | null, rows: SnapshotRow[]): NodeCoverage {
  const own = rows.filter((r) => r.node_id === nodeId);
  const shaped = shapeCoverage({ ruleset_version: rulesetVersion, nodes: own.length ? own : DOMAINS.map((d) => missingRow(nodeId, d)) });
  return shaped.regions.flatMap((r) => r.nodes).find((n) => n.id === nodeId)!;
}

const missingRow = (node_id: string, domain: string): SnapshotRow => ({
  node_id, domain, state: "not_encoded", rules_encoded: 0, method: "", last_checked_at: null, gap_id: null,
});

export function coverageRow(args: {
  nodeId: string;
  name: string;
  rulesetVersion: string | null;
  pinned: boolean;
  rows: SnapshotRow[];
  gaps: Map<string, GapRow>;
}): CoverageRow {
  const node = nodeAt(args.nodeId, args.rulesetVersion, args.rows);
  return {
    nodeId: args.nodeId,
    name: args.name,
    rulesetVersion: args.rulesetVersion,
    pinned: args.pinned,
    node,
    gaps: node.domains.filter((d) => d.gap_id).map((d) => toGap(d.gap_id!, args.gaps, d.domain)),
  };
}

const WORDS = ["no", "one", "two", "three", "four", "five", "six"];
const word = (n: number) => WORDS[n] ?? String(n);

/** The node's headline, in the design's form: "Poland: four domains encoded, two named as gaps." */
export function headline(name: string, node: NodeCoverage, gaps: number): string {
  const encoded = node.domainsEncoded;
  const enc = encoded === node.domains.length ? `all ${word(encoded)} domains encoded` : `${word(encoded)} domain${encoded === 1 ? "" : "s"} encoded`;
  if (gaps === 0) return `${name}: ${enc}, no gaps named.`;
  return `${name}: ${enc}, ${word(gaps)} named as ${gaps === 1 ? "a gap" : "gaps"}.`;
}

/** The public page's address for a node (S-COV-001 reads ?region and ?node). */
export function publicHref(nodeId: string): string {
  return `/coverage?region=${encodeURIComponent(nodeId.split("-")[0])}&node=${encodeURIComponent(nodeId)}#node`;
}

export function nodeHref(workspaceId: string, nodeId: string, rulesetVersion?: string | null): string {
  const base = `/w/${workspaceId}/library/coverage/${encodeURIComponent(nodeId)}`;
  return rulesetVersion ? `${base}?ruleset=${encodeURIComponent(rulesetVersion)}` : base;
}
