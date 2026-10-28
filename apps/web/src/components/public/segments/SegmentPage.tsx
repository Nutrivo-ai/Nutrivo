import Link from "next/link";
import { Page, SiteFooter, SiteHeader } from "@/components/public/Site";
import { segmentHref } from "@/lib/public/links";
import { sx } from "@/lib/public/sx";
import { ANCHOR, SEE_COVERAGE, SEGMENT_CONTENT, type Cta, type Glyph, type Segment, type Tone } from "./content";
import "./segments.css";

// One segment page (S-SEG-001…005), ported declaration by declaration from design/public/Nutrivo Segment Pages.dc.html.
// The design's load animation (ntv-slide) is not carried over (Cobalt §5). Blocks the content omits are not drawn.

const TONE: Record<Tone, string> = {
  clear: "var(--clear)",
  action: "var(--action)",
  none: "var(--none)",
  blocked: "var(--blocked)",
  accent: "var(--accent)",
  ink: "var(--ink)",
};

const GLYPH: Record<Glyph, string> = {
  clear: "width: 12px; height: 12px; flex: none; display: block; background: var(--clear); margin-top: 5px",
  action: "width: 0; height: 0; flex: none; display: block; border-left: 6px solid transparent; border-right: 6px solid transparent; border-bottom: 12px solid var(--action); margin-top: 5px",
  none: "width: 12px; height: 12px; flex: none; display: block; border: 1.5px solid var(--none); border-radius: 50%; margin-top: 5px",
};

const KICKER = "margin: 0; font-family: var(--mono); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent)";
const CTA_PRIMARY = "background: var(--accent); color: var(--paper); padding: 13px 22px; border-radius: 3px; font-size: 15px; font-weight: 500";
const CTA_SECONDARY = "border: 1px solid var(--n400); padding: 13px 20px; border-radius: 3px; font-size: 14.5px; color: var(--ink)";
const CTA_NOTE = "margin: 15px 0 0; font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.05em; color: var(--n600)";

function Corners() {
  return (
    <>
      <i className="corner tl" />
      <i className="corner tr" />
      <i className="corner bl" />
      <i className="corner br" />
    </>
  );
}

function Ctas({ primary, secondary, note }: { primary: Cta; secondary: Cta; note?: string }) {
  return (
    <>
      <div style={sx("margin-top: 26px; display: flex; gap: 12px; align-items: center")}>
        <Link href={primary.href} className="pub-primary" style={sx(CTA_PRIMARY)}>{primary.label}</Link>
        <Link href={secondary.href} className="pub-secondary" style={sx(CTA_SECONDARY)}>{secondary.label}</Link>
      </div>
      {note && <p style={sx(CTA_NOTE)}>{note}</p>}
    </>
  );
}

