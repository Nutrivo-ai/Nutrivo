import Link from "next/link";
import type { ReactNode } from "react";
import { ProductNotFound } from "@/components/artwork/ProductNotFound";
import { EmptyState, StateGlyph, STATE_TEXT, cx } from "@/components/kit";
import { Screen } from "@/components/shell";
import type { MarketRow, MarketsModel } from "@/lib/products/markets";
import type { MarketsPage } from "@/lib/products/markets-queries";

// S-MOB-002 One recipe, its markets (product/Nutrivo Mobile.dc.html, "Read a verdict", second phone): the recipe, its
// markets grouped by region with each region's roll-up first (BE-15), and when it was last checked. It renders at every
// width: the phone's blocks at 390 px, the same blocks in a bordered column from md up (no desktop frame draws this
// route, spec/screens.yaml). Every row is a link to that market's verdict (S-MOB-003); the page has no button.
export function Markets({ route, workspaceId, page }: { route: string; workspaceId: string; page: MarketsPage }) {
  return (
    <Screen route={route} crumb="Portfolio · Recipe" title={page.kind === "not-found" ? undefined : page.kind === "empty" ? page.product.name : page.markets.name}>
      {page.kind === "not-found" ? (
        <ProductNotFound workspaceId={workspaceId} />
      ) : page.kind === "empty" ? (
        <div className="max-w-[640px]" data-region="markets-empty">
          <EmptyState
            where="NO MARKETS YET"
            title="This product is not sold in any market yet"
            body="A market is chosen when a label is checked. Upload the artwork and choose where the product is sold."
            action={{ label: "Upload & scope", href: `/w/${workspaceId}/products/${page.product.id}/check` }}
          />
        </div>
      ) : (
        <Blocks m={page.markets} />
      )}
    </Screen>
  );
}

function Blocks({ m }: { m: MarketsModel }) {
  return (
    <section
      aria-label={`Markets of ${m.name}`}
      data-region="markets"
      className="-mx-[16px] -mt-[24px] md:mx-0 md:mt-0 md:max-w-[560px] md:border md:border-rule"
    >
      <Block region="recipe">
        <Kicker>{m.kicker}</Kicker>
        <h2 className="m-0 font-head text-[14.5px] font-semibold leading-[1.2] tracking-normal">{m.title}</h2>
      </Block>
      <Block region="rows" className="py-[8px]">
        {m.groups.map((g) => (
          <ul key={g.regionId} aria-label={g.rows[0].name} data-group={g.regionId} className="m-0 p-0 list-none">
            {g.rows.map((r) => (
              <Row key={r.nodeId} row={r} />
            ))}
          </ul>
        ))}
      </Block>
      <Block region="checked" last>
        <Kicker>Checked</Kicker>
        <p data-checked={m.checked.kind} className="m-0 text-[12.5px] leading-[1.5] text-n700">
          {m.checked.body}
        </p>
        <p className="mt-[2px] mb-0 text-[12.5px] leading-[1.5]">
          {m.checked.kind === "never" ? (
            <Link href={m.checked.link.href} className="inline-flex items-center min-h-[44px]">
              {m.checked.link.label}
            </Link>
          ) : (
            <Link href={m.reportHref} className="inline-flex items-center min-h-[44px]">
              Every finding, on the label report
            </Link>
          )}
        </p>
      </Block>
    </section>
  );
}

function Row({ row }: { row: MarketRow }) {
  return (
    <li data-node={row.nodeId} data-kind={row.kind} data-state={row.state}>
      <Link
        href={row.href}
        className="flex items-center gap-[9px] min-h-[44px] text-ink no-underline hover:bg-accent-100 kit-transition"
      >
        <StateGlyph state={row.state} />
        <span className={cx("flex-1 min-w-0 truncate text-[13px]", row.kind === "region" && "font-mono text-[11px] tracking-[0.06em] text-n700")}>
          {row.label}
          {row.kind === "region" ? <span className="sr-only">, rolled up over its markets</span> : null}
        </span>
        <span className={cx("flex-none font-mono text-[9.5px] tracking-[0.07em] uppercase", STATE_TEXT[row.state])}>{row.value}</span>
      </Link>
    </li>
  );
}

function Block({ children, className, region, last }: { children: ReactNode; className?: string; region: string; last?: boolean }) {
  return (
    <div data-region={region} className={cx("p-[14px]", !last && "border-b border-n200", className)}>
      {children}
    </div>
  );
}

function Kicker({ children }: { children: ReactNode }) {
  return <p className="mt-0 mb-[5px] font-mono text-[9px] leading-[normal] tracking-[0.09em] uppercase text-n600">{children}</p>;
}
