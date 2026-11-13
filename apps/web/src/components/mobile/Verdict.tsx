"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ProductNotFound } from "@/components/artwork/ProductNotFound";
import { ButtonLink, CitationLink, EmptyState, GapLink, ProvenanceTag, StateGlyph, STATE_BORDER, STATE_LABEL, STATE_TEXT, STATE_TINT, cx } from "@/components/kit";
import { Screen } from "@/components/shell";
import type { Verdict as VerdictModel, VerdictSource } from "@/lib/verdict/model";
import type { VerdictPage } from "@/lib/verdict/queries";

// S-MOB-003 The verdict (product/Nutrivo Mobile.dc.html, "Read a verdict"): the state, the one thing to do next, and
// where the answer came from, in the phone's three blocks. It renders at every width; the desktop Product × node
// layout (S-NV2-007) belongs to T-504 (#57 question 4). Everything with a table behind it links to the label report.
export function Verdict({ route, workspaceId, page }: { route: string; workspaceId: string; page: VerdictPage }) {
  return (
    <Screen route={route} crumb="Portfolio · Verdict" title={page.kind === "not-found" ? undefined : page.product.name}>
      {page.kind === "not-found" ? (
        <ProductNotFound workspaceId={workspaceId} />
      ) : page.kind === "no-market" ? (
        <div className="max-w-[640px]">
          <EmptyState
            where="NOT A MARKET OF THIS PRODUCT"
            title="This product is not sold in this market"
            body="The product's label report lists every market it is checked for. Markets are added at a desk."
            action={{ label: "Open the label report", href: `/w/${workspaceId}/products/${page.product.id}/report` }}
          />
        </div>
      ) : page.kind === "outside-plan" ? (
        // J04.must.1 (T-902): the region is not in the plan, so the finding is not read or shown. Nothing here is a
        // paywall: the alerts inbox still names the change and the recipes it affects.
        <div className="max-w-[640px]" data-region="outside-plan">
          <EmptyState
            where={`NOT IN YOUR PLAN · ${page.regionName.toUpperCase()}`}
            title={`Your plan does not include ${page.regionName}`}
            body={`The findings for ${page.product.name} in ${page.nodeName} open once the plan holds ${page.regionName}. Alerts for it still say what changed and which recipes it affects.`}
            action={{ label: "Open the alerts inbox", href: `/w/${workspaceId}/alerts` }}
            aside={`An admin of this workspace can add ${page.regionName} to the plan.`}
          />
        </div>
      ) : (
        <Blocks verdict={page.verdict} />
      )}
    </Screen>
  );
}

function Blocks({ verdict: v }: { verdict: VerdictModel }) {
  return (
    <section
      aria-label={`Verdict in ${v.nodeName}`}
      data-region="verdict"
      data-state={v.state}
      className="-mx-[16px] -mt-[24px] md:mx-0 md:mt-0 md:max-w-[560px] md:border md:border-rule"
    >
      <p className="m-0 flex justify-end py-[6px] px-[14px] font-mono text-[9px] tracking-[0.05em] text-n600 border-b border-n200 md:hidden">
        {v.chrome}
      </p>
      <Block className={cx(STATE_TINT[v.state], "border-l-[4px]", STATE_BORDER[v.state])} region="state">
        <div className="flex items-center gap-[8px] mb-[7px]">
          <StateGlyph state={v.state} />
          <span className={cx("font-mono text-[9.5px] tracking-[0.07em] uppercase", STATE_TEXT[v.state])}>{STATE_LABEL[v.state]}</span>
        </div>
        <h2 className="m-0 font-head text-[19px] font-semibold leading-[1.2] tracking-normal">{v.title}</h2>
        <p className="mt-[6px] mb-0 text-[12.5px] leading-[1.5] text-n700">{v.body}</p>
        {!v.subject.isSelf ? (
          <p className="mt-[6px] mb-0 text-[12.5px] leading-[1.5]">
            <Link href={v.subject.href} className="inline-flex items-center min-h-[44px]">
              Open {v.subject.name}
            </Link>
          </p>
        ) : null}
      </Block>
      <Block region="todo">
        <Kicker>What to do</Kicker>
        <p className="m-0 text-[12.5px] leading-[1.5] text-n700">{v.todo.body}</p>
        {v.todo.link ? (
          <ButtonLink
            variant="primary"
            size="md"
            href={v.todo.link.href}
            className="mt-[11px] flex items-center justify-center min-h-[44px] w-full rounded-[3px] text-[13.5px]"
          >
            {v.todo.link.label}
          </ButtonLink>
        ) : null}
      </Block>
      <Block region="source" last>
        <Kicker>Where this came from</Kicker>
        <Source source={v.source} />
        {v.pinned ? (
          <p data-pinned className="mt-[6px] mb-0 font-mono text-[10px] leading-[1.5] text-n600">
            Checked {new Date(v.pinned.checkedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })} · ruleset{" "}
            {v.pinned.rulesetVersion} · {v.pinned.rulesetCurrent ? "current" : "superseded"}
            {v.pinned.artworkSha ? ` · artwork ${v.pinned.artworkSha.slice(0, 12)}` : ""}
          </p>
        ) : null}
        <p className="mt-[6px] mb-0 text-[12.5px] leading-[1.5]">
          <Link href={v.reportHref} className="inline-flex items-center min-h-[44px]">
            Every finding, on the label report
          </Link>
        </p>
      </Block>
    </section>
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

function Source({ source }: { source: VerdictSource }) {
  const text = "m-0 text-[12.5px] leading-[1.5] text-n700";
  switch (source.kind) {
    case "rule":
      return (
        <p className={text}>
          <ProvenanceTag provenance={source.provenance} className="text-[10px]" /> ·{" "}
          <CitationLink ruleKey={source.ruleKey} citation={source.citation} className="text-[11px]" />. {source.note}
        </p>
      );
    case "gap":
      return (
        <div className={text}>
          <p className="m-0">
            <ProvenanceTag provenance="not_assessed" className="text-[10px]" />. {source.note}
          </p>
          <GapLink gapId={source.gapId} href={source.href} className="mt-[4px] text-[10px] [&_a]:inline-flex [&_a]:items-center [&_a]:min-h-[44px]" />
        </div>
      );
    default:
      return <p className={text}>{source.note}</p>;
  }
}
