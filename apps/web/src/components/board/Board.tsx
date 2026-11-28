import type { CSSProperties, ReactNode } from "react";
import { EmptyState, Finding, cx } from "@/components/kit";
import {
  BOARD_PAGE,
  FINDINGS_READ_CAP,
  LABEL_TEXT,
  REGISTRATION_GLYPH,
  REGISTRATION_TEXT,
  boardHref,
  upgradeHref,
  type BoardCell,
  type BoardColumn,
  type BoardModel,
  type BoardRow,
  type LabelLine,
  type MarketCell,
  type PortfolioFinding,
  type StateFilter,
} from "@/lib/board/model";
import type { BoardPage } from "@/lib/board/queries";
import { GridKeys } from "./GridKeys";
import { MarketSelect } from "./MarketSelect";

type Loaded = Extract<BoardPage, { kind: "loaded" }>;

const MONO_KICKER = "font-mono text-[11px] text-n600 uppercase tracking-[0.06em]";
const STATE_CHIPS: [StateFilter, string][] = [
  ["action", "Action needed"],
  ["not_assessed", "Not assessed"],
  ["blocked", "Blocked"],
];

/**
 * S-MTX-001 Board as the product matrix (D-33; design: product/Nutrivo Board.dc.html and its ten state frames):
 * products by markets, each cell two lines that are never merged (the label line from label_state, the registration
 * line from registration_state, replaced only by the red Blocked chip), sticky headers, the market and state filters
 * and the density in the URL, the legend, and the open findings across the portfolio (F04, ?view=findings). At 390 px
 * each product is a card listing its markets (S-MTX-002).
 */
export function Board({ workspaceId, page }: { workspaceId: string; page: Loaded }) {
  const { board, findings, canCreate } = page;
  return (
    // leading-normal: the design sets every line at the font's own line height, not the body's 1.55.
    <div data-region="board" data-view={board.filters.view} className="flex flex-col gap-[20px] leading-normal">
      <Intro workspaceId={workspaceId} page={page} />
      {board.productCount === 0 ? (
        <Empty workspaceId={workspaceId} canCreate={canCreate} />
      ) : (
        <>
          <Toolbar workspaceId={workspaceId} board={board} />
          {findings ? (
            <Findings workspaceId={workspaceId} board={board} findings={findings} />
          ) : (
            <>
              <Matrix workspaceId={workspaceId} board={board} />
              <Cards board={board} workspaceId={workspaceId} />
              {board.rows.length === 0 ? (
                <p data-region="no-match" className="m-0 text-[14px] text-n700">
                  No product matches these filters.{" "}
                  <a href={boardHref(workspaceId, { density: board.filters.density })}>Clear filters</a>
                </p>
              ) : null}
              {board.pages > 1 ? <Pager workspaceId={workspaceId} board={board} /> : null}
              <Legend />
            </>
          )}
        </>
      )}
    </div>
  );
}

function Intro({ workspaceId, page }: { workspaceId: string; page: Loaded }) {
  const { board } = page;
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  return (
    <div className="flex flex-wrap justify-between items-end gap-[16px]">
      <p data-region="subline" className="m-0 text-[15px] text-n600">
        {page.workspaceName} · {n(board.productCount, "product", "products")} · {n(board.marketCount, "market", "markets")}
      </p>
      {page.canCreate && board.productCount > 0 ? (
        <div className="flex gap-[8px] flex-wrap">
          <LinkButton href={`/w/${workspaceId}/products/new`}>Add a product</LinkButton>
          <LinkButton href={`/w/${workspaceId}/products/new#start-from-label`}>Upload a label</LinkButton>
        </div>
      ) : null}
    </div>
  );
}

function LinkButton({ href, primary, children }: { href: string; primary?: boolean; children: ReactNode }) {
  return (
    <a
      href={href}
      className={cx(
        "inline-flex items-center text-[14px] font-medium py-[10px] px-[16px] min-h-[44px] rounded-[8px] no-underline kit-transition",
        primary ? "bg-accent text-paper border border-accent hover:bg-accent-600 hover:text-paper" : "bg-paper text-ink border border-rule hover:border-accent hover:text-ink",
      )}
    >
      {children}
    </a>
  );
}