/** The strip under the header: the five segment pages, the current one marked. */
function SegmentTabs({ current }: { current: Segment }) {
  return (
    <nav aria-label="Who it's for" style={sx("border-bottom: 1px solid var(--ink); background: var(--panel); padding: 0 56px")}>
      <div style={sx("display: flex; gap: 0")}>
        {SEGMENT_CONTENT.map((seg) => {
          const on = seg.key === current.key;
          return (
            <Link
              key={seg.key}
              href={segmentHref(seg.slug)}
              aria-current={on ? "page" : undefined}
              className="seg-tab"
              style={sx(
                `border: none; background: ${on ? "var(--paper)" : "transparent"}; border-bottom: 3px solid ${on ? "var(--accent)" : "transparent"}; padding: 15px 22px 12px; cursor: pointer; text-align: left; color: var(--ink)`,
              )}
            >
              <span aria-hidden="true" style={sx(`display: block; font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.1em; color: ${on ? "var(--accent)" : "var(--n600)"}`)}>{seg.n}</span>
              <span style={sx(`display: block; margin-top: 5px; font-size: 13.5px; font-weight: ${on ? "600" : "400"}; white-space: nowrap`)}>{seg.tab}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function SegmentPage({ seg }: { seg: Segment }) {
  const cols = seg.flow.length;
  const card = seg.heroCard;
  return (
    <Page css="width: 1280px; margin: 0 auto; background: var(--paper); font-size: 14px">
      <div data-testid="seg-top">
        <SiteHeader items={["Product", "Who it's for", "Coverage", "Pricing"]} current="Who it's for" />
        <SegmentTabs current={seg} />
      </div>

      <main>
        <section data-testid="seg-hero" style={sx("border-bottom: 1px solid var(--ink); padding: 50px 56px 44px")}>
          <div style={sx("display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 0.7fr); gap: 52px; align-items: end")}>
            <div>
              <p style={sx(KICKER)}>{seg.kicker}</p>
              <h1 style={sx("margin: 14px 0 0; font-size: 50px; font-weight: 600; line-height: 1.03; letter-spacing: -0.035em; max-width: 26ch; text-wrap: balance")}>{seg.headline}</h1>
              <p style={sx("margin: 18px 0 0; font-size: 16.5px; line-height: 1.55; color: var(--n700); max-width: 76ch; text-wrap: pretty")}>{seg.sub}</p>
              <Ctas primary={seg.cta} secondary={seg.cta2} note={seg.ctaNote} />
            </div>
            <div className="blueprint" style={sx(`position: relative; border: 1px solid var(--ink); border-top: 4px solid ${TONE[card.tone]}; background: ${card.bg}; padding: 22px 24px`)}>
              <Corners />
              <p style={sx(`margin: 0; font-family: var(--mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: ${TONE[card.tone]}`)}>{card.kicker}</p>
              <p style={sx("margin: 12px 0 0; font-size: 19px; font-weight: 600; line-height: 1.25")}>{card.title}</p>
              <p style={sx("margin: 10px 0 0; font-size: 14px; line-height: 1.55; color: var(--n700)")}>{card.body}</p>
            </div>
          </div>
        </section>

        <section data-testid="seg-problem" style={sx("border-bottom: 1px solid var(--ink); padding: 44px 56px")}>
          <p style={sx(KICKER)}>What actually happens today</p>
          <h2 style={sx("margin: 14px 0 0; font-size: 32px; font-weight: 600; line-height: 1.1; max-width: 36ch")}>{seg.problemTitle}</h2>
          <div style={sx("margin-top: 28px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 22px")}>
            {seg.problems.map((p) => (
              <div key={p.k} style={sx(`border-top: 3px solid ${TONE[p.bar]}; padding-top: 16px`)}>
                <h3 style={sx("margin: 0; font-size: 18px; font-weight: 600; line-height: 1.25; letter-spacing: normal")}>{p.k}</h3>
                {p.v && <p style={sx("margin: 10px 0 0; font-size: 14px; line-height: 1.6; color: var(--n700)")}>{p.v}</p>}
              </div>
            ))}
          </div>
        </section>

        <section id={ANCHOR.flow} data-testid="seg-flow" style={sx("border-bottom: 1px solid var(--ink); padding: 44px 56px; background: var(--panel)")}>
          <div style={sx("display: flex; align-items: flex-end; justify-content: space-between; gap: 40px")}>
            <div>
              <p style={sx(KICKER)}>{seg.flowKicker}</p>
              <h2 style={sx("margin: 14px 0 0; font-size: 32px; font-weight: 600; line-height: 1.1; max-width: 34ch")}>{seg.flowTitle}</h2>
            </div>
            <p style={sx("margin: 0; flex: none; max-width: 40ch; font-size: 14px; line-height: 1.55; color: var(--n700)")}>{seg.flowNote}</p>
          </div>
          <ol style={sx(`margin: 26px 0 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(${cols}, minmax(0, 1fr)); border: 1px solid var(--ink); background: var(--paper)`)}>
            {seg.flow.map((f, i) => (
              <li key={f.n} style={sx(`padding: 20px 20px; display: flex; flex-direction: column; min-height: 214px; border-right: ${i < cols - 1 ? "1px solid var(--rule)" : "none"}`)}>
                <p style={sx("margin: 0; font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.1em; color: var(--accent)")}>{f.n}</p>
                <h3 style={sx("margin: 11px 0 0; font-size: 18px; font-weight: 600; line-height: 1.18; letter-spacing: normal")}>{f.k}</h3>
                <p style={sx("margin: 9px 0 0; font-size: 13.5px; line-height: 1.55; color: var(--n700); flex: 1")}>{f.v}</p>
                {f.meta && (
                  <p style={sx("margin: 15px 0 0; padding-top: 11px; border-top: 1px solid var(--n200); font-family: var(--mono); font-size: 9.5px; line-height: 1.5; letter-spacing: 0.05em; color: var(--n600)")}>{f.meta}</p>
                )}
              </li>
            ))}
          </ol>
        </section>

        <section id={ANCHOR.proof} data-testid="seg-proof" style={sx("border-bottom: 1px solid var(--ink); padding: 44px 56px")}>
          <div style={sx("display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 44px; align-items: start")}>
            <div>
              <p style={sx(KICKER)}>{seg.proofKicker}</p>
              <h2 style={sx("margin: 14px 0 0; font-size: 30px; font-weight: 600; line-height: 1.1; max-width: 30ch")}>{seg.proofTitle}</h2>
              {seg.proofBody && <p style={sx("margin: 14px 0 0; font-size: 15px; line-height: 1.6; color: var(--n700); max-width: 68ch; text-wrap: pretty")}>{seg.proofBody}</p>}
              {seg.proofRows.length > 0 && (
                <ul style={sx("margin: 22px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 11px")}>
                  {seg.proofRows.map((pr) => (
                    <li key={pr.v} style={sx("display: grid; grid-template-columns: 15px minmax(0, 1fr); gap: 12px; align-items: baseline")}>
                      <span aria-hidden="true" style={sx(GLYPH[pr.glyph])} />
                      <span style={sx("font-size: 14px; line-height: 1.55; color: var(--n800)")}>{pr.v}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {seg.panel && (
              <div id={ANCHOR.panel} className="blueprint" style={sx("position: relative; border: 1px solid var(--ink); background: var(--paper); padding: 24px 26px")}>
                <Corners />
                <p style={sx("margin: 0; font-family: var(--mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--n600)")}>{seg.panel.kicker}</p>
                <h3 style={sx("margin: 12px 0 0; font-size: 20px; font-weight: 600; line-height: 1.2; letter-spacing: normal")}>{seg.panel.title}</h3>
                <dl style={sx("margin: 18px 0 0; display: flex; flex-direction: column")}>
                  {seg.panel.rows.map((pn) => (
                    <div key={pn.k} style={sx("display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: baseline; border-bottom: 1px solid var(--n200); padding: 10px 0")}>
                      <dt style={sx("font-size: 13.5px; line-height: 1.4; color: var(--n800)")}>{pn.k}</dt>
                      <dd style={sx(`margin: 0; font-family: var(--mono); font-size: 11.5px; letter-spacing: 0.04em; text-align: right; white-space: nowrap; color: ${TONE[pn.tone]}`)}>{pn.v}</dd>
                    </div>
                  ))}
                </dl>
                {seg.panel.foot && <p style={sx("margin: 18px 0 0; font-size: 12.5px; line-height: 1.55; color: var(--n700)")}>{seg.panel.foot}</p>}
              </div>
            )}
          </div>
        </section>

        <section data-testid="seg-close" style={sx("padding: 46px 56px 54px")}>
          <div style={sx("display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr); gap: 44px; align-items: start")}>
            <div>
              <h2 style={sx("margin: 0; font-size: 32px; font-weight: 600; line-height: 1.08; max-width: 28ch; text-wrap: balance")}>{seg.closeTitle}</h2>
              <p style={sx("margin: 16px 0 0; font-size: 16px; line-height: 1.6; color: var(--n700); max-width: 80ch; text-wrap: pretty")}>{seg.closeBody}</p>
              <Ctas primary={seg.cta} secondary={SEE_COVERAGE} note={seg.ctaNote} />
            </div>
            <div className="blueprint" style={sx("position: relative; border: 1px solid var(--ink); border-left: 4px solid var(--blocked); padding: 22px 24px")}>
              <Corners />
              <p style={sx("margin: 0; font-family: var(--mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--blocked)")}>What we never do</p>
              <ul style={sx("margin: 14px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 9px")}>
                {seg.nevers.map((nv) => (
                  <li key={nv} style={sx("display: grid; grid-template-columns: 14px minmax(0, 1fr); gap: 11px; align-items: baseline")}>
                    <span aria-hidden="true" style={sx("width: 11px; height: 11px; flex: none; margin-top: 4px; background: var(--blocked); box-shadow: inset 0 4px 0 var(--paper), inset 0 -4px 0 var(--blocked)")} />
                    <span style={sx("font-size: 13px; line-height: 1.5; color: var(--n800)")}>{nv}</span>
                  </li>
                ))}
              </ul>
              {seg.neverFoot && (
                <p style={sx("margin: 16px 0 0; padding-top: 13px; border-top: 1px solid var(--n200); font-size: 12.5px; line-height: 1.55; color: var(--n700)")}>{seg.neverFoot}</p>
              )}
            </div>
          </div>
        </section>
      </main>

      <SiteFooter note="EU · UK · US · COVERAGE PUBLISHED PER MARKET" />
    </Page>
  );
}
