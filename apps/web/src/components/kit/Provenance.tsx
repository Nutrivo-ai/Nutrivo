import { cx, PROVENANCE_LABEL, type Provenance } from "./states";

/**
 * Where a result came from (docs/03 check_findings.provenance). Typographic only (Cobalt §6 rule 3): mono caps in a
 * neutral, never the accent and never a verdict colour.
 */
export function ProvenanceTag({ provenance, className }: { provenance: Provenance; className?: string }) {
  return (
    <span data-provenance={provenance} className={cx("font-mono uppercase tracking-[0.06em] text-n600", className)}>
      {PROVENANCE_LABEL[provenance]}
    </span>
  );
}

/**
 * The rule a result applies: its citation in mono (a regulation is named in mono, Cobalt §3) and its rule_key. With
 * an href it is a link to the rule; links are the one place the accent may appear on a results surface.
 */
export function CitationLink({
  ruleKey,
  citation,
  href,
  className,
}: {
  ruleKey: string;
  citation: string;
  href?: string;
  className?: string;
}) {
  const classes = cx("font-mono", className);
  if (href) {
    return (
      <a href={href} data-rule-key={ruleKey} className={cx(classes, "kit-transition")}>
        {citation}
      </a>
    );
  }
  return (
    <span data-rule-key={ruleKey} className={cx(classes, "text-n600")}>
      {citation}
    </span>
  );
}

/**
 * The coverage gap that explains a Not assessed result (docs/04 contract 4). Every Not assessed shows one: the gap id
 * in mono, and a link to the coverage node that names it.
 */
export function GapLink({ gapId, href, className }: { gapId: string; href: string; className?: string }) {
  return (
    <span data-gap-id={gapId} className={cx("inline-flex flex-wrap gap-x-[8px] font-mono", className)}>
      <span className="text-n600">GAP {gapId}</span>
      <a href={href} className="kit-transition">
        WHY IS THIS NOT ASSESSED<span className="sr-only"> (gap {gapId})</span> →
      </a>
    </span>
  );
}
