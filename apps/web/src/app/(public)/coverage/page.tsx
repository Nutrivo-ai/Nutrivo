import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { connection } from "next/server";
import { cache, Suspense } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/kit";
import { SiteFooter, SiteHeader } from "@/components/public/Site";
import { REQUEST_ID_HEADER } from "@/lib/observability/request-id";
import { DOMAIN_LABEL, isoDay, longDay, readCoverage, type Coverage, type DomainState, type NodeCoverage, type RegionCoverage } from "@/lib/public/coverage";
import { PUBLIC_ROUTES, START } from "@/lib/public/links";
import { sx } from "@/lib/public/sx";

export const metadata: Metadata = { title: "Coverage · Nutrivo" };

// S-COV-001 (P01): design/public/Nutrivo Coverage - public.dc.html. Everything below the introduction that is a figure
// (markets, rules, dates, depths, gap ids, the ruleset) comes from public.coverage_snapshot(), read at request time
// (D-19). Omitted from the design (plan on issue #60): the per-region leads and the "Official languages",
// "Divergences tracked" and "Registration routes" figures (no source holds them), the authority row and the gap
// descriptions (the snapshot has neither), and the method and verifier columns (no named specialists, D-19).

const DEPTH: Record<DomainState, { label: string; color: string; glyph: string }> = {
  complete: { label: "COMPLETE", color: "var(--clear)", glyph: "width: 11px; height: 11px; flex: none; display: block; background: var(--clear); margin-top: 3px" },
  partial: { label: "PARTIAL", color: "var(--action)", glyph: "width: 0; height: 0; flex: none; display: block; border-left: 5.5px solid transparent; border-right: 5.5px solid transparent; border-bottom: 11px solid var(--action); margin-top: 3px" },
  not_encoded: { label: "NOT ENCODED", color: "var(--none)", glyph: "width: 11px; height: 11px; flex: none; display: block; border: 1.5px solid var(--none); border-radius: 50%; margin-top: 3px" },
};

/** What the design calls a node of each region in the detail title ("Poland · EU member state"). */
const REGION_NODE: Record<string, string> = { EU: "EU member state", UK: "UK", US: "United States" };

const corners = (
  <>
    <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
  </>
);
const eyebrow = "margin: 0; font-family: var(--mono); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent)";

const STATES = [
  { k: "Complete", title: "Every domain we check is encoded", color: "var(--clear)",
    v: "We hold rules across all of the domains a label check covers on this market. Nothing is withheld for want of a rule, and no domain is quietly absent.",
    effect: "Every domain returns an answer.", glyph: "width: 13px; height: 13px; flex: none; display: block; background: var(--clear)" },
  { k: "Partial", title: "Some domains encoded, the rest named", color: "var(--action)",
    v: "We hold rules for part of this market and we say which part. The excluded domains are listed by name with a gap identifier, never summarised as a percentage.",
    effect: "A result in an excluded domain returns Not assessed, citing the gap.", glyph: "width: 0; height: 0; flex: none; display: block; border-left: 6.5px solid transparent; border-right: 6.5px solid transparent; border-bottom: 13px solid var(--action)" },
  { k: "Not encoded", title: "We hold no rules for this market", color: "var(--none)",
    v: "No verdict is offered. We would rather tell you we cannot answer than produce something that looks like an answer.",
    effect: "The market can never render as Clear.", glyph: "width: 13px; height: 13px; flex: none; display: block; border: 1.5px solid var(--none); border-radius: 50%" },
];

const METHODS = [
  { tag: "01", k: "Machine extraction", color: "var(--accent)",
    v: "Official source text in, candidate rule out, with an article-level citation attached. The machine extracts a prescribed designation; it never translates one.",
    applies: "Does the volume. Publishes nothing on its own." },
  { tag: "02", k: "Acceptance by a person", color: "var(--action)",
    v: "Nothing publishes on extraction alone. A person accepts every entry, and numeric thresholds are extracted twice independently, with any disagreement routed to a person rather than to a tie-break rule.",
    applies: "Prescribed designations and claim wordings are accepted only against the cited article." },
  { tag: "03", k: "Currency", color: "var(--none)",
    v: "Rule-level diffs with stable identity across ruleset versions, typed by effect. An editorial change never raises an alert; a tightened threshold always does.",
    applies: "Keeps the date on every row above honest." },
];

