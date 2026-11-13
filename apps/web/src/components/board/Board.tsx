import { EmptyState, Finding, StateCell, StateLegend, cx, stateTint } from "@/components/kit";
import { STATE_LABEL } from "@/components/kit/states";
import {
  FINDINGS_READ_CAP,
  boardHref,
  type BoardCell,
  type BoardModel,
  type BoardRow,
  type PortfolioFinding,
  type StateFilter,
} from "@/lib/board/model";
import type { BoardPage } from "@/lib/board/queries";

const HEAD = "font-mono text-[9.5px] tracking-[0.1em] font-normal text-n600 border-b border-ink py-[9px]";

const FILTER_LABEL: Record<StateFilter, string> = { action: "Action needed", not_assessed: "Not assessed", stale: "Stale" };

/**
 * S-NV2-006 Board (Nutrivo 2.0, screen "board"): products × markets grouped by region, each group led by its region's
 * roll-up (F01, app.rollup_state), and the open findings across the portfolio (F04, the "Findings" view). Every
 * control is a link, so filters live in the URL and survive a reload or a shared link.
 */
export function Board({ workspaceId, page }: { workspaceId: string; page: Extract<BoardPage, { kind: "loaded" }> }) {
  const { board, findings } = page;
  if (board.productCount === 0) {
    return (
      <div className="max-w-[640px]" data-region="board">
        <EmptyState
          kind="action"
          where="BOARD · NO PRODUCTS"
          title="No products on the board yet"
          body="The board shows every product against every market it is sold in. Add a product and choose its markets, and its row appears here."
          action={{ label: "Add a product", href: `/w/${workspaceId}/products/new` }}
        />
      </div>
    );
  }
  return (
    <div data-region="board" data-view={board.filters.view}>
      <Summary workspaceId={workspaceId} board={board} />
      {findings ? <Findings workspaceId={workspaceId} board={board} findings={findings} /> : <Grid workspaceId={workspaceId} board={board} />}
    </div>
  );
}

function Summary({ workspaceId, board }: { workspaceId: string; board: BoardModel }) {
  const f = board.filters;
  return (
    <div data-region="summary" className="flex flex-wrap items-end gap-[20px] border-b border-ink pb-[12px]">
      <Stat value={board.stats.unproven} label="Answers unproven" tone="text-na" name="unproven" />
      <Stat value={board.stats.stale} label="Stale against ruleset" tone="text-accent" name="stale" divided />
      <span className="flex-1" />
      <nav aria-label="Board filters" className="flex flex-wrap gap-[6px] justify-end max-w-[640px]">
        <Chip href={boardHref(workspaceId, { view: f.view })} on={!f.state && !f.species}>
          All markets
        </Chip>
        {(["action", "not_assessed", "stale"] as const).map((s) => (
          <Chip key={s} href={boardHref(workspaceId, { ...f, state: f.state === s ? null : s })} on={f.state === s} filter={s}>
            {FILTER_LABEL[s]}
          </Chip>
        ))}
        {board.species.map((s) => (
          <Chip key={s} href={boardHref(workspaceId, { ...f, species: f.species === s ? null : s })} on={f.species === s} filter={`species:${s}`}>
            {s}
          </Chip>
        ))}
        <span aria-hidden="true" className="w-[1px] bg-rule mx-[4px]" />
        <Chip href={boardHref(workspaceId, { ...f, view: "board" })} on={f.view === "board"} filter="view:board">
          Board
        </Chip>
        <Chip href={boardHref(workspaceId, { ...f, view: "findings" })} on={f.view === "findings"} filter="view:findings">
          Open findings
        </Chip>
      </nav>
    </div>
  );
}

function Stat({ value, label, tone, name, divided }: { value: number; label: string; tone: string; name: string; divided?: boolean }) {
  return (
    <div data-stat={name} className={cx(divided && "border-l border-rule pl-[20px]")}>
      <p className={cx("m-0 font-head text-[34px] font-semibold leading-none tracking-[-0.02em]", tone)}>{value}</p>
      <p className="mt-[4px] mb-0 font-mono text-[10px] tracking-[0.1em] uppercase text-n600">{label}</p>
    </div>
  );
}

function Chip({ href, on, filter, children }: { href: string; on: boolean; filter?: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      data-filter={filter ?? "all"}
      aria-current={on ? "true" : undefined}
      className={cx(
        "inline-flex items-center min-h-[24px] border py-[6px] px-[10px] font-mono text-[10px] tracking-[0.07em] uppercase no-underline kit-transition hover:border-accent",
        on ? "bg-accent text-paper border-accent-600" : "bg-transparent text-ink border-rule",
      )}
    >
      {children}
    </a>
  );
}

