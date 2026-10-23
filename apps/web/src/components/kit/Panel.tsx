import type { ReactNode } from "react";
import { cx } from "./states";

/** A panel (Cobalt §5): 1px --rule border, 3px radius, a --panel header in 600 weight. */
export function Panel({
  title,
  aside,
  children,
  className,
}: {
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("border border-rule rounded-control overflow-hidden bg-paper", className)}>
      <header className="flex items-baseline gap-[10px] py-[9px] px-[12px] bg-panel border-b border-rule">
        <h3 className="m-0 flex-1 text-[13.5px] font-semibold tracking-[-0.02em]">{title}</h3>
        {aside ? <span className="font-mono text-[10.5px] text-n600">{aside}</span> : null}
      </header>
      <div className="py-[11px] px-[12px]">{children}</div>
    </section>
  );
}

/**
 * The blueprint frame the design files draw cards in: a 1px ink border with registration marks outside each corner,
 * and an optional 3 or 4px edge in a state colour on one side.
 */
export function Blueprint({
  edge,
  children,
  className,
  as: Tag = "div",
}: {
  /** Literal classes for the coloured edge, e.g. "border-l-4 border-l-action". */
  edge?: string;
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article";
}) {
  return (
    <Tag className={cx("blueprint border border-ink bg-paper", edge, className)}>
      <i className="corner tl" />
      <i className="corner tr" />
      <i className="corner bl" />
      <i className="corner br" />
      {children}
    </Tag>
  );
}

/** A section heading with its rule (Nutrivo 2.0): heading, optional mono note, 1px ink underline. */
export function SectionHeading({ children, note, level = 2 }: { children: ReactNode; note?: ReactNode; level?: 2 | 3 }) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <div className="flex items-baseline gap-[12px] border-b border-ink pb-[6px]">
      <H className="m-0 font-head text-[17px] font-semibold">{children}</H>
      {note ? <span className="font-mono text-[10.5px] text-n600">{note}</span> : null}
    </div>
  );
}