const NEVERS = [
  "Submit a registration on your behalf",
  "Pay a fee to an authority",
  "Correspond with an authority for you",
  "Confirm that a registration is valid",
  "Guarantee that a label will be accepted",
];

const href = (region: string, node?: string) => `/coverage?region=${region}${node ? `&node=${node}` : ""}#node`;

type Params = { region?: string | string[]; node?: string | string[] };

export default function CoveragePage({ searchParams }: { searchParams: Promise<Params> }) {
  return (
    <div style={sx("width: 1280px; margin: 0 auto; background: var(--paper); font-size: 14px")}>
      <SiteHeader items={["Product", "Coverage", "Pricing", "About"]} current="Coverage" />
      <main>
        <Suspense fallback={<Lead generated={null} />}>
          <LiveLead />
        </Suspense>

        <section data-testid="states" style={sx("border-bottom: 1px solid var(--ink); padding: 44px 56px")}>
          <p style={sx(eyebrow)}>Three states a market can be in</p>
          <h2 style={sx("margin: 14px 0 0; font-size: 32px; font-weight: 600; line-height: 1.1; max-width: 34ch")}>Read this before you read a table</h2>
          <div style={sx("margin-top: 28px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 22px")}>
            {STATES.map((st) => (
              <div key={st.k} className="blueprint" style={sx(`position: relative; border: 1px solid var(--ink); border-top: 4px solid ${st.color}; padding: 22px 24px`)}>
                {corners}
                <div style={sx("display: flex; align-items: center; gap: 11px")}>
                  <span aria-hidden="true" style={sx(st.glyph)} />
                  <p style={sx(`margin: 0; font-family: var(--mono); font-size: 11px; letter-spacing: 0.11em; text-transform: uppercase; color: ${st.color}`)}>{st.k}</p>
                </div>
                <h3 style={sx("margin: 14px 0 0; font-size: 20px; font-weight: 600; line-height: 1.2; letter-spacing: normal")}>{st.title}</h3>
                <p style={sx("margin: 10px 0 0; font-size: 14px; line-height: 1.55; color: var(--n700)")}>{st.v}</p>
                <p style={sx("margin: 16px 0 0; padding-top: 13px; border-top: 1px solid var(--n200); font-size: 13.5px; line-height: 1.5; color: var(--n800)")}>
                  <span style={sx("font-family: var(--mono); font-size: 10px; letter-spacing: 0.08em; color: var(--n600)")}>IN A CHECK · </span>
                  {st.effect}
                </p>
              </div>
            ))}
          </div>
          <div className="blueprint" style={sx("position: relative; margin-top: 22px; border: 1px solid var(--ink); border-left: 4px solid var(--accent); background: var(--accent-100); padding: 20px 24px")}>
            {corners}
            <p style={sx("margin: 0; font-size: 16px; font-weight: 600")}>We only offer a market we would publish the depth of</p>
            <p style={sx("margin: 8px 0 0; font-size: 14px; line-height: 1.6; color: var(--n800); max-width: 112ch")}>Publishable equals sellable. That has a cost we accept: published depth is a commitment you can hold us to, and a market that quietly goes stale is worse than one we never published. Every row below carries the date a person last checked it, so you can see for yourself which is which.</p>
          </div>
        </section>

        <Suspense fallback={<Loading />}>
          <LiveCoverage searchParams={searchParams} />
        </Suspense>

        <section data-testid="method" style={sx("border-bottom: 1px solid var(--ink); padding: 44px 56px")}>
          <p style={sx(eyebrow)}>Method</p>
          <h2 style={sx("margin: 14px 0 0; font-size: 32px; font-weight: 600; line-height: 1.1; max-width: 36ch")}>How a rule gets into the system</h2>
          <p style={sx("margin: 14px 0 0; font-size: 15px; line-height: 1.6; color: var(--n700); max-width: 100ch")}>Machine extraction does the volume and a person accepts every entry. The critical distinction is that the machine <strong style={sx("font-weight: 600")}>extracts</strong> a prescribed legal term from official source text with an article-level citation. It never <strong style={sx("font-weight: 600")}>translates</strong> one. A linguistically perfect translation of a prescribed designation is still a defect.</p>
          <div style={sx("margin-top: 28px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px")}>
            {METHODS.map((m) => (
              <div key={m.tag} className="blueprint" style={sx(`position: relative; border: 1px solid var(--ink); border-top: 4px solid ${m.color}; padding: 20px 22px; display: flex; flex-direction: column`)}>
                {corners}
                <p style={sx(`margin: 0; font-family: var(--mono); font-size: 10px; letter-spacing: 0.1em; color: ${m.color}`)}>{m.tag}</p>
                <h3 style={sx("margin: 12px 0 0; font-size: 17px; font-weight: 600; line-height: 1.2; letter-spacing: normal")}>{m.k}</h3>
                <p style={sx("margin: 9px 0 0; font-size: 13px; line-height: 1.55; color: var(--n700); flex: 1")}>{m.v}</p>
                <p style={sx("margin: 14px 0 0; padding-top: 11px; border-top: 1px solid var(--n200); font-size: 12.5px; line-height: 1.5; color: var(--n800)")}>{m.applies}</p>
              </div>
            ))}
          </div>
        </section>

        <section data-testid="close" style={sx("padding: 48px 56px 56px")}>
          <div style={sx("display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr); gap: 48px; align-items: start")}>
            <div>
              <h2 style={sx("margin: 0; font-size: 34px; font-weight: 600; line-height: 1.08; max-width: 30ch; text-wrap: balance")}>The reason this page exists</h2>
              <p style={sx("margin: 16px 0 0; font-size: 16px; line-height: 1.6; color: var(--n700); max-width: 82ch; text-wrap: pretty")}>A compliance tool that answers everything is either much better than it looks or lying. Four states, and one of them is Not assessed — shown as prominently as the rest, because a label can be fully compliant and a product still unsellable, and because a silence you cannot see is the most expensive thing we could sell you.</p>
              <div style={sx("margin-top: 26px; display: flex; gap: 12px; align-items: center")}>
                <Link href={START} className="pub-primary" style={sx("background: var(--accent); color: var(--paper); padding: 13px 22px; border-radius: 3px; font-size: 15px; font-weight: 500")}>Check a label free</Link>
                <Link href={PUBLIC_ROUTES.pricing} className="pub-secondary" style={sx("border: 1px solid var(--n400); padding: 13px 20px; border-radius: 3px; font-size: 14.5px; color: var(--ink)")}>See the plans</Link>
              </div>
              <p style={sx("margin: 16px 0 0; font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.05em; color: var(--n600)")}>THREE LABELS FREE · NO CARD · NO SALES CALL</p>
            </div>
            <div className="blueprint" style={sx("position: relative; border: 1px solid var(--ink); padding: 22px 24px")}>
              {corners}
              <p style={sx("margin: 0; font-family: var(--mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--blocked)")}>What we never do, at any price</p>
              <div style={sx("margin-top: 14px; display: flex; flex-direction: column; gap: 9px")}>
                {NEVERS.map((nv) => (
                  <div key={nv} style={sx("display: grid; grid-template-columns: 14px minmax(0, 1fr); gap: 11px; align-items: baseline")}>
                    <span aria-hidden="true" style={sx("width: 11px; height: 11px; flex: none; margin-top: 4px; background: var(--blocked); box-shadow: inset 0 4px 0 var(--paper), inset 0 -4px 0 var(--blocked)")} />
                    <span style={sx("font-size: 13px; line-height: 1.5; color: var(--n800)")}>{nv}</span>
                  </div>
                ))}
              </div>
              <p style={sx("margin: 16px 0 0; padding-top: 13px; border-top: 1px solid var(--n200); font-size: 12.5px; line-height: 1.55; color: var(--n700)")}>Only the responsible operator named on the label can register a product. We name the obligation, the authority, the route, the evidence, the fee and the deadline, and pre-fill everything your product record answers. You file it.</p>
            </div>
          </div>
        </section>
      </main>
      <Suspense fallback={<SiteFooter note="COVERAGE GENERATED FROM THE RELEASED RULESET" />}>
        <LiveFooter />
      </Suspense>
    </div>
  );
}

