"use client";

import { useCallback, type KeyboardEvent, type ReactNode } from "react";

/**
 * The matrix's keyboard (S-MTX-001): a roving tabindex over the server-rendered grid. One cell is in the tab order;
 * arrow keys move to the next cell that can be opened in that direction (an inert cell, "Not a market for this
 * product", or a disabled one outside the plan is skipped), Home and End go to the first and last in the row, Enter
 * follows the focused link. The cells stay server-rendered, so a 50 × 30 grid is not shipped twice (issue 311).
 */
export function GridKeys({
  label,
  rowCount,
  colCount,
  density,
  className,
  children,
}: {
  label: string;
  rowCount: number;
  colCount: number;
  density: "comfortable" | "compact";
  className?: string;
  children: ReactNode;
}) {
  const move = useCallback((grid: HTMLElement, from: HTMLElement, to: HTMLElement | null) => {
    if (!to || to === from) return;
    grid.querySelectorAll<HTMLElement>("[data-nav][tabindex='0']").forEach((el) => el.setAttribute("tabindex", "-1"));
    to.setAttribute("tabindex", "0");
    to.focus();
  }, []);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const from = (e.target as HTMLElement).closest<HTMLElement>("[data-nav]");
      if (!from || e.altKey || e.metaKey) return;
      const grid = e.currentTarget;
      const r = Number(from.dataset.r);
      const c = Number(from.dataset.c);
      const at = (rr: number, cc: number) => grid.querySelector<HTMLElement>(`[data-nav][data-r="${rr}"][data-c="${cc}"]`);
      const inRow = () => [...grid.querySelectorAll<HTMLElement>(`[data-nav][data-r="${r}"]`)];
      const step = (dr: number, dc: number) => {
        for (let rr = r + dr, cc = c + dc; rr >= 0 && rr < rowCount && cc >= 0 && cc < colCount; rr += dr, cc += dc) {
          const el = at(rr, cc);
          if (el) return el;
        }
        return null;
      };
      let to: HTMLElement | null;
      if (e.key === "ArrowDown") to = step(1, 0);
      else if (e.key === "ArrowUp") to = step(-1, 0);
      else if (e.key === "ArrowRight") to = step(0, 1);
      else if (e.key === "ArrowLeft") to = step(0, -1);
      else if (e.key === "Home") to = e.ctrlKey ? grid.querySelector<HTMLElement>("[data-nav]") : (inRow()[0] ?? null);
      else if (e.key === "End") to = e.ctrlKey ? ([...grid.querySelectorAll<HTMLElement>("[data-nav]")].at(-1) ?? null) : (inRow().at(-1) ?? null);
      else return;
      e.preventDefault();
      move(grid, from, to);
    },
    [colCount, move, rowCount],
  );

  // A click or a Tab into the grid makes the focused cell the one Tab returns to.
  const onFocus = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>("[data-nav]");
    if (!cell || cell.getAttribute("tabindex") === "0") return;
    e.currentTarget.querySelectorAll<HTMLElement>("[data-nav][tabindex='0']").forEach((el) => el.setAttribute("tabindex", "-1"));
    cell.setAttribute("tabindex", "0");
  }, []);

  return (
    <div
      role="grid"
      aria-label={label}
      aria-rowcount={rowCount + 1}
      aria-colcount={colCount}
      data-region="grid"
      data-density={density}
      className={className}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
    >
      {children}
    </div>
  );
}