function Grid({ workspaceId, board }: { workspaceId: string; board: BoardModel }) {
  return (
    <>
      {/* relative: the cells' sr-only text is absolutely positioned, so it stays inside this scroller at 320 px (WCAG 1.4.10) */}
      <div className="relative overflow-x-auto">
        <table className="w-full border-collapse mt-[4px]" data-region="grid">
          <thead>
            <tr>
              <th scope="col" className={cx(HEAD, "text-left uppercase pr-[8px] w-[27%]")}>
                Product
              </th>
              {board.columns.map((c) => (
                <th
                  key={c.nodeId}
                  scope="col"
                  data-column={c.nodeId}
                  data-kind={c.kind}
                  title={c.name}
                  className={cx(HEAD, "text-center px-[4px] min-w-[56px]", c.kind === "region" && "text-ink border-l border-l-n300")}
                >
                  {c.label}
                  <span className="sr-only">, {c.name}</span>
                </th>
              ))}
              <th scope="col" className={cx(HEAD, "text-left uppercase pl-[12px] w-[17%]")}>
                Checked against
              </th>
            </tr>
          </thead>
          <tbody>
            {board.rows.map((r) => (
              <Row key={r.productId} row={r} board={board} />
            ))}
          </tbody>
        </table>
      </div>
      {board.rows.length === 0 ? (
        <p data-region="no-match" className="mt-[16px] mb-0 text-[13.5px] text-n700">
          No product matches these filters.{" "}
          <a href={boardHref(workspaceId, { view: "board" })} className="kit-transition">
            Show every product
          </a>
        </p>
      ) : null}
      <div data-region="legend" className="mt-[16px] flex items-center gap-[22px] flex-wrap">
        <StateLegend />
        <span className="flex-1" />
        <span className="font-mono text-[10.5px] text-n600">Number in cell = open actions · first column of a region = its roll-up</span>
      </div>
      <p className="mt-[14px] mb-0 text-[13px] leading-[1.55] text-n700 max-w-[96ch]">
        A date alone says nothing. Every row states which ruleset version it was judged against, so a cell that was clear
        against an earlier ruleset and has not been re-run since reads as stale rather than green.
      </p>
    </>
  );
}

function Row({ row, board }: { row: BoardRow; board: BoardModel }) {
  const f = row.freshness;
  return (
    <tr data-product={row.productId}>
      <th scope="row" className="text-left font-normal border-b border-rule p-0 align-middle">
        <a href={row.href} className="block py-[10px] pr-[8px] text-ink no-underline hover:bg-accent-100 kit-transition">
          <span className="block text-[13.5px] font-medium">{row.name}</span>
          <span className="block mt-[2px] font-mono text-[10px] text-n600">{row.meta}</span>
        </a>
      </th>
      {row.cells.map((c, i) => (
        <Cell key={c.nodeId} cell={c} product={row.name} column={board.columns[i].label} />
      ))}
      <td className="border-b border-rule py-[10px] pl-[12px] align-middle" data-freshness={f.kind}>
        <span className={cx("block font-mono text-[10.5px]", f.kind === "stale" ? "text-accent" : f.kind === "never" ? "text-n600" : "text-ink")}>
          {f.version ?? "—"}
        </span>
        <span className="block mt-[2px] font-mono text-[10px] text-n600">{f.note}</span>
      </td>
    </tr>
  );
}

function Cell({ cell, product, column }: { cell: BoardCell; product: string; column: string }) {
  const edge = cell.kind === "region" ? "border-l border-l-n300" : "border-l border-l-n200";
  if (cell.state === null) {
    return (
      <td data-node={cell.nodeId} data-kind={cell.kind} data-cell-state="" className={cx("border-b border-rule p-0 text-center align-middle", edge)}>
        <span className="font-mono text-[10px] text-n400" aria-hidden="true">
          ·
        </span>
        <span className="sr-only">Not sold in {column}</span>
      </td>
    );
  }
  return (
    <td
      data-node={cell.nodeId}
      data-kind={cell.kind}
      data-cell-state={cell.state}
      data-stale={cell.stale ? "" : undefined}
      className={cx("border-b border-rule p-0 align-middle", edge, stateTint(cell.state))}
    >
      <a
        href={cell.href!}
        aria-label={`${product}, ${column}: ${STATE_LABEL[cell.state]}${cell.count ? `, ${cell.count} open` : ""}${cell.kind === "region" ? ", rolled up" : ""}`}
        className="block no-underline hover:brightness-95 kit-transition"
      >
        <StateCell state={cell.state} count={cell.count ?? undefined} />
      </a>
    </td>
  );
}

function Findings({
  workspaceId,
  board,
  findings,
}: {
  workspaceId: string;
  board: BoardModel;
  findings: NonNullable<Extract<BoardPage, { kind: "loaded" }>["findings"]>;
}) {
  const filtered = !!board.filters.state || !!board.filters.species;
  return (
    <section data-region="findings" aria-labelledby="findings-heading" className="mt-[18px] max-w-[948px]">
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
      {findings.items.length === 0 ? (
        <div className="mt-[16px] max-w-[640px]">
          <EmptyState
            where={filtered ? "FINDINGS · NONE MATCH" : "FINDINGS · NONE OPEN"}
            title={filtered ? "No open finding matches these filters" : "No open findings"}
            body={
              filtered
                ? "Clear the filters to see every open finding across the portfolio."
                : "No market's latest check has an open finding. A market that has never been checked has no findings yet: it reads Not assessed on the board until it is."
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
