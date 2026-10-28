import type { Metadata } from "next";
import Link from "next/link";
import { Page } from "@/components/public/Site";
import { Corners, FaqFooter, FaqHeader } from "@/components/public/faq/FaqSite";
import { GROUPS } from "@/components/public/faq/questions";
import { CONTACT, START } from "@/lib/public/links";
import { sx } from "@/lib/public/sx";

// S-FAQ-001 · /faq, from design/public/Nutrivo FAQ and About.dc.html in its `page: faq` state (T-603). Static: it
// reads no data. The questions and what is omitted from them are in components/public/faq/questions.ts.
export const metadata: Metadata = { title: "Questions · Nutrivo" };

export default function FaqPage() {
  return (
    <Page css="background: var(--paper)">
      <FaqHeader current="faq" />
      <main data-screen-label="FAQ">
        <section data-testid="faq-hero" style={sx("border-bottom: 1px solid var(--ink)")}>
          <div style={sx("max-width: 1120px; margin: 0 auto; padding: 42px 26px 34px")}>
            <p style={sx("margin: 0; font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent)")}>Questions</p>
            <h1 style={sx("margin: 14px 0 0; font-size: 44px; font-weight: 600; line-height: 1.04; max-width: 24ch; text-wrap: pretty")}>Everything a buyer asks, answered before the call</h1>
            <p style={sx("margin: 15px 0 0; font-size: 17px; line-height: 1.55; color: var(--n700); max-width: 76ch; text-wrap: pretty")}>
              Including the ones that are awkward for us. If an answer here turns out to be wrong for your case, we would rather you found out on this page than three months into a subscription.
            </p>
            <nav aria-label="Topics" style={sx("margin-top: 26px; display: flex; flex-wrap: wrap; gap: 8px")}>
              {GROUPS.map((g) => (
                <a key={g.id} href={`#${g.id}`} style={sx("border: 1px solid var(--n400); border-radius: 3px; padding: 8px 13px; font-size: 12.5px; color: var(--n800)")}>
                  {g.k}
                </a>
              ))}
            </nav>
          </div>
        </section>

        {GROUPS.map((g, i) => (
          <section
            key={g.id}
            id={g.id}
            data-testid={`faq-group-${g.id}`}
            aria-labelledby={`${g.id}-title`}
            style={sx(`border-bottom: 1px solid ${i === GROUPS.length - 1 ? "var(--ink)" : "var(--rule)"}; background: ${i % 2 ? "var(--panel)" : "var(--paper)"}`)}
          >
            <div style={sx("max-width: 1120px; margin: 0 auto; padding: 34px 26px 40px")}>
              <div style={sx("display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap")}>
                {/* The design draws the number in --n500 (3.2:1 on paper); --n600 is the nearest token that passes axe. */}
                <p style={sx("margin: 0; font-family: var(--mono); font-size: 12px; letter-spacing: 0.1em; color: var(--n600)")} aria-hidden="true">{g.n}</p>
                <h2 id={`${g.id}-title`} style={sx("margin: 0; font-size: 28px; font-weight: 600; line-height: 1.1")}>{g.k}</h2>
              </div>
              <div style={sx("margin-top: 24px; display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 22px")}>
                {g.qs.map((q) => (
                  <div key={q.slug} data-testid={`faq-q-${q.slug}`} style={sx(`border-left: 3px solid ${q.bar}; padding-left: 17px`)}>
                    <h3 style={sx("margin: 0; font-size: 17px; font-weight: 600; line-height: 1.25; letter-spacing: normal; text-wrap: pretty")}>{q.q}</h3>
                    <p style={sx("margin: 9px 0 0; font-size: 14px; line-height: 1.65; color: var(--n800); text-wrap: pretty")}>{q.a}</p>
                    {q.more ? (
                      <p style={sx("margin: 9px 0 0; font-size: 13.5px; line-height: 1.6; color: var(--n700); text-wrap: pretty")}>{q.more}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </section>
        ))}

        <section data-testid="faq-contact">
          <div style={sx("max-width: 1120px; margin: 0 auto; padding: 42px 26px 52px")}>
            <div className="blueprint" style={sx("position: relative; border: 1px solid var(--ink); border-top: 4px solid var(--accent); background: var(--paper); padding: 28px 30px")}>
              <Corners />
              <div style={sx("display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 24px; align-items: center")}>
                <div>
                  <h2 style={sx("margin: 0; font-size: 26px; font-weight: 600; line-height: 1.15; max-width: 26ch")}>Something not answered here?</h2>
                  <p style={sx("margin: 10px 0 0; font-size: 14.5px; line-height: 1.6; color: var(--n700)")}>
                    Write to us and a person who knows the answer will reply. If the question was good enough to ask, it belongs on this page, so we will probably add it.
                  </p>
                </div>
                <div style={sx("display: flex; flex-direction: column; gap: 10px")}>
                  <Link href={START} className="pub-primary" style={sx("background: var(--accent); color: var(--paper); border-radius: 3px; padding: 13px 22px; font-size: 15px; font-weight: 500; text-align: center")}>
                    Check three labels free
                  </Link>
                  <a href={CONTACT} style={sx("border: 1px solid var(--n400); border-radius: 3px; padding: 13px 22px; font-size: 15px; text-align: center; color: var(--n800)")}>hello@nutrivo.ai</a>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
      <FaqFooter />
    </Page>
  );
}
