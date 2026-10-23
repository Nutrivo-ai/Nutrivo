import type { CSSProperties } from "react";
import { cx, STATE_LABEL, STATE_TEXT, STATE_TINT, type VerdictState } from "./states";

type GlyphSize = "sm" | "md";

// The four glyphs as the Cobalt specification draws them (md: 12 px, the specification and legends at reading size)
// and as the Nutrivo 2.0 board draws them (sm: 9 px, table cells and finding rows). A white bar is knocked out of the
// Blocked square, so Blocked never relies on hue to separate from Clear.
const GLYPH: Record<GlyphSize, Record<VerdictState, CSSProperties>> = {
  md: {
    clear: { width: 12, height: 12, background: "var(--clear)" },
    action: {
      width: 0, height: 0,
      borderLeft: "6px solid transparent", borderRight: "6px solid transparent", borderBottom: "11px solid var(--action)",
    },
    not_assessed: { width: 11, height: 11, border: "2px solid var(--none)", borderRadius: "50%" },
    blocked: {
      width: 12, height: 12,
      background: "linear-gradient(var(--blocked) 0 5px, var(--paper) 5px 7px, var(--blocked) 7px 12px)",
    },
  },
  sm: {
    clear: { width: 9, height: 9, background: "var(--clear)" },
    action: {
      width: 0, height: 0,
      borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderBottom: "9px solid var(--action)",
    },
    not_assessed: { width: 9, height: 9, border: "1.5px solid var(--none)", borderRadius: "50%" },
    blocked: {
      width: 9, height: 9,
      background: "linear-gradient(var(--blocked) 0 3.75px, var(--paper) 3.75px 5.25px, var(--blocked) 5.25px 9px)",
    },
  },
};

/** The glyph alone. Decorative: whatever shows it also shows the state's name (StateBadge, StateCell, a legend). */
export function StateGlyph({ state, size = "md" }: { state: VerdictState; size?: GlyphSize }) {
  return (
    <span
      aria-hidden="true"
      data-glyph={state}
      className="inline-block flex-none"
      style={GLYPH[size][state]}
    />
  );
}

/**
 * A state with its glyph and its name, always both (docs/10: a state is never shown by colour alone). Not assessed
 * has the same size and weight as the other three: grey is its colour, not a de-emphasis.
 */
export function StateBadge({
  state,
  size = "sm",
  tone = "state",
  className,
}: {
  state: VerdictState;
  size?: GlyphSize;
  /** "state" sets the name in the state's colour (finding rows, tiles); "neutral" in --n700 (legends). */
  tone?: "state" | "neutral";
  className?: string;
}) {
  return (
    <span
      data-state={state}
      className={cx(
        "inline-flex items-center font-mono uppercase whitespace-nowrap",
        size === "md" ? "gap-[7px] text-[10.5px] tracking-[0.06em]" : "gap-[6px] text-[9.5px] tracking-[0.07em]",
        tone === "state" ? STATE_TEXT[state] : "text-n700",
        className,
      )}
    >
      <StateGlyph state={state} size={size} />
      {STATE_LABEL[state]}
    </span>
  );
}

/** The tint behind a board cell, for the table cell that holds a StateCell (Column.cellClass). */
export function stateTint(state: VerdictState): string {
  return STATE_TINT[state];
}

/**
 * A board cell: glyph and an optional count (open actions), on its state's tint (set on the table cell with
 * stateTint). The name is carried for assistive technology; the legend under the table names the glyphs.
 */
export function StateCell({ state, count }: { state: VerdictState; count?: number | string }) {
  return (
    <span data-state={state} className="flex flex-col items-center justify-center gap-[5px] py-[10px] px-[4px]">
      <StateGlyph state={state} size="sm" />
      <span className={cx("block font-mono text-[10px] leading-none min-h-[10px]", STATE_TEXT[state])}>
        {count ?? ""}
      </span>
      <span className="sr-only">{STATE_LABEL[state]}</span>
    </span>
  );
}

/** The legend under a board (Nutrivo 2.0): every glyph with its name. */
export function StateLegend({ states = ["clear", "action", "not_assessed", "blocked"] }: { states?: VerdictState[] }) {
  return (
    <span className="flex items-center gap-[22px] flex-wrap">
      {states.map((state) => (
        <span
          key={state}
          data-state={state}
          className="flex items-center gap-[7px] font-mono text-[10.5px] tracking-[0.06em] uppercase text-n700"
        >
          <StateGlyph state={state} size="sm" />
          {STATE_LABEL[state]}
        </span>
      ))}
    </span>
  );
}
