import Link from "next/link";
import { Page } from "@/components/public/Site";
import { PUBLIC_ROUTES } from "@/lib/public/links";
import { sx } from "@/lib/public/sx";
import { LEGAL_DOCS, LEGAL_ORDER, type LegalKey } from ".";
import type { Section, Table } from "./types";

// S-LGL-001…003, ported declaration by declaration from design/public/Nutrivo Legal - Terms, DPA, Privacy.dc.html.
// The design's header tabs are buttons that switch its state; here they are links between the three routes. The
// design's global rule `h1, h2, h3 { letter-spacing: -0.03em }` is the app's base rule too (globals.css).

/** The design's tab style (renderVals → tabs[].style), the current tab in accent. */
const tabStyle = (current: boolean) =>
  sx(
    "border: 1px solid " + (current ? "var(--accent)" : "var(--n400)") + "; background: " + (current ? "var(--accent-100)" : "var(--paper)") +
      "; color: " + (current ? "var(--accent-700)" : "var(--n700)") + "; padding: 6px 12px; font-size: 12px; cursor: pointer; font-weight: " + (current ? "600" : "400"),
  );

/** The design's table cell style (renderVals → cellStyle). */
const cellStyle = (i: number, n: number) =>
  sx(
    "margin: 0; padding: 11px 13px; font-size: 12.5px; line-height: 1.5; color: " + (i === 0 ? "var(--ink)" : "var(--n700)") +
      "; font-weight: " + (i === 0 ? "500" : "400") + (i < n - 1 ? "; border-right: 1px solid var(--n200)" : ""),
  );

function LegalHeader({ current }: { current: LegalKey }) {
  return (
    <header data-testid="legal-header" style={sx("position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 20px; border-bottom: 1px solid var(--ink); background: var(--paper); padding: 12px 34px")}>
      {/* The Legal file draws the wordmark at 20 px without ".ai", so SiteMark (22 px with ".ai") is not used here. */}
      <Link href={PUBLIC_ROUTES.home} aria-label="Nutrivo home" style={sx("color: var(--ink)")}>
        <span style={sx("margin: 0; display: flex; align-items: flex-end; gap: 4px; font-size: 20px; font-weight: 600; letter-spacing: -0.045em; line-height: 1")}>
          <span>nutrivo</span>
          <span aria-hidden="true" style={sx("width: 6px; height: 6px; background: var(--accent); margin-bottom: 2px; flex-shrink: 0")} />
        </span>
      </Link>
      <span style={sx("font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.05em; color: var(--n600)")}>LEGAL</span>
      <div style={sx("flex: 1")} />
      <nav aria-label="Legal documents" style={sx("display: flex; gap: 1px")}>
        {LEGAL_ORDER.map((key) => (
          <Link key={key} href={PUBLIC_ROUTES[key]} className="pub-tab" aria-current={key === current ? "page" : undefined} style={tabStyle(key === current)}>
            {LEGAL_DOCS[key].tab}
          </Link>
        ))}
      </nav>
    </header>
  );
}

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