/** One read per request, shared by the parts of the page that show it. */
const read = cache(async () => {
  await connection();
  const requestId = (await headers()).get(REQUEST_ID_HEADER) ?? undefined;
  return { result: await readCoverage(requestId), at: new Date() };
});

function Lead({ generated }: { generated: { at: Date; coverage: Coverage } | null }) {
  const markets = generated ? generated.coverage.regions.reduce((n, r) => n + r.nodes.length, 0) : 0;
  return (
    <section data-testid="lead" style={sx("border-bottom: 1px solid var(--ink); padding: 52px 56px 44px")}>
      <div style={sx("display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 0.75fr); gap: 56px; align-items: end")}>
        <div data-testid="lead-text">
          <p style={sx(eyebrow)}>Coverage</p>
          <h1 style={sx("margin: 14px 0 0; font-size: 52px; font-weight: 600; line-height: 1.02; letter-spacing: -0.035em; max-width: 26ch; text-wrap: balance")}>What we have encoded, market by market, and what we have not</h1>
          <p style={sx("margin: 18px 0 0; font-size: 16.5px; line-height: 1.55; color: var(--n700); max-width: 78ch; text-wrap: pretty")}>Every market we sell is on this page with the rules we hold for it, the method they were encoded by, the date a person last verified them, and the gaps we know about by name. It is generated from the same table the product queries when it runs a check, so it cannot drift from what the product actually does.</p>
        </div>
        <div>
          <div style={sx("border: 1px solid var(--ink); padding: 20px 22px")}>
            <p style={sx("margin: 0; font-family: var(--mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--n600)")}>Never on this page</p>
            <p style={sx("margin: 10px 0 0; font-size: 14px; line-height: 1.55; color: var(--n800)")}>
              A single coverage percentage. There is no honest number that summarises {markets > 0 ? <span data-testid="market-count">{markets} markets</span> : "a market"}, and any number invites a target.
            </p>
          </div>
          {generated?.coverage.rulesetVersion ? (
            <p data-testid="generated" style={sx("margin: 14px 0 0; font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.05em; color: var(--n600)")}>
              GENERATED {longDay(generated.at).toUpperCase()} · RULESET {generated.coverage.rulesetVersion}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

async function LiveLead() {
  const { result, at } = await read();
  return <Lead generated={result.ok ? { at, coverage: result.coverage } : null} />;
}

async function LiveFooter() {
  const { result, at } = await read();
  const version = result.ok ? result.coverage.rulesetVersion : null;
  return <SiteFooter note={version ? `COVERAGE GENERATED FROM RULESET ${version} · ${longDay(at).toUpperCase()}` : "COVERAGE GENERATED FROM THE RELEASED RULESET"} />;
}

function Loading() {
  return (
    <section style={sx("border-bottom: 1px solid var(--ink); padding: 44px 56px")}>
      <LoadingState label="READING THE RELEASED RULESET" />
    </section>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function LiveCoverage({ searchParams }: { searchParams: Promise<Params> }) {
  const [{ result }, params] = await Promise.all([read(), searchParams]);
  if (!result.ok) {
    return (
      <section data-testid="coverage-error" style={sx("border-bottom: 1px solid var(--ink); padding: 44px 56px")}>
        <ErrorState
          where="COVERAGE · PUBLIC"
          title="Coverage could not be read just now"
          body="Nothing on this page is shown from memory: until the released ruleset can be read, no market's depth is published here."
          action={{ label: "Try again", href: PUBLIC_ROUTES.coverage }}
        />
      </section>
    );
  }
  const { coverage } = result;
  if (coverage.regions.length === 0) {
    return (
      <section data-testid="coverage-empty" style={sx("border-bottom: 1px solid var(--ink); padding: 44px 56px")}>
        <EmptyState
          where="COVERAGE · PUBLIC"
          title="No market is published yet"
          body="No ruleset holds a market yet, so no market is offered and none can render as Clear."
          action={{ label: "See the plans", href: PUBLIC_ROUTES.pricing, variant: "secondary" }}
        />
      </section>
    );
  }
  const node = first(params.node);
  const byNode = coverage.regions.find((r) => r.nodes.some((n) => n.id === node));
  const region = coverage.regions.find((r) => r.id === first(params.region)) ?? byNode ?? coverage.regions[0];
  const detail = region.nodes.find((n) => n.id === node) ?? region.nodes[0];
  return (
    <>
      <RegionIndex coverage={coverage} region={region} detail={detail} />
      <NodeDetail region={region} node={detail} rulesetVersion={coverage.rulesetVersion} />
    </>
  );
}

function RegionIndex({ coverage, region, detail }: { coverage: Coverage; region: RegionCoverage; detail: NodeCoverage }) {
  const stats = [
    { k: region.id === "EU" ? "Member states offered" : "Markets offered", n: region.nodes.length, v: "The region is sold whole.", color: "var(--ink)" },
    { k: "Complete", n: region.complete, v: "Every domain we check is encoded", color: "var(--clear)" },
    { k: "Partial", n: region.partial, v: "Gaps named on the row, never summarised", color: "var(--action)" },
    { k: "Not encoded", n: region.notEncoded, v: "No verdict is offered.", color: "var(--none)" },
  ];
  const cols = "display: grid; grid-template-columns: minmax(0, 1.25fr) 108px 136px 132px minmax(0, 1.5fr)";
  return (
    <section data-testid="regions" style={sx("border-bottom: 1px solid var(--ink); padding: 44px 56px")}>
      <div style={sx("display: flex; align-items: flex-end; justify-content: space-between; gap: 40px")}>
        <div>
          <p style={sx(eyebrow)}>By region</p>
          <h2 style={sx("margin: 14px 0 0; font-size: 32px; font-weight: 600; line-height: 1.1")}>Markets are a tree, so coverage is too</h2>
          <p style={sx("margin: 12px 0 0; font-size: 15px; line-height: 1.55; color: var(--n700); max-width: 84ch")}>A region is a regime; a market inside it is one country, or one US state. A parent never conceals a failing child, and it never inherits a child&apos;s depth.</p>
        </div>
        <nav aria-label="Regions" style={sx("flex: none; display: flex; gap: 8px")}>
          {coverage.regions.map((r) => {
            const on = r.id === region.id;
            return (
              <Link
                key={r.id}
                href={href(r.id)}
                scroll={false}
                aria-current={on ? "page" : undefined}
                className="pub-tab"
                style={sx(`border: 1px solid ${on ? "var(--accent)" : "var(--n400)"}; background: ${on ? "var(--accent-100)" : "var(--paper)"}; color: ${on ? "var(--accent-700)" : "var(--n700)"}; padding: 9px 20px; font-size: 14px; font-weight: ${on ? "600" : "400"}`)}
              >
                {r.id}
              </Link>
            );
          })}
        </nav>
      </div>

      <div data-testid="region-stats" style={sx("margin-top: 26px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border: 1px solid var(--ink)")}>
        {stats.map((s, i) => (
          <div key={s.k} style={sx(`padding: 18px 20px; border-right: ${i < 3 ? "1px solid var(--rule)" : "none"}`)}>
            <p style={sx("margin: 0; font-family: var(--mono); font-size: 10px; letter-spacing: 0.11em; text-transform: uppercase; color: var(--n600)")}>{s.k}</p>
            <p data-stat={s.k} style={sx(`margin: 10px 0 0; font-family: var(--mono); font-size: 30px; line-height: 1; color: ${s.color}`)}>{s.n}</p>
            <p style={sx("margin: 8px 0 0; font-size: 12.5px; line-height: 1.45; color: var(--n700)")}>{s.v}</p>
          </div>
        ))}
      </div>

      <div role="table" aria-label={`Coverage of ${region.id}`} style={sx("margin-top: 22px; border: 1px solid var(--ink)")}>
        <div role="row" style={sx(`${cols}; background: var(--panel); border-bottom: 1px solid var(--ink)`)}>
          {["Market", "Rules", "Last checked", "Depth", "Named gaps"].map((th) => (
            <p key={th} role="columnheader" style={sx("margin: 0; padding: 11px 15px; font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--n600)")}>{th}</p>
          ))}
        </div>
        {region.nodes.map((n, i, a) => (
          <div key={n.id} role="row" data-node={n.id} style={sx(`${cols}; border-bottom: ${i < a.length - 1 ? "1px solid var(--n200)" : "none"}; background: ${i % 2 ? "var(--panel)" : "transparent"}`)}>
            <div role="cell" style={sx("padding: 12px 15px; display: flex; gap: 10px; align-items: baseline")}>
              <span aria-hidden="true" style={sx(DEPTH[n.depth].glyph)} />
              <div style={sx("min-width: 0")}>
                <p style={sx("margin: 0; font-size: 13.5px; font-weight: 500; line-height: 1.3")}>{n.name}</p>
                <p style={sx("margin: 3px 0 0; font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.05em; color: var(--n600)")}>{n.id.replace("-", " · ")}</p>
              </div>
            </div>
            <p role="cell" data-col="rules" style={sx(`margin: 0; padding: 12px 15px; font-family: var(--mono); font-size: 13px; color: ${n.rules === 0 ? "var(--none)" : "var(--ink)"}`)}>{n.rules}</p>
            <p role="cell" data-col="last-checked" style={sx("margin: 0; padding: 12px 15px; font-family: var(--mono); font-size: 11px; color: var(--ink)")}>{isoDay(n.lastChecked)}</p>
            <p role="cell" data-col="depth" style={sx(`margin: 0; padding: 12px 15px; font-family: var(--mono); font-size: 10px; letter-spacing: 0.06em; color: ${DEPTH[n.depth].color}`)}>{DEPTH[n.depth].label}</p>
            <div role="cell" style={sx("padding: 12px 15px")}>
              <p data-col="gaps" style={sx("margin: 0; font-size: 12px; line-height: 1.45; color: var(--n700); overflow-wrap: anywhere")}>{n.gaps.length ? n.gaps.join(", ") : "None open."}</p>
              {n.id !== detail.id ? (
                <Link href={href(region.id, n.id)} scroll={false} aria-label={`Full detail: ${n.name}`} style={sx("display: inline-block; margin-top: 6px; font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.07em")}>FULL DETAIL →</Link>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <div style={sx("margin-top: 14px; display: flex; flex-wrap: wrap; gap: 26px; font-family: var(--mono); font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--n600)")}>
        {["Filled square = complete", "Triangle = partial, gaps named", "Hollow circle = not encoded", "Rules = individual encoded rules, not documents", "No aggregate figure is published"].map((lg) => (
          <span key={lg}>{lg}</span>
        ))}
      </div>
    </section>
  );
}

function NodeDetail({ region, node, rulesetVersion }: { region: RegionCoverage; node: NodeCoverage; rulesetVersion: string | null }) {
  const domainCols = "display: grid; grid-template-columns: minmax(0, 1fr) 92px minmax(0, 0.85fr)";
  const facts = [
    { k: "Ruleset binding", v: rulesetVersion ?? "—", color: "var(--ink)" },
    { k: "Rules encoded", v: String(node.rules), color: "var(--ink)" },
    { k: "Last checked", v: isoDay(node.lastChecked), color: "var(--ink)" },
    { k: "Domains encoded", v: `${node.domainsEncoded} OF ${node.domains.length}`, color: DEPTH[node.depth].color },
    { k: "Depth", v: DEPTH[node.depth].label, color: DEPTH[node.depth].color },
  ];
  return (
    <section id="node" data-testid="node" style={sx("border-bottom: 1px solid var(--ink); padding: 44px 56px; background: var(--panel)")}>
      <div style={sx("display: flex; align-items: flex-end; justify-content: space-between; gap: 40px")}>
        <div>
          <p style={sx(eyebrow)}>One market in full</p>
          <h2 style={sx("margin: 14px 0 0; font-size: 32px; font-weight: 600; line-height: 1.1")}>{`${node.name} · ${REGION_NODE[region.id] ?? region.id}`}</h2>
          <p style={sx("margin: 12px 0 0; font-family: var(--mono); font-size: 11px; letter-spacing: 0.05em; color: var(--n600)")}>{href(region.id, node.id).replace("#node", "")}</p>
        </div>
        <p style={sx("margin: 0; flex: none; max-width: 42ch; font-size: 14px; line-height: 1.55; color: var(--n700)")}>Every result the product withholds links here, to the market and the domain that explains it. A finding we could not check is never a silence.</p>
      </div>

      <div style={sx("margin-top: 26px; display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 0.7fr); gap: 22px; align-items: start")}>
        <div className="blueprint" style={sx("position: relative; border: 1px solid var(--ink); background: var(--paper); padding: 24px 26px")}>
          {corners}
          <p style={sx("margin: 0; font-family: var(--mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--n600)")}>By domain</p>
          <div role="table" aria-label={`Domains of ${node.name}`} style={sx("margin-top: 16px; border: 1px solid var(--rule)")}>
            <div role="row" style={sx(`${domainCols}; background: var(--panel); border-bottom: 1px solid var(--ink)`)}>
              {["Domain", "Rules", "Encoded"].map((h) => (
                <p key={h} role="columnheader" style={sx("margin: 0; padding: 9px 13px; font-family: var(--mono); font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--n600)")}>{h}</p>
              ))}
            </div>
            {node.domains.map((d, i, a) => (
              <div key={d.domain} role="row" data-domain={d.domain} style={sx(`${domainCols}; border-bottom: ${i < a.length - 1 ? "1px solid var(--n200)" : "none"}; background: ${i % 2 ? "var(--panel)" : "transparent"}`)}>
                <p role="cell" style={sx("margin: 0; padding: 10px 13px; font-size: 12.5px; line-height: 1.3")}>{DOMAIN_LABEL[d.domain as keyof typeof DOMAIN_LABEL] ?? d.domain}</p>
                <p role="cell" style={sx(`margin: 0; padding: 10px 13px; font-family: var(--mono); font-size: 12px; color: ${d.rules_encoded === 0 ? "var(--none)" : "var(--ink)"}`)}>{d.rules_encoded}</p>
                <p role="cell" style={sx(`margin: 0; padding: 10px 13px; font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.06em; color: ${DEPTH[d.state].color}; overflow-wrap: anywhere`)}>{d.state === "complete" ? "ENCODED" : d.gap_id ?? DEPTH[d.state].label}</p>
              </div>
            ))}
          </div>
          <p style={sx("margin: 16px 0 0; font-size: 13px; line-height: 1.55; color: var(--n700)")}>A domain is either encoded or it is not, and where it is not the gap has an identifier. There is no partial credit on a domain and no wording that lets an absence read as a pass.</p>
        </div>

        <div style={sx("display: flex; flex-direction: column; gap: 20px")}>
          <div className="blueprint" style={sx("position: relative; border: 1px solid var(--ink); background: var(--paper); padding: 22px 24px")}>
            {corners}
            <p style={sx("margin: 0; font-family: var(--mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--n600)")}>On the record</p>
            <dl style={sx("margin: 14px 0 0; display: flex; flex-direction: column; gap: 8px")}>
              {facts.map((f) => (
                <div key={f.k} style={sx("display: flex; justify-content: space-between; gap: 14px; align-items: baseline; border-bottom: 1px solid var(--n200); padding-bottom: 8px")}>
                  <dt style={sx("font-size: 12.5px; color: var(--n700)")}>{f.k}</dt>
                  <dd data-fact={f.k} style={sx(`margin: 0; font-family: var(--mono); font-size: 11.5px; text-align: right; color: ${f.color}`)}>{f.v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="blueprint" style={sx("position: relative; border: 1px solid var(--ink); border-left: 4px solid var(--none); background: var(--paper); padding: 22px 24px")}>
            {corners}
            <p style={sx("margin: 0; font-family: var(--mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--none)")}>Named gaps</p>
            <div data-testid="node-gaps" style={sx("margin-top: 14px; display: flex; flex-direction: column; gap: 14px")}>
              {node.gaps.length ? (
                node.gaps.map((g) => (
                  <p key={g} style={sx("margin: 0; font-family: var(--mono); font-size: 10px; letter-spacing: 0.06em; color: var(--n600); overflow-wrap: anywhere")}>{g}</p>
                ))
              ) : (
                <div>
                  <p style={sx("margin: 0; font-family: var(--mono); font-size: 10px; letter-spacing: 0.06em; color: var(--n600)")}>NO GAPS OPEN</p>
                  <p style={sx("margin: 6px 0 0; font-size: 13px; line-height: 1.55; color: var(--n800)")}>Every domain we check is encoded on this market, and results are reportable without qualification.</p>
                </div>
              )}
            </div>
            <p style={sx("margin: 16px 0 0; padding-top: 13px; border-top: 1px solid var(--n200); font-size: 12.5px; line-height: 1.5; color: var(--n700)")}>A gap has an identifier because it is referenced from every result it affects, and because it has to be closable.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
