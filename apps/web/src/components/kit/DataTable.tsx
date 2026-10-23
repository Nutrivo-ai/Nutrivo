import type { ReactNode } from "react";
import { LoadingState } from "./PatternState";
import { cx } from "./states";

export type Column<Row> = {
  key: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  align?: "left" | "center" | "right";
  /** A CSS width, e.g. "27%". */
  width?: string;
  /** Cells that hold their own padding (a StateCell or a row button). */
  flush?: boolean;
  /** Classes for one cell, e.g. a state tint behind a StateCell (stateTint). */
  cellClass?: (row: Row) => string | undefined;
};

const ALIGN = { left: "text-left", center: "text-center", right: "text-right" } as const;

/**
 * A table as Nutrivo 2.0 draws the board and coverage tables: mono caps headers over a 1px ink rule, 1px --rule row
 * separators, radius 0 and tabular figures (Cobalt §3, §5). Every state a screen can be in renders inside the table
 * frame, so the headers stay put: loading, error, no permission, empty, loaded (in that order of precedence).
 */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  loading = false,
  error,
  noPermission,
  empty,
  className,
}: {
  /** Names the table for assistive technology; screens usually show it as a SectionHeading too. */
  caption: string;
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  loading?: boolean;
  /** An ErrorState; shown instead of the rows. */
  error?: ReactNode;
  /** A NoPermissionState; shown instead of the rows. */
  noPermission?: ReactNode;
  /** An EmptyState, shown when there are no rows. Required: every table says what an empty table means. */
  empty: ReactNode;
  className?: string;
}) {
  const replacement = loading ? <LoadingState /> : (error ?? noPermission ?? (rows.length === 0 ? empty : null));
  return (
    <table className={cx("w-full border-collapse tabular-nums", className)} aria-busy={loading || undefined}>
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          {columns.map((column, i) => (
            <th
              key={column.key}
              scope="col"
              style={column.width ? { width: column.width } : undefined}
              className={cx(
                "font-mono text-[9.5px] tracking-[0.1em] uppercase font-normal text-n600 border-b border-ink py-[9px]",
                ALIGN[column.align ?? "left"],
                i === 0 ? "pl-0 pr-[8px]" : "px-[8px]",
              )}
            >
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {replacement ? (
          <tr>
            <td colSpan={columns.length} className="pt-[18px] pb-[6px] px-[6px]">
              {replacement}
            </td>
          </tr>
        ) : (
          rows.map((row) => (
            <tr key={rowKey(row)} className="h-[40px]">
              {columns.map((column, i) => (
                <td
                  key={column.key}
                  className={cx(
                    "border-b border-rule text-[13.5px] align-middle",
                    ALIGN[column.align ?? "left"],
                    i > 0 && column.flush ? "border-l border-l-n200" : null,
                    column.flush ? "p-0" : i === 0 ? "py-[10px] pl-0 pr-[8px]" : "py-[10px] px-[8px]",
                    column.cellClass?.(row),
                  )}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
