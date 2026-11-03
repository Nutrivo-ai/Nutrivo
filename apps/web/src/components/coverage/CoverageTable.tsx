import { EmptyState } from "@/components/kit";
import { cx } from "@/components/kit";
import { DOMAINS } from "@/lib/public/coverage";
import { DOMAIN_SHORT, STATE_COLOR, STATE_WORD, domainLabel, methodLabel, nodeHref, type CoverageRow } from "@/lib/coverage/model";
import type { LibraryCoverage } from "@/lib/coverage/queries";

const HEAD = "font-mono text-[9.5px] tracking-[0.1em] uppercase font-normal text-n600 border-b border-ink py-[9px]";

/**
 * S-NV2-013 Coverage & confidence (Nutrivo 2.0, screen "coverage"): one row per market, a cell per coverage domain
 * with the rules encoded and how, and what is not covered, by gap id. The six domains are the coverage table's own,
 * as the public page shows them (#55 q3); the authority line holds the ruleset the row is read at (#55 q4).
 */
export function CoverageTable({ workspaceId, page }: { workspaceId: string; page: Extract<LibraryCoverage, { kind: "loaded" }> }) {
  const forProduct = page.product !== null;
  return (
    <div data-region="coverage" className="max-w-[948px]">
      <p data-region="intro" className="mt-0 mb-[18px] text-[14px] leading-[1.55] max-w-[94ch] text-n700">
        {forProduct
          ? "What we have encoded for each of this product's markets, at the ruleset its last check was pinned to, and what we have not covered. The public coverage page renders these same rows."
          : "What we have encoded, how it was verified, and what we have not covered. This page is public: the coverage page renders these same rows, so the two cannot drift."}
      </p>
      {page.rows.length === 0 ? (
        <div className="max-w-[640px]">
          {forProduct ? (
            <EmptyState
              kind="action"
              where="COVERAGE · NO MARKETS"
              title="This product is not sold in any market yet"
              body="Coverage is per market. Choose where the product is sold, and each market's encoded domains and named gaps appear here."
              action={{ label: "Upload & scope", href: `/w/${workspaceId}/products/${page.product!.id}/check` }}
            />
          ) : (
            <EmptyState
              where="COVERAGE · NO RELEASE"
              title="No ruleset has been released yet"
              body="Coverage is published with each ruleset release. Until the first one, no market is encoded, and no check can return a verdict."
            />
          )}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[760px]">
              <thead>
                <tr>
                  <th scope="col" className={cx(HEAD, "text-left pr-[10px] w-[16%]")}>Market</th>
                  {DOMAINS.map((d) => (
                    <th key={d} scope="col" className={cx(HEAD, "text-center px-[6px] w-[9.5%]")} title={domainLabel(d)}>
                      {DOMAIN_SHORT[d]}
                    </th>
                  ))}
                  <th scope="col" className={cx(HEAD, "text-left pl-[12px]")}>Not covered</th>
                </tr>
              </thead>
              <tbody>
                {page.rows.map((r) => (
                  <Row key={r.nodeId} row={r} href={nodeHref(workspaceId, r.nodeId, r.rulesetVersion !== page.latest ? r.rulesetVersion : null)} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-[14px] flex gap-[24px] flex-wrap font-mono text-[10.5px] tracking-[0.06em] uppercase text-n600">
            <span>Number = rules encoded</span>
            <span>Complete · partial · not encoded, by colour and word</span>
            <span>— = not encoded</span>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ row, href }: { row: CoverageRow; href: string }) {
  return (
    <tr data-node={row.nodeId} data-depth={row.node.depth}>
      <th scope="row" className="text-left font-normal border-b border-rule py-[11px] pr-[10px] align-middle">
        <a href={href} className="block text-[13.5px] font-medium text-ink no-underline hover:underline kit-transition">
          {row.name}
        </a>
        <span className="block mt-[2px] font-mono text-[10px] text-n600">
          {row.rulesetVersion ? `Ruleset ${row.rulesetVersion}${row.pinned ? " · pinned" : " · latest"}` : "No release"}
        </span>
      </th>
      {row.node.domains.map((d) => (
        <td key={d.domain} data-domain={d.domain} data-state={d.state} className="border-b border-rule py-[11px] px-[6px] text-center align-middle">
          <span className={cx("block font-mono text-[12px]", STATE_COLOR[d.state as keyof typeof STATE_COLOR])} data-rules={d.rules_encoded}>
            {d.state === "not_encoded" ? "—" : d.rules_encoded}
          </span>
          <span className="block mt-[2px] font-mono text-[9px] tracking-[0.06em] uppercase text-n600">
            {d.state === "complete" ? methodLabel(d.method, d.state) : STATE_WORD[d.state as keyof typeof STATE_WORD]}
          </span>
        </td>
      ))}
      <td className="border-b border-rule py-[11px] pl-[12px] text-[12.5px] leading-[1.45] text-n700 align-middle" data-gaps>
        {row.gaps.length === 0 ? (
          "Every domain is encoded."
        ) : (
          <ul className="m-0 p-0 list-none flex flex-col gap-[4px]">
            {row.gaps.map((g) => (
              <li key={g.id}>
                <a href={`${href}#${encodeURIComponent(g.id)}`} className="font-mono text-[10px] kit-transition" data-gap-id={g.id}>
                  {g.id}
                </a>
                {g.description ? <span className="block">{g.description}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}
