import type { ReactNode } from "react";
import { CitationLink, GapLink, ProvenanceTag } from "./Provenance";
import { StateBadge } from "./StateBadge";
import { cx, STATE_BORDER, STATE_TEXT, STATE_TINT, type Provenance, type WithheldReason } from "./states";

type Common = {
  title: string;
  /** What to do, as one sentence. */
  action: ReactNode;
  /** The artwork pin this finding is drawn at; "—" when it has no coordinates. */
  pin?: string;
  /** Measured against required, or the count that explains the finding (mono). */
  measure?: string;
};

type RuleCitation = { ruleKey: string; citation: string; citationHref?: string };

/** A finding with a verdict: it applies a rule, so it names the rule (CLAUDE.md non-negotiables 5 and 6). */
export type AssessedFinding = Common &
  RuleCitation & {
    state: "action" | "blocked";
    provenance: Exclude<Provenance, "not_assessed">;
  };

/**
 * A withheld finding: no rule, no verdict. It always names its reason and the coverage gap behind it, and links to
 * the gap. A rule that applies but could not be evaluated (data missing, model abstained) may be cited as well; such
 * a finding can carry no gap (#46 question 4), and then it says so instead of linking, and stays Not assessed.
 */
export type WithheldFinding = Common &
  Partial<RuleCitation> &
  (
    | { state: "not_assessed"; provenance: Provenance; reasonCode: WithheldReason; gapId: string; gapHref: string }
    | { state: "not_assessed"; provenance: Provenance; reasonCode: string; gapId: null }
  );

export type FindingProps = AssessedFinding | WithheldFinding;

/** One finding row of a label report (Nutrivo 2.0, "What is missing, and what to do"). */
export function Finding(props: FindingProps) {
  const { state, title, action, pin, measure, provenance } = props;
  return (
    <div
      data-finding-state={state}
      data-reason-code={state === "not_assessed" ? props.reasonCode : undefined}
      className="border-b border-rule pt-[12px] px-[2px] pb-[13px]"
    >
      <div className="flex items-baseline gap-[9px]">
        <span
          aria-hidden="true"
          className={cx(
            "w-[18px] h-[18px] flex-none border font-mono text-[10px] flex items-center justify-center",
            STATE_BORDER[state],
            STATE_TINT[state],
            STATE_TEXT[state],
          )}
        >
          {pin ?? "—"}
        </span>
        <span className="flex-1 font-medium text-[13.5px] leading-[1.35]">{title}</span>
        <StateBadge state={state} />
      </div>
      <p className="mt-[7px] mb-0 pl-[27px] text-[13px] leading-[1.5]">{action}</p>
      <div className="mt-[7px] pl-[27px] flex flex-wrap gap-y-[5px] gap-x-[12px] font-mono text-[10px] text-n600">
        {props.ruleKey && props.citation ? (
          <CitationLink ruleKey={props.ruleKey} citation={props.citation} href={props.citationHref} />
        ) : null}
        {state === "not_assessed" ? (
          props.gapId !== null ? (
            <GapLink gapId={props.gapId} href={props.gapHref} />
          ) : (
            <span data-gap-id="" className="text-n600">
              {props.reasonCode.toUpperCase()} · NO COVERAGE GAP RECORDED
            </span>
          )
        ) : null}
        <ProvenanceTag provenance={provenance} />
        {measure ? <span>{measure}</span> : null}
      </div>
    </div>
  );
}
