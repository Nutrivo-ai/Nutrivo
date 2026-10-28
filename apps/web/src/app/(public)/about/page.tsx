import type { Metadata } from "next";
import Link from "next/link";
import { Page } from "@/components/public/Site";
import { Corners, FaqFooter, FaqHeader } from "@/components/public/faq/FaqSite";
import { BELIEFS, COMPANY, NEVER } from "@/components/public/faq/about";
import { PUBLIC_ROUTES, START } from "@/lib/public/links";
import { sx } from "@/lib/public/sx";

// S-FAQ-002 · /about, from design/public/Nutrivo FAQ and About.dc.html in its `page: about` state (T-603). Static: it
// reads no data. Copy is verbatim from the design; what is left out, and why, is listed in
// components/public/faq/about.ts. The page shows only the parts the design itself calls real: the position, the
// boundary and the method, and the company's registered details.
export const metadata: Metadata = { title: "About us · Nutrivo" };

export default function AboutPage() {
  return (
    <Page css="background: var(--paper)">
      <FaqHeader current="about" />
      <main data-screen-label="About us">
        {/* Omitted: the "Draft — the facts about the company are placeholders" banner, and from this section the
            heading and first paragraph (coverage claims; see about.ts). */}
        <section data-testid="about-hero" style={sx("border-bottom: 1px solid var(--ink)")}>
          <div style={sx("max-width: 1120px; margin: 0 auto; padding: 42px 26px 36px")}>
            {/* The design's eyebrow, as the page's h1 (its heading is omitted), drawn exactly as the eyebrow. */}
            <h1 style={sx("margin: 0; font-family: var(--mono); font-size: 10.5px; font-weight: 400; line-height: 1.55; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent)")}>About</h1>
            <p style={sx("margin: 13px 0 0; font-size: 17px; line-height: 1.6; color: var(--n700); max-width: 80ch; text-wrap: pretty")}>
              What makes it worth trusting is that every answer is auditable. Each finding cites the article it came from and says whether a rule decided it or a judgement did, and we publish how much of each market we hold. A compliance answer you cannot check is not an answer.
            </p>
          </div>
        </section>

        <section data-testid="about-beliefs" aria-labelledby="beliefs-title" style={sx("border-bottom: 1px solid var(--ink); background: var(--panel)")}>
          <div style={sx("max-width: 1120px; margin: 0 auto; padding: 36px 26px 42px")}>
            <h2 id="beliefs-title" style={sx("margin: 0; font-family: var(--mono); font-size: 10px; font-weight: 400; line-height: 1.55; letter-spacing: 0.13em; text-transform: uppercase; color: var(--accent)")}>
              What we believe, and it shows in the product
            </h2>
            <div style={sx("margin-top: 22px; display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 18px")}>
              {BELIEFS.map((b) => (
                <div key={b.k} className="blueprint" style={sx(`position: relative; border: 1px solid var(--ink); border-top: 4px solid ${b.bar}; background: var(--paper); padding: 22px 24px`)}>
                  <Corners />
                  <h3 style={sx("margin: 0; font-size: 18px; font-weight: 600; line-height: 1.2; letter-spacing: normal")}>{b.k}</h3>
                  <p style={sx("margin: 10px 0 0; font-size: 13.5px; line-height: 1.6; color: var(--n700)")}>{b.v}</p>
                  <p style={sx("margin: 12px 0 0; padding-top: 11px; border-top: 1px solid var(--n200); font-size: 12.5px; line-height: 1.55; color: var(--n700)")}>
                    <span style={sx("font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.08em; color: var(--accent-700)")}>IN THE PRODUCT · </span>
                    {b.proof}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section data-testid="about-boundary" style={sx("border-bottom: 1px solid var(--ink)")}>
          <div style={sx("max-width: 1120px; margin: 0 auto; padding: 36px 26px 42px")}>
            <div style={sx("display: grid; grid-template-columns: repeat(auto-fit, minmax(330px, 1fr)); gap: 26px; align-items: start")}>
              <div>
                <p style={sx("margin: 0; font-family: var(--mono); font-size: 10px; letter-spacing: 0.13em; text-transform: uppercase; color: var(--n600)")}>Where we stop, deliberately</p>
                <h2 style={sx("margin: 12px 0 0; font-size: 28px; font-weight: 600; line-height: 1.1; max-width: 24ch")}>The line we will not sell past</h2>
                {/* Omitted (regulation): "Not because we are being careful with our liability, but because only the
                    operator named on the label is entitled to." */}
                <p style={sx("margin: 12px 0 0; font-size: 14.5px; line-height: 1.65; color: var(--n700)")}>
                  We name the obligation, the authority, the route, the evidence, the fee and the deadline, and we fill in everything your product record already answers. Then you file it.
                </p>
                <p style={sx("margin: 12px 0 0; font-size: 14.5px; line-height: 1.65; color: var(--n700)")}>
                  {"Every competitor in this category is under pressure to blur that line, because \"we handle your registrations\" sells better than \"we prepare them\". It is not on our roadmap at any price."}
                </p>
              </div>
              <div data-testid="about-never" className="blueprint" style={sx("position: relative; border: 1px solid var(--ink); border-top: 4px solid var(--blocked); background: var(--paper); padding: 24px 26px")}>
                <Corners />
                <h3 style={sx("margin: 0; font-family: var(--mono); font-size: 10px; font-weight: 400; line-height: 1.55; letter-spacing: 0.12em; text-transform: uppercase; color: var(--blocked)")}>We never</h3>
                <ul style={sx("margin: 14px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px")}>
                  {NEVER.map((nv) => (
                    <li key={nv} style={sx("display: flex; gap: 11px; align-items: baseline")}>
                      <span aria-hidden="true" style={sx("width: 11px; height: 11px; flex: none; margin-top: 4px; background: var(--blocked); box-shadow: inset 0 4px 0 var(--paper), inset 0 -4px 0 var(--blocked)")} />
                      <span style={sx("font-size: 13.5px; line-height: 1.5; color: var(--n800)")}>{nv}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Omitted: "How this started" (placeholder story) and "Who does this" (placeholder people), D-19. */}

        <section data-testid="about-company" aria-labelledby="company-title" style={sx("border-bottom: 1px solid var(--ink); background: var(--panel)")}>
          <div style={sx("max-width: 1120px; margin: 0 auto; padding: 34px 26px 40px")}>
            <h2 id="company-title" style={sx("margin: 0; font-family: var(--mono); font-size: 10px; font-weight: 400; line-height: 1.55; letter-spacing: 0.13em; text-transform: uppercase; color: var(--accent)")}>The company</h2>
            <dl style={sx("margin: 20px 0 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 20px")}>
              {COMPANY.map((cy) => (
                <div key={cy.k}>
                  <dt style={sx("margin: 0; font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--n600)")}>{cy.k}</dt>
                  <dd style={sx("margin: 8px 0 0; font-size: 14px; line-height: 1.55")}>{cy.v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section data-testid="about-cta">
          <div style={sx("max-width: 1120px; margin: 0 auto; padding: 44px 26px 54px; text-align: center")}>
            <h2 style={sx("margin: 0 auto; font-size: 32px; font-weight: 600; line-height: 1.1; max-width: 26ch; text-wrap: pretty")}>Judge us on three labels, not on this page</h2>
            <p style={sx("margin: 14px auto 0; font-size: 16px; line-height: 1.6; color: var(--n700); max-width: 62ch")}>
              No card, no clock, no sales call. Run a real label through it and see whether the answer is one you would put your name to.
            </p>
            <div style={sx("margin-top: 24px; display: flex; gap: 12px; justify-content: center; flex-wrap: wrap")}>
              <Link href={START} className="pub-primary" style={sx("background: var(--accent); color: var(--paper); border-radius: 3px; padding: 14px 26px; font-size: 15.5px; font-weight: 500")}>
                Check three labels free
              </Link>
              <Link href={PUBLIC_ROUTES.coverage} style={sx("border: 1px solid var(--n400); border-radius: 3px; padding: 14px 22px; font-size: 15.5px; color: var(--n800)")}>
                See what we cover
              </Link>
            </div>
          </div>
        </section>
      </main>
      <FaqFooter />
    </Page>
  );
}
