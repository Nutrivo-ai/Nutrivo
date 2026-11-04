import { EmptyState } from "@/components/kit";
import { obligationFields, type ObligationRow } from "@/lib/registration/model";

// S-NV2-008 Obligations (design: product/Nutrivo 2.0.dc.html, screen "obligations"). G01 (T-504): for each of the
// workspace's markets, the sourced obligations held, every BE-12 field with "not held" for a missing one, and their
// source and last-verified date. No obligation is eligible until a person can accept one (#54 Q4), so every market
// reads not assessed today. The design's Obligation title, Products, Due and Status columns have no backing data
// (#54 Q5) and are left out, as is its Compliance Worker panel.

export type ObligationsMarket = {
  nodeId: string;
  name: string;
  obligations: ObligationRow[];
  /** The market's registration coverage gap (ref.coverage_gaps), when it has one. */
  gap: { gapId: string; href: string } | null;
};

export function Obligations({ markets, workspaceId }: { markets: ObligationsMarket[]; workspaceId: string }) {
  return (
    <div data-obligations>
      <p data-testid="obligations-intro" className="m-0 mb-[16px] text-[14px] leading-[1.55] max-w-[92ch] text-n700">
        Who must be told, of what, by when, and where the evidence is. A compliant label is not permission to sell — this
        register is the difference between the two.
      </p>

      {markets.length === 0 ? (
        <div className="max-w-[640px]">
          <EmptyState
            where="OBLIGATIONS · NO MARKETS"
            title="No product is on a market yet"
            body="Obligations are listed per market. Once a product names the markets it is sold in, each market states what is held for it."
            action={{ label: "Add a product", href: `/w/${workspaceId}/products/new` }}
          />
        </div>
      ) : (
        <ul aria-label="Markets" className="m-0 p-0 list-none flex flex-col gap-[22px]">
          {markets.map((m) => (
            <Market key={m.nodeId} market={m} />
          ))}
        </ul>
      )}

      <div className="mt-[18px] border border-rule py-[15px] px-[17px] bg-panel max-w-[92ch]">
        <p className="m-0 font-mono text-[10px] tracking-[0.12em] uppercase text-n600">Where this data comes from</p>
        <p className="mt-[7px] mb-0 text-[13px] leading-[1.55] text-n700">
          Per-market authority research, taken from stored official sources and accepted by a person. It is not generated.
          A market with no sourced, dated and accepted obligation reads not assessed, never clear.
        </p>
      </div>
    </div>
  );
}

function Market({ market }: { market: ObligationsMarket }) {
  const headingId = `market-${market.nodeId}`;
  return (
    <li data-market={market.nodeId} data-market-state={market.obligations.length ? "held" : "not_assessed"}>
      <section aria-labelledby={headingId}>
        <div className="flex flex-wrap items-baseline gap-[12px] border-b border-ink pb-[6px]">
          <h2 id={headingId} className="m-0 text-[17px] font-semibold">
            {market.name}
          </h2>
          <span className="font-mono text-[10.5px] text-n600">{market.nodeId}</span>
        </div>
        {market.obligations.length === 0 ? (
          <div className="mt-[12px] max-w-[640px]">
            <EmptyState
              where={`OBLIGATIONS · ${market.nodeId}`}
              title="No sourced obligation held for this market."
              body="Registration not assessed. Nothing is listed until an obligation is researched from an official source, dated and accepted by a person."
              reference={market.gap ? { href: market.gap.href, label: `GAP ${market.gap.gapId} · why is this not assessed` } : undefined}
            />
          </div>
        ) : (
          <ul aria-label={`Obligations for ${market.name}`} className="m-0 p-0 list-none flex flex-col">
            {market.obligations.map((o) => (
              <li key={o.id} className="border-b border-rule py-[11px]">
                <ObligationFacts obligation={o} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </li>
  );
}

/** Every BE-12 field of one obligation, with "not held" where the row holds nothing, its source and its date. */
export function ObligationFacts({ obligation }: { obligation: ObligationRow }) {
  return (
    <dl data-obligation={obligation.id} className="m-0 grid grid-cols-1 md:grid-cols-2 gap-x-[22px]">
      {obligationFields(obligation).map((f) => (
        <div key={f.key} data-field={f.key} data-held={f.held} className="border-t border-rule py-[11px]">
          <dt className="m-0 font-mono text-[9.5px] tracking-[0.12em] uppercase text-n500">{f.label}</dt>
          <dd className="mt-[4px] mb-0 text-[13.5px] leading-[1.45] break-words">
            {!f.held ? (
              <span className="text-n600">{f.value}</span>
            ) : f.key === "source_url" ? (
              <a href={f.value} rel="noopener noreferrer" target="_blank" className="kit-transition font-mono text-[12px]">
                {f.value}
              </a>
            ) : (
              f.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
