import type { CSSProperties, MouseEventHandler, ReactNode } from "react";
import { Button, ButtonLink } from "./Button";
import { Blueprint } from "./Panel";
import { cx } from "./states";

// Nutrivo Empty and Error States: every state is built from four parts (a mark, what is true, one action, a
// reference) and is one of three kinds. The marks borrow the verdict grammar but are drawn differently and are never
// used on a results surface, where those glyphs mean a verdict.
export type PatternKind = "none" | "action" | "blocked";

const MARK: Record<PatternKind, CSSProperties> = {
  none: { width: 11, height: 11, border: "2px solid var(--none)", borderRadius: "50%" },
  action: {
    width: 0, height: 0,
    borderLeft: "6px solid transparent", borderRight: "6px solid transparent", borderBottom: "11px solid var(--action)",
  },
  blocked: {
    width: 11, height: 11, background: "var(--blocked)",
    boxShadow: "inset 0 4px 0 var(--paper), inset 0 -4px 0 var(--blocked)",
  },
};

export const PATTERN_TAG: Record<PatternKind, string> = {
  none: "NOTHING YET",
  action: "SOMETHING NEEDED",
  blocked: "SOMETHING FAILED",
};

export const PATTERN_TEXT: Record<PatternKind, string> = { none: "text-na", action: "text-action", blocked: "text-blocked" };
const EDGE_LEFT: Record<PatternKind, string> = {
  none: "border-l-4 border-l-na",
  action: "border-l-4 border-l-action",
  blocked: "border-l-4 border-l-blocked",
};

export function PatternMark({ kind }: { kind: PatternKind }) {
  return <span aria-hidden="true" data-mark={kind} className="block flex-none" style={MARK[kind]} />;
}

export type StateAction = {
  label: string;
  /** primary for the one thing to do; secondary where the action is optional. */
  variant?: "primary" | "secondary";
} & ({ href: string; onClick?: never } | { onClick: MouseEventHandler<HTMLButtonElement>; href?: never });

type PatternStateProps = {
  /** Where the state appears, in mono caps (e.g. "FIRST RUN · HOME"). */
  where?: string;
  /** What is true, in the present tense. */
  title: string;
  body: ReactNode;
  /** Exactly one action. Omit it only where the person cannot act; then `aside` names who can. */
  action?: StateAction;
  /** The text beside the action: the second route, a count, or who can act. */
  aside?: ReactNode;
  /** Where an answer was withheld or a rule was involved: the coverage node or the rule that explains it. */
  reference?: { href: string; label: string };
  className?: string;
};

function PatternState({ kind, where, title, body, action, aside, reference, className }: PatternStateProps & { kind: PatternKind }) {
  return (
    <Blueprint edge={EDGE_LEFT[kind]} className={cx("py-[18px] px-[20px]", className)}>
      <div role={kind === "blocked" ? "alert" : "status"} data-pattern={kind}>
        <div className="flex items-center justify-between gap-[12px]">
          <div className="flex items-center gap-[9px]">
            <PatternMark kind={kind} />
            <span className={cx("font-mono text-[9.5px] tracking-[0.07em]", PATTERN_TEXT[kind])}>{PATTERN_TAG[kind]}</span>
          </div>
          {where ? <span className="font-mono text-[9.5px] tracking-[0.06em] text-n600">{where}</span> : null}
        </div>
        <p className="mt-[11px] mb-0 text-[15px] font-semibold leading-[1.25]">{title}</p>
        <p className="mt-[7px] mb-0 text-[13px] leading-[1.55] text-n700">{body}</p>
        {reference ? (
          <p className="mt-[9px] mb-0 font-mono text-[10.5px]">
            <a href={reference.href} className="kit-transition">
              {reference.label} →
            </a>
          </p>
        ) : null}
        {action || aside ? (
          <div className="mt-[13px] flex items-center gap-[10px] flex-wrap">
            {action ? (
              action.href !== undefined ? (
                <ButtonLink href={action.href} variant={action.variant ?? "secondary"}>
                  {action.label}
                </ButtonLink>
              ) : (
                <Button onClick={action.onClick} variant={action.variant ?? "secondary"}>
                  {action.label}
                </Button>
              )
            ) : null}
            <span className="text-[12px] text-n600">{aside}</span>
          </div>
        ) : null}
      </div>
    </Blueprint>
  );
}

/** Nothing has happened yet (kind none), or something is needed from somebody (kind action). Never an apology. */
export function EmptyState({ kind = "none", ...props }: PatternStateProps & { kind?: "none" | "action" }) {
  return <PatternState kind={kind} {...props} />;
}

/** Something failed: specific about what did not happen, and never losing what was done. */
export function ErrorState(props: PatternStateProps) {
  return <PatternState kind="blocked" {...props} />;
}

/**
 * The person's role does not allow this. Something is needed from somebody else, so the state names who can act
 * (aside) rather than offering a button the person cannot use.
 */
export function NoPermissionState(props: Omit<PatternStateProps, "action"> & { aside: ReactNode }) {
  return <PatternState kind="action" {...props} />;
}

/** Loading, queued or checking: neutral with a mono label, never the accent (Cobalt §6: no blue fifth state). */
export function LoadingState({ label = "LOADING", children }: { label?: string; children?: ReactNode }) {
  return (
    <div role="status" aria-busy="true" className="py-[18px] px-[20px] border border-rule bg-paper">
      <span className="font-mono text-[10px] tracking-[0.1em] uppercase text-n600">{label}</span>
      {children ? <p className="mt-[7px] mb-0 text-[13px] leading-[1.55] text-n700">{children}</p> : null}
    </div>
  );
}