function Empty({ workspaceId, canCreate }: { workspaceId: string; canCreate: boolean }) {
  return (
    <section data-region="empty" aria-labelledby="board-empty" className="border border-rule rounded-[12px] py-[40px] px-[24px] md:py-[56px] md:px-[48px] flex flex-col gap-[16px] items-start">
      <span className="font-mono text-[12px] text-n600 uppercase tracking-[0.08em]">No products yet</span>
      <h2 id="board-empty" className="m-0 text-[22px] md:text-[26px] font-semibold tracking-[-0.01em]">
        Add a product to see it against every market
      </h2>
      <p className="m-0 text-[16px] leading-[1.5] text-n600 max-w-[560px]">
        Each product gets a row, each market it targets a column, with the label state and registration in every cell.
      </p>
      {canCreate ? (
        <div className="flex gap-[10px] flex-wrap">
          <LinkButton href={`/w/${workspaceId}/products/new`} primary>
            Add a product
          </LinkButton>
          <LinkButton href={`/w/${workspaceId}/products/new#start-from-label`}>Upload a label</LinkButton>
        </div>
      ) : (
        <p className="m-0 text-[14px] text-n700">An admin, portfolio manager or editor of this workspace can add one.</p>
      )}
    </section>
  );
}

function Toolbar({ workspaceId, board }: { workspaceId: string; board: BoardModel }) {
  const f = { ...board.filters, page: undefined }; // a filter link starts again at the first page
  const inPlan = board.markets.filter((m) => !m.locked);
  const isFindings = f.view === "findings";
  return (
    <div role="group" aria-label="Filters and density" className="flex flex-wrap items-center gap-x-[20px] gap-y-[12px] py-[10px] border-y border-rule">
      <MarketSelect
        value={f.market ?? "all"}
        options={[
          { value: "all", label: "All markets", href: boardHref(workspaceId, { ...f, market: null }) },
          ...inPlan.map((m) => ({ value: m.nodeId, label: `${m.name} · ${m.code}`, href: boardHref(workspaceId, { ...f, market: m.nodeId }) })),
        ]}
      />
      <div role="group" aria-label="State" className="flex gap-[6px] flex-wrap items-center">
        <span aria-hidden="true" className="text-[14px] mr-[2px]">
          State
        </span>
        {STATE_CHIPS.map(([s, label]) => (
          <a
            key={s}
            href={boardHref(workspaceId, { ...f, state: f.state === s ? null : s })}
            data-filter={s}
            aria-current={f.state === s ? "true" : undefined}
            className={cx(
              "inline-flex items-center text-[13px] font-medium py-[6px] px-[12px] min-h-[36px] rounded-full border text-ink no-underline kit-transition hover:border-accent hover:text-ink",
              f.state === s ? "bg-accent-100 border-accent" : "bg-paper border-rule",
            )}
          >
            {label}
          </a>
        ))}
      </div>
      {board.filtered && !isFindings ? (
        <span data-region="showing" className="text-[14px] text-n600">
          Showing {board.matched} of {board.productCount} products · <a href={boardHref(workspaceId, { density: f.density })}>Clear filters</a>
        </span>
      ) : null}
      <span className="flex-1" />
      <nav aria-label="Board views" className="flex gap-[14px] text-[14px]">
        <a href={boardHref(workspaceId, { ...f, view: "board" })} aria-current={!isFindings ? "page" : undefined} data-filter="view:board" className={cx(!isFindings && "text-ink font-semibold")}>
          Matrix
        </a>
        <a href={boardHref(workspaceId, { ...f, view: "findings" })} aria-current={isFindings ? "page" : undefined} data-filter="view:findings" className={cx(isFindings && "text-ink font-semibold")}>
          Open findings
        </a>
      </nav>
      {isFindings ? null : (
        <div role="group" aria-label="Density" className="hidden md:flex border border-rule rounded-[8px] overflow-hidden">
          {(["comfortable", "compact"] as const).map((d, i) => (
            <a
              key={d}
              href={boardHref(workspaceId, { ...f, density: d })}
              data-density-link={d}
              aria-current={f.density === d ? "true" : undefined}
              className={cx(
                "inline-flex items-center text-[13px] py-[8px] px-[12px] min-h-[36px] text-ink no-underline hover:text-ink",
                i > 0 && "border-l border-rule",
                f.density === d ? "bg-panel" : "bg-paper",
              )}
            >
              {d === "compact" ? "Compact" : "Comfortable"}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ── The matrix (1600 px) ─────────────────────────────────────────────────────────────────────────────────────────

function Matrix({ workspaceId, board }: { workspaceId: string; board: BoardModel }) {
  const compact = board.filters.density === "compact";
  const n = board.columns.length;
  const wide = n > 5;
  const col = compact ? (wide ? 196 : 160) : wide ? 200 : 212;
  const cols: CSSProperties = { gridTemplateColumns: `${compact || wide ? 260 : 300}px repeat(${n}, minmax(${col}px, 1fr))` };
  // The one cell in the tab order: the first that can be opened, else the first product link.
  let first: string | null = null;
  for (const [r, row] of board.rows.entries()) {
    const c = row.cells.findIndex((cell) => cell.kind === "market");
    if (c >= 0) {
      first = `${r}:${c + 1}`;
      break;
    }
  }
  first ??= board.rows.length ? "0:0" : null;
  const tab = (r: number, c: number) => (first === `${r}:${c}` ? 0 : -1);
  if (!board.rows.length) return null;
  return (
    // The scroller holds both sticky headers; its own height keeps the header row in view at 50 rows (S-MTX-007).
    <div
      className="hidden md:block relative border border-rule rounded-[10px] overflow-auto max-h-[max(420px,calc(100vh-260px))] scroll-pt-[80px] scroll-pl-[300px]"
      data-region="matrix"
    >
      <GridKeys
        label="Products by market"
        rowCount={board.rows.length}
        colCount={n + 1}
        density={compact ? "compact" : "comfortable"}
        className="flex flex-col min-w-full w-max"
      >
        <div role="row" aria-rowindex={1} className="mx-row sticky top-0 z-[3] bg-paper" style={cols}>
          <div
            role="columnheader"
            className={cx("sticky left-0 z-[4] bg-paper border-r border-rule flex items-end", MONO_KICKER, compact ? "py-[8px] px-[12px]" : "py-[14px] px-[16px]")}
          >
            Product
          </div>
          {board.columns.map((c) => (
            <ColumnHead key={c.nodeId} column={c} workspaceId={workspaceId} compact={compact} />
          ))}
        </div>
        {board.rows.map((row, r) => (
          <div key={row.productId} role="row" aria-rowindex={r + 2} className="mx-row" style={cols} data-product={row.productId}>
            <RowHead row={row} r={r} tab={tab(r, 0)} compact={compact} />
            {row.cells.map((cell, i) => (
              <Cell key={cell.nodeId} cell={cell} r={r} c={i + 1} tab={tab(r, i + 1)} compact={compact} />
            ))}
          </div>
        ))}
      </GridKeys>
    </div>
  );
}

function ColumnHead({ column: c, workspaceId, compact }: { column: BoardColumn; workspaceId: string; compact: boolean }) {
  return (
    <div
      role="columnheader"
      data-column={c.nodeId}
      data-locked={c.locked ? "" : undefined}
      className={cx("flex flex-col gap-[3px] border-l border-rule", c.locked ? "bg-panel" : "bg-paper", compact ? "py-[8px] px-[12px]" : "py-[14px] px-[16px]")}
    >
      <div className="flex items-baseline gap-[8px]">
        <span className={cx("text-[14px] font-semibold", c.locked ? "text-n600" : "text-ink")}>{c.name}</span>
        <span className="font-mono text-[12px] text-n600">{c.code}</span>
      </div>
      {c.locked ? (
        <span className="text-[12px] text-n600">
          Not in your plan · <a href={upgradeHref(workspaceId)}>Upgrade</a>
        </span>
      ) : (
        <span data-summary className="text-[12px] text-n600">
          {c.clear} of {c.checked} products label clear
        </span>
      )}
    </div>
  );
}

function RowHead({ row, r, tab, compact }: { row: BoardRow; r: number; tab: number; compact: boolean }) {
  return (
    <div role="rowheader" title={`${row.meta} · ${row.summary}`} className="mx-rh">
      <a
        href={row.href}
        data-nav=""
        data-r={r}
        data-c={0}
        tabIndex={tab}
        className="block text-[14px] font-semibold text-ink whitespace-nowrap overflow-hidden text-ellipsis no-underline hover:underline hover:text-ink"
      >
        {row.name}
      </a>
      {compact ? (
        <span className="sr-only">
          {row.meta} · {row.summary}
        </span>
      ) : (
        <>
          <span className="font-mono text-[11px] text-n600 whitespace-nowrap overflow-hidden text-ellipsis">{row.meta}</span>
          <span data-row-summary className={cx("text-[12px] whitespace-nowrap overflow-hidden text-ellipsis", row.attention ? "text-ink" : "text-n600")}>
            {row.summary}
          </span>
        </>
      )}
    </div>
  );
}

function Cell({ cell, r, c, tab, compact }: { cell: BoardCell; r: number; c: number; tab: number; compact: boolean }) {
  if (cell.kind === "none") {
    return (
      <div role="gridcell" data-node={cell.nodeId} data-cell="none" className="mx-gc">
        <div className="mx-inert">
          <span aria-hidden="true">–</span>
          <span className="sr-only">Not a market for this product</span>
        </div>
      </div>
    );
  }
  if (cell.kind === "locked") {
    return (
      <div role="gridcell" aria-disabled="true" data-node={cell.nodeId} data-cell="locked" className="mx-gc">
        <div className="mx-inert">
          <span aria-hidden="true">–</span>
          <span className="sr-only">{cell.aria}</span>
        </div>
      </div>
    );
  }
  return (
    <div
      role="gridcell"
      data-node={cell.nodeId}
      data-cell={cell.label}
      data-registration={cell.registration}
      data-blocked={cell.blocked ?? undefined}
      className="mx-gc"
    >
      <a href={cell.href} data-nav="" data-r={r} data-c={c} tabIndex={tab} aria-label={cell.aria} className="mx-cell">
        <LabelChip label={cell.label} open={cell.open} />
        {cell.blocked ? (
          <Blocked by={cell.blocked} compact={compact} />
        ) : compact ? (
          <span title={`Registration: ${REGISTRATION_TEXT[cell.registration]}`} aria-hidden="true" className={cx("font-mono text-[12px] w-[14px] text-center", regTone(cell))}>
            {REGISTRATION_GLYPH[cell.registration]}
          </span>
        ) : (
          <RegLine cell={cell} />
        )}
      </a>
    </div>
  );
}

const regTone = (cell: Pick<MarketCell, "registration">) => (cell.registration === "unknown" || cell.registration === "not_required" ? "text-n600" : "text-ink");

function RegLine({ cell }: { cell: MarketCell }) {
  return (
    <span className={cx("mx-reg", regTone(cell))} data-reg-line>
      <span className="font-mono text-[10px] tracking-[0.06em] text-n600">REG</span>
      <span aria-hidden="true" className="font-mono text-[11px] w-[12px] text-center">
        {REGISTRATION_GLYPH[cell.registration]}
      </span>
      {REGISTRATION_TEXT[cell.registration]}
    </span>
  );
}

// The design's glyphs, drawn in the state's colour and always beside the state's name (docs/10).
const GLYPH_PATH: Record<"clear" | "action" | "not_assessed" | "blocked", ReactNode> = {
  clear: (
    <>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M5 8.2l2 2 4-4.2" />
    </>
  ),
  action: (
    <>
      <path d="M8 1.8l6.6 12H1.4z" />
      <path d="M8 6.5v3.2M8 11.6v.4" />
    </>
  ),
  not_assessed: (
    <>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M5 8h6" />
    </>
  ),
  blocked: (
    <>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M3.5 12.5l9-9" />
    </>
  ),
};

function Glyph({ state, size = 13 }: { state: keyof typeof GLYPH_PATH; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true" data-glyph={state}>
      {GLYPH_PATH[state]}
    </svg>
  );
}

const CHIP_TONE = { clear: "bg-clear-bg text-clear", action: "bg-action-bg text-action", not_assessed: "bg-na-bg text-na underline" } as const;

function LabelChip({ label, open, size = 13 }: { label: LabelLine; open: number | null; size?: number }) {
  if (label === "never") {
    return <span className="text-[13px] text-n600 whitespace-nowrap">{LABEL_TEXT.never}</span>;
  }
  return (
    <span className={cx("mx-chip", CHIP_TONE[label])} data-label={label}>
      <Glyph state={label} size={size} />
      {label === "action" && open ? `Action needed · ${open} open` : LABEL_TEXT[label]}
    </span>
  );
}

function Blocked({ by, compact }: { by: "expired" | "not_registered"; compact?: boolean }) {
  return (
    <span className="mx-chip bg-blocked-bg text-blocked text-[12px]" data-blocked-chip={by}>
      <Glyph state="blocked" size={12} />
      {compact ? "Blocked" : `Blocked · registration ${by === "expired" ? "expired" : "not registered"}`}
    </span>
  );
}

function Legend() {
  return (
    <div aria-label="Legend" role="group" data-region="legend" className="flex flex-wrap gap-x-[22px] gap-y-[10px] items-center text-[13px] text-ink">
      <span className={MONO_KICKER}>Label</span>
      <span className={cx("mx-chip", CHIP_TONE.clear)}>
        <Glyph state="clear" />
        Label clear
      </span>
      <span className={cx("mx-chip", CHIP_TONE.action)}>
        <Glyph state="action" />
        Action needed · n open
      </span>
      <span className={cx("mx-chip bg-na-bg text-na")}>
        <Glyph state="not_assessed" />
        Not assessed (links to coverage gap)
      </span>
      <span className="text-n600">Not checked yet (no check run)</span>
      <span className={cx(MONO_KICKER, "ml-[12px]")}>Registration</span>
      <span>✓ Registered</span>
      <span className="text-n600">– Not required</span>
      <span className="text-n600">? Unknown</span>
      <span className="mx-chip bg-blocked-bg text-blocked">
        <Glyph state="blocked" size={12} />
        Blocked (registration blocks sale)
      </span>
    </div>
  );
}

// ── On a phone (390 px): one product per card (S-MTX-002) ────────────────────────────────────────────────────────

function Cards({ workspaceId, board }: { workspaceId: string; board: BoardModel }) {
  if (!board.rows.length) return null;
  const name = new Map(board.columns.map((c) => [c.nodeId, c]));
  return (
    <div className="md:hidden flex flex-col gap-[12px]" data-region="cards">
      {board.rows.map((row) => (
        <section key={row.productId} data-product={row.productId} aria-labelledby={`card-${row.productId}`} className="border border-rule rounded-[10px] overflow-hidden">
          <div className="py-[12px] px-[14px] flex flex-col gap-[2px] bg-panel">
            <h2 id={`card-${row.productId}`} className="m-0 text-[15px] font-semibold tracking-normal">
              <a href={row.href} className="text-ink no-underline">
                {row.name}
              </a>
            </h2>
            <span className="font-mono text-[11px] text-n600">
              {row.meta} · {row.summary}
            </span>
          </div>
          <ul className="list-none m-0 p-0">
            {row.cells
              .filter((c) => c.kind !== "none")
              .map((cell) => {
                const col = name.get(cell.nodeId)!;
                const locked = cell.kind === "locked";
                return (
                  <li key={cell.nodeId} data-node={cell.nodeId} className={cx("border-t border-rule", locked ? "bg-panel" : "bg-paper")}>
                    <a
                      href={cell.kind === "market" ? cell.href : upgradeHref(workspaceId)}
                      aria-label={cell.kind === "market" ? cell.aria : `${cell.aria}. Upgrade`}
                      className="flex items-center gap-[10px] min-h-[48px] py-[6px] px-[14px] text-ink no-underline hover:text-ink"
                    >
                      <span className="flex-[0_0_74px] flex flex-col">
                        <span className={cx("text-[13px] font-semibold", locked ? "text-n600" : "text-ink")}>{col.name}</span>
                        <span className="font-mono text-[11px] text-n600">{col.code}</span>
                      </span>
                      <span className="flex-1 flex flex-col gap-[3px] items-start">
                        {cell.kind === "market" ? (
                          <>
                            <LabelChip label={cell.label} open={cell.open} size={12} />
                            {cell.blocked ? <Blocked by={cell.blocked} /> : <RegLine cell={cell} />}
                          </>
                        ) : (
                          <span className="text-[12px] text-n600">
                            Not in your plan · <span className="text-accent-700 underline">Upgrade</span>
                          </span>
                        )}
                      </span>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" className="text-n600 flex-none">
                        <path d="M6 3.5l4.5 4.5L6 12.5" />
                      </svg>
                    </a>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Pages of BOARD_PAGE rows (issue 311). Links, like the filters, so a page survives a reload or a shared link. */
function Pager({ workspaceId, board }: { workspaceId: string; board: BoardModel }) {
  const first = (board.page - 1) * BOARD_PAGE + 1;
  const last = first + board.rows.length - 1;
  const to = (page: number) => boardHref(workspaceId, { ...board.filters, page });
  return (
    <nav aria-label="Board pages" data-region="pager" className="flex gap-[16px] items-center font-mono text-[11px] tracking-[0.05em]">
      <span className="text-n600" data-range>
        ROWS {first}–{last} OF {board.matched}
      </span>
      <span className="flex-1" />
      {board.page > 1 ? (
        <a href={to(board.page - 1)} rel="prev" className="kit-transition">
          PREVIOUS {BOARD_PAGE}
        </a>
      ) : null}
      <span className="text-n600">
        PAGE {board.page} OF {board.pages}
      </span>
      {board.page < board.pages ? (
        <a href={to(board.page + 1)} rel="next" className="kit-transition">
          NEXT {Math.min(BOARD_PAGE, board.matched - last)}
        </a>
      ) : null}
    </nav>
  );
}

// ── F04 · Open findings across the portfolio (?view=findings) ────────────────────────────────────────────────────

function Findings({ workspaceId, board, findings }: { workspaceId: string; board: BoardModel; findings: NonNullable<Loaded["findings"]> }) {
  const filtered = board.filtered;
  return (
    <section data-region="findings" aria-labelledby="findings-heading" className="max-w-[948px]">
      <div className="flex flex-wrap items-baseline gap-[14px] border-b border-ink pb-[9px]">
        <h2 id="findings-heading" className="m-0 font-head text-[17px] font-semibold">
          Open findings across the portfolio
        </h2>
        <span className="flex-1" />
        <span data-findings-total={findings.total} className="font-mono text-[10.5px] text-n600">
          {findings.counts.action} action needed · {findings.counts.not_assessed} not assessed
          {findings.total > findings.items.length ? ` · showing ${findings.items.length} of ${findings.total}${findings.capped ? "+" : ""}` : ""}
        </span>
      </div>
      {findings.capped ? (
        <p data-findings-capped className="mt-[10px] mb-0 text-[13px] leading-[1.5] text-n700">
          There are more than {FINDINGS_READ_CAP.toLocaleString("en-GB")} open findings, so only the first{" "}
          {FINDINGS_READ_CAP.toLocaleString("en-GB")} were read and the counts above stop there. Narrow the list with the
          filters to see the rest.
        </p>
      ) : null}
      {findings.outsidePlan.length ? (
        <p data-outside-plan className="mt-[10px] mb-0 text-[13px] leading-[1.5] text-n700">
          Findings in {findings.outsidePlan.join(" and ")} are not shown: your plan does not include{" "}
          {findings.outsidePlan.length === 1 ? "it" : "them"}, so they cannot be opened.
        </p>
      ) : null}
      {findings.items.length === 0 ? (
        <div className="mt-[16px] max-w-[640px]">
          <EmptyState
            where={filtered ? "FINDINGS · NONE MATCH" : "FINDINGS · NONE OPEN"}
            title={filtered ? "No open finding matches these filters" : "No open findings"}
            body={
              filtered
                ? "Clear the filters to see every open finding across the portfolio."
                : "No market's latest check has an open finding. A market that has never been checked has no findings yet: it reads Not checked yet on the board until it is."
            }
            action={filtered ? { label: "Show every finding", href: boardHref(workspaceId, { view: "findings" }) } : undefined}
          />
        </div>
      ) : (
        <ul className="m-0 p-0 list-none">
          {findings.items.map((item) => (
            <FindingItem key={item.finding.id} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

function FindingItem({ item }: { item: PortfolioFinding }) {
  const f = item.finding;
  return (
    <li data-finding={f.id} data-product={item.productId} data-node={item.nodeId}>
      <a href={item.href} className="block pt-[10px] font-mono text-[10px] tracking-[0.06em] uppercase text-n600 no-underline hover:text-accent kit-transition">
        {item.productName} · {item.nodeLabel}
        {item.language ? ` · ${item.language} panel` : ""}
      </a>
      {f.state === "action" ? (
        <Finding state="action" title={f.title} action={f.action} pin={f.pin} measure={f.measure} provenance={f.provenance} ruleKey={f.ruleKey} citation={f.citation} />
      ) : f.gapId !== null ? (
        <Finding
          state="not_assessed"
          title={f.title}
          action={f.action}
          pin={f.pin}
          measure={f.measure}
          provenance={f.provenance}
          reasonCode={f.reasonCode}
          gapId={f.gapId}
          gapHref={f.gapHref}
          ruleKey={f.ruleKey}
          citation={f.citation}
        />
      ) : (
        <Finding
          state="not_assessed"
          title={f.title}
          action={f.action}
          pin={f.pin}
          measure={f.measure}
          provenance={f.provenance}
          reasonCode={f.reasonCode}
          gapId={null}
          ruleKey={f.ruleKey}
          citation={f.citation}
        />
      )}
    </li>
  );
}

// ── The states the page itself draws (S-MTX-009 to 011) ─────────────────────────────────────────────────────────

/** S-MTX-009: the grid's outline while the board is read. Neutral, never a state's colour. */
export function BoardLoading() {
  const bar = (w: string, h: number) => <div className="rounded-[4px] bg-panel" style={{ width: w, height: h }} />;
  return (
    <div className="flex flex-col gap-[20px]" data-region="board-loading">
      <div aria-hidden="true" className="border border-rule rounded-[10px] overflow-hidden">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="grid border-b border-rule" style={{ gridTemplateColumns: "300px repeat(5, minmax(0, 1fr))" }}>
            <div className="py-[18px] px-[20px] border-r border-rule flex flex-col gap-[8px]">
              {bar("70%", 12)}
              {bar("45%", 10)}
            </div>
            {Array.from({ length: 5 }, (_, k) => (
              <div key={k} className="py-[18px] px-[16px] border-l border-rule">
                {bar("100px", 20)}
              </div>
            ))}
          </div>
        ))}
      </div>
      <span role="status" className="text-[14px] text-n600">
        Loading the board…
      </span>
    </div>
  );
}

/** S-MTX-010: the read failed. The reference is the response's request id, never a made-up one. */
export function BoardError({ retryHref, requestId }: { retryHref: string; requestId: string | null }) {
  return (
    <div role="alert" data-region="board-error" className="border border-rule rounded-[10px] p-[24px] md:p-[40px] bg-panel flex flex-col gap-[12px] max-w-[640px]">
      <h2 className="m-0 text-[20px] font-semibold tracking-normal">The board didn’t load</h2>
      <p className="m-0 text-[15px] leading-[1.5] text-n600">Nothing has changed in your results. This page couldn’t reach them.</p>
      <div>
        <a
          href={retryHref}
          className="inline-flex items-center text-[14px] font-semibold py-[10px] px-[16px] min-h-[44px] rounded-[8px] bg-accent text-paper no-underline hover:bg-accent-600 hover:text-paper"
        >
          Try again
        </a>
      </div>
      {requestId ? <span className="font-mono text-[11px] text-n600" data-request-id={requestId}>Error reference · {requestId}</span> : null}
    </div>
  );
}

/** S-MTX-011: the workspace's board is not readable to this person. No "Request access": it has no flow behind it. */
export function BoardNoAccess() {
  return (
    <div data-region="board-no-access" className="border border-rule rounded-[10px] p-[24px] md:p-[40px] flex flex-col gap-[12px] max-w-[640px]">
      <h2 className="m-0 text-[20px] font-semibold tracking-normal">You don’t have access to this workspace’s board</h2>
      <p className="m-0 text-[15px] leading-[1.5] text-n600">A workspace admin can give you access to its products and markets.</p>
    </div>
  );
}
