import { cx } from "@/components/kit";
import { isoDay } from "@/lib/public/coverage";
import { NODE_STATES, STATE_COLOR, STATE_EDGE, STATE_WORD, domainLabel, headline, methodLabel, publicHref, type CoverageRow } from "@/lib/coverage/model";

const EYEBROW = "m-0 font-mono text-[10px] tracking-[0.13em] uppercase";
const STATE_HEX: Record<string, string> = { complete: "text-clear", partial: "text-action", not_encoded: "text-na" };

/**
 * S-NV2-021 Coverage node (Nutrivo 2.0, screen "cov"): the node's state and facts, its rules by domain, and its named
 * gaps, each anchored by its id so a Not assessed finding's gap link lands on it (D07.must.2). Left out (#55 q4): the
 * "Arrived from" finding card, because the gap link names no finding.
 */
export function CoverageNode({ row }: { row: CoverageRow }) {
  const { node } = row;
  const facts = [
    { k: "Node state", v: STATE_WORD[node.depth] },
    { k: "Ruleset binding", v: row.rulesetVersion ?? "No release" },
    { k: "Rules encoded", v: String(node.rules) },
    { k: "Last checked", v: isoDay(node.lastChecked) },
    { k: "Domains encoded", v: `${node.domainsEncoded} of ${node.domains.length}` },
  ];
  return (
    <div data-region="node" className="grid gap-[22px] items-start lg:grid-cols-[minmax(250px,330px)_minmax(0,1fr)] max-w-[948px]">
      <div className="order-2 lg:order-1">
        <p className="m-0 text-[12.5px] leading-[1.55] text-n700">
          Every not-assessed finding and every out-of-coverage cell points at the node that explains it. The public coverage
          page renders these same nodes, so it cannot drift from the product.
        </p>
        <div data-region="node-states" className="mt-[20px] border border-rule py-[14px] px-[16px]">
          <p className={cx(EYEBROW, "text-n600")}>Three node states</p>
          {NODE_STATES.map((s) => (
            <div key={s.k} className="border-t border-rule mt-[10px] pt-[10px]">
              <p className={cx("m-0 font-mono text-[10.5px] tracking-[0.06em]", STATE_HEX[s.state])}>{s.k}</p>
              <p className="mt-[4px] mb-0 text-[12.5px] leading-[1.5] text-n700">{s.v}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="order-1 lg:order-2 min-w-0">
        <div data-region="node-head" className={cx("blueprint relative border border-ink border-t-[3px] py-[18px] px-[20px]", STATE_EDGE[node.depth])}>
          <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
          <div className="flex items-baseline gap-[10px] flex-wrap">
            <p className={cx(EYEBROW, STATE_COLOR[node.depth])}>{STATE_WORD[node.depth]} coverage</p>
            <span className="flex-1" />
            <span className="font-mono text-[10px] text-n600 uppercase">
              {node.region} · {row.name} · node {node.id}
            </span>
          </div>
          <h2 className="mt-[8px] mb-0 font-head text-[26px] font-semibold leading-[1.15]">{headline(row.name, node, row.gaps.length)}</h2>
          <dl className="mt-[16px] mb-0 grid grid-cols-2 md:grid-cols-3 gap-x-[22px]">
            {facts.map((f) => (
              <div key={f.k} className="border-t border-rule py-[10px]">
                <dt className="font-mono text-[9.5px] tracking-[0.12em] uppercase text-n600">{f.k}</dt>
                <dd data-fact={f.k} className="mt-[4px] mx-0 mb-0 text-[13.5px] leading-[1.4]">{f.v}</dd>
              </div>
            ))}
            <div className="border-t border-rule py-[10px]">
              <dt className="font-mono text-[9.5px] tracking-[0.12em] uppercase text-n600">Public page</dt>
              <dd className="mt-[4px] mx-0 mb-0 text-[13.5px] leading-[1.4]">
                <a href={publicHref(node.id)} className="kit-transition break-all">
                  nutrivo.ai/coverage · {node.id}
                </a>
              </dd>
            </div>
          </dl>
        </div>

        <div className="mt-[22px] flex items-baseline gap-[12px] border-b border-ink pb-[6px] flex-wrap">
          <h2 className="m-0 font-head text-[17px] font-semibold">Rules encoded, by domain</h2>
          <span className="font-mono text-[10.5px] text-n600">
            Ruleset {row.rulesetVersion ?? "—"} · never an aggregate figure
          </span>
        </div>
        <div data-region="domains" role="table" aria-label={`Rules encoded on ${row.name}, by domain`} className="mt-[4px]">
          {node.domains.map((d) => (
            <div
              key={d.domain}
              role="row"
              data-domain={d.domain}
              data-state={d.state}
              className="grid grid-cols-[minmax(0,1fr)_54px_minmax(110px,170px)_minmax(90px,130px)] gap-[10px] items-baseline border-b border-rule py-[11px]"
            >
              <span role="cell" className="text-[13.5px]">{domainLabel(d.domain)}</span>
              <span role="cell" className="font-mono text-[12px] text-right">{d.rules_encoded}</span>
              <span role="cell" className="font-mono text-[10.5px] text-n600">{methodLabel(d.method, d.state)}</span>
              <span role="cell" className={cx("font-mono text-[10px] tracking-[0.06em] text-right break-all", STATE_HEX[d.state])}>
                {d.state === "complete" ? "ENCODED" : d.gap_id ?? STATE_WORD[d.state].toUpperCase()}
              </span>
            </div>
          ))}
        </div>

        <div data-region="gaps" className="mt-[22px] border border-ink py-[16px] px-[18px] bg-na-bg">
          <p className={cx(EYEBROW, "text-na")}>Named gaps on this node</p>
          {row.gaps.length === 0 ? (
            <p className="mt-[10px] mb-0 text-[13px] leading-[1.5]">No gaps are open on this node at this ruleset. Every domain returns an answer.</p>
          ) : (
            <div className="mt-[10px] flex flex-col gap-[10px]">
              {row.gaps.map((g) => (
                <div key={g.id} id={g.id} data-gap-id={g.id} className="border-l-2 border-l-na pl-[12px] scroll-mt-[24px] target:bg-paper">
                  {/* --n700, not the design's --n600: on the Not assessed tint --n600 falls below 4.5:1 (axe). */}
                  <p className="m-0 font-mono text-[10px] text-n700">
                    {g.id}
                    {g.openedIn ? ` · OPENED IN ${g.openedIn}` : ""} · {domainLabel(g.domain).toUpperCase()}
                  </p>
                  <p className="mt-[3px] mb-0 text-[13px] leading-[1.5]">{g.description}</p>
                </div>
              ))}
            </div>
          )}
          <p className="mt-[14px] mb-0 text-[12.5px] leading-[1.55] text-n700">
            While a gap is open, results in that domain return Not assessed with the gap cited. This node cannot render Clear
            in those domains, and the public page says so.
          </p>
        </div>
      </div>
    </div>
  );
}