function SectionTable({ table }: { table: Table }) {
  const cols = table.head.length;
  const grid = cols === 3 ? "minmax(0, 1fr) minmax(0, 1.15fr) minmax(0, 1fr)" : "repeat(" + cols + ", minmax(0, 1fr))";
  return (
    <div role="table" className="blueprint" style={sx("position: relative; margin-top: 16px; border: 1px solid var(--ink)")}>
      <Corners />
      <div role="row" style={sx("display: grid; grid-template-columns: " + grid + "; background: var(--panel); border-bottom: 1px solid var(--ink)")}>
        {table.head.map((th) => (
          <p key={th} role="columnheader" style={sx("margin: 0; padding: 9px 13px; font-family: var(--mono); font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--n600)")}>
            {th}
          </p>
        ))}
      </div>
      {table.rows.map((row, ri, rows) => (
        <div
          key={row[0]}
          role="row"
          style={sx("display: grid; grid-template-columns: " + grid + "; border-bottom: " + (ri < rows.length - 1 ? "1px solid var(--n200)" : "none") + "; background: " + (ri % 2 ? "var(--panel)" : "transparent"))}
        >
          {row.map((v, ci) => (
            <p key={ci} role="cell" style={cellStyle(ci, cols)}>
              {v}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

function DocSection({ s, last }: { s: Section; last: boolean }) {
  return (
    <section
      id={`section-${s.n}`}
      aria-labelledby={`section-${s.n}-title`}
      data-testid={`legal-section-${s.n}`}
      style={sx("padding: 26px 34px 28px; border-bottom: " + (last ? "1px solid var(--ink)" : "1px solid var(--rule)"))}
    >
      <div style={sx("display: flex; align-items: baseline; gap: 16px")}>
        <p style={sx("margin: 0; font-family: var(--mono); font-size: 12px; letter-spacing: 0.08em; color: var(--accent); flex: none; width: 26px")}>{s.n}</p>
        <div style={sx("flex: 1; min-width: 0")}>
          <h2 id={`section-${s.n}-title`} style={sx("margin: 0; font-size: 21px; font-weight: 600; line-height: 1.2")}>
            {s.k}
          </h2>
          {s.lead ? <p style={sx("margin: 9px 0 0; font-size: 14px; line-height: 1.65; color: var(--n800); max-width: 88ch")}>{s.lead}</p> : null}
          <div style={sx("margin-top: 14px; display: flex; flex-direction: column; gap: 12px")}>
            {s.clauses.map((c) => (
              <div key={c.n} style={sx("display: flex; gap: 14px; align-items: baseline")}>
                {/* The design draws clause numbers in --n500, 3.2:1 on paper, which axe reports as serious
                    (color-contrast); --n600, the next step of the same ramp, reaches 4.9:1. */}
                <span style={sx("font-family: var(--mono); font-size: 11px; color: var(--n600); flex: none; width: 34px")}>{c.n}</span>
                <p style={sx("margin: 0; flex: 1; font-size: 13.5px; line-height: 1.65; color: var(--n800); max-width: 92ch")}>{c.v}</p>
              </div>
            ))}
          </div>
          {s.table ? <SectionTable table={s.table} /> : null}
        </div>
      </div>
    </section>
  );
}

export function LegalPage({ doc: key }: { doc: LegalKey }) {
  const d = LEGAL_DOCS[key];
  return (
    <Page css="min-width: 1080px; background: var(--panel); padding: 0 0 60px">
      <LegalHeader current={key} />
      <main data-testid="legal-column" style={sx("max-width: 1020px; margin: 0 auto; background: var(--paper); border-left: 1px solid var(--rule); border-right: 1px solid var(--rule)")}>
        <div
          data-testid="legal-draft-banner"
          role="note"
          className="blueprint"
          style={sx("position: relative; margin: 22px 34px 0; border: 1px solid var(--ink); border-left: 4px solid var(--action); background: var(--action-bg); padding: 16px 20px")}
        >
          <Corners />
          <p style={sx("margin: 0; font-size: 14px; font-weight: 600")}>Draft for review by Swedish counsel before publication</p>
          <p style={sx("margin: 6px 0 0; font-size: 13px; line-height: 1.55; color: var(--n800)")}>
            These are working drafts written from the product decisions on record. They are not legal advice and have not been reviewed by a lawyer. The clauses on liability,
            warranties, indemnities and limitation periods in particular need a Swedish commercial lawyer, and the processing annexes need confirming against the infrastructure as
            actually deployed.
          </p>
        </div>

        <div data-testid="legal-title" style={sx("padding: 26px 34px 20px; border-bottom: 1px solid var(--ink)")}>
          <p style={sx("margin: 0; font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent)")}>{d.kicker}</p>
          <h1 style={sx("margin: 10px 0 0; font-size: 34px; font-weight: 600; line-height: 1.08; max-width: 30ch")}>{d.title}</h1>
          <p style={sx("margin: 12px 0 0; font-size: 15px; line-height: 1.6; color: var(--n700); max-width: 84ch")}>{d.intro}</p>
          <dl data-testid="legal-facts" style={sx("margin: 20px 0 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border: 1px solid var(--rule)")}>
            {d.facts.map((f, i) => (
              <div key={f.k} style={sx("padding: 14px 16px; border-right: " + (i < 3 ? "1px solid var(--rule)" : "none"))}>
                <dt style={sx("margin: 0; font-family: var(--mono); font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--n600)")}>{f.k}</dt>
                <dd style={sx("margin: 7px 0 0; font-size: 12.5px; line-height: 1.45")}>{f.v}</dd>
              </div>
            ))}
          </dl>
        </div>

        {d.sections.map((s, i, a) => (
          <DocSection key={s.n} s={s} last={i === a.length - 1} />
        ))}

        <div data-testid="legal-contact" style={sx("padding: 26px 34px 40px")}>
          <p style={sx("margin: 0; font-family: var(--mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--n600)")}>Contact</p>
          <p style={sx("margin: 10px 0 0; font-size: 14px; line-height: 1.7")}>
            Sunny Ventures AB, trading as Nutrivo.ai · Karlbergsvägen 48, 113 37 Stockholm, Sweden
            <br />
            Company registration 5594297151 · VAT SE559429715101
            <br />
            {d.contactLine}
          </p>
          <p style={sx("margin: 14px 0 0; font-family: var(--mono); font-size: 10px; letter-spacing: 0.05em; color: var(--n600)")}>{d.version}</p>
        </div>
      </main>
    </Page>
  );
}
