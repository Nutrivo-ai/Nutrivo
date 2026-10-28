import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ErrorState, LoadingState } from "@/components/kit";
import { Plans } from "@/components/public/landing/Plans";
import { DOMAIN_LABEL, readCoverage, type DomainState } from "@/lib/public/coverage";
import { PUBLIC_ROUTES, START } from "@/lib/public/links";
import { sx } from "@/lib/public/sx";
import { REQUEST_ID_HEADER } from "@/lib/observability/request-id";

export const metadata: Metadata = {
  title: "Nutrivo · Label compliance for pet food and animal nutrition",
  description: "Pet-food labels checked against encoded EU feed law, per market and per language panel.",
};

// S-LND-001 (P01, P02): design/public/Nutrivo Landing Page.dc.html. Its load and scroll animations are not carried
// over (Cobalt §5: nothing animates on load). Omitted (D-19, plan on issue #60), because no released source backs them:
// the animated hero check ("Applying 306 rules for Germany", its counts), the market marquee, "Watch it run" (invented
// findings), "The stakes" (time and cost ranges), the sample verification card, the "How it works" sketch, the
// comparison table (a named competitor and consultant rates, question 9), the per-region regulatory descriptions in
// "Markets" (question 8), the per-region coverage cards and "Nobody in this category publishes this". The header links
// and the hero button that pointed at removed sections go with them. After the review on PR 142: the hero's two
// paragraphs ("regulatory approved", "a fraction of the current cost", "built by pet food professionals") and the
// whole "Markets" section (a region "sold whole", the Texas roll-up example: D-01, D-22) are omitted too. "Rules encoded, by domain" is computed from
// public.coverage_snapshot(), and the plans from config/pricing.ts.

const QUESTIONS = [
  { n: "01", q: "Are we compliant?", a: "One answer per market, in the language your label is actually printed in. Never a pass or fail — four states, so you can see the difference between a problem and a gap." },
  { n: "02", q: "What is missing?", a: "Every finding named, with the article it comes from and how we reached it. Including the things we could not check, and why, with a link to exactly what we cover." },
  { n: "03", q: "What do we do?", a: "The wording that would be compliant, the character heights your artwork needs, and the ceilings you cannot design past. Written so prepress can act on it." },
  { n: "04", q: "What must we register?", a: "The obligation, the authority, the route, the evidence list, the fee and the deadline, per market — pre-filled from what your product record already answers." },
];

const GLYPH = {
  clear: "display: inline-block; flex: none; margin-top: 3px; width: 9px; height: 9px; background: var(--clear)",
  action: "display: inline-block; flex: none; margin-top: 3px; width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-bottom: 9px solid var(--action)",
  none: "display: inline-block; flex: none; margin-top: 3px; width: 9px; height: 9px; box-sizing: border-box; border: 1.5px solid var(--none); border-radius: 50%",
  blocked: "display: inline-block; flex: none; margin-top: 3px; width: 9px; height: 9px; background: var(--blocked); box-shadow: inset 0 3.5px 0 0 var(--paper), inset 0 -3.5px 0 0 var(--blocked)",
};
const STATE_COLOR = { clear: "var(--clear)", action: "var(--action)", none: "var(--none)", blocked: "var(--blocked)" };
const STATE_BG = { clear: "var(--clear-bg)", action: "var(--action-bg)", none: "var(--none-bg)", blocked: "var(--blocked-bg)" };

const STATES = [
  { s: "clear", name: "Clear", def: "Every rule we hold for this market is satisfied, on the panel printed for that market.", act: "Nothing to do. Send the report." },
  { s: "action", name: "Action needed", def: "A rule is not satisfied and the fix is yours to make — a wording, a missing heading, a character height, a registration to file.", act: "The finding names the article and the wording that would be compliant." },
  { s: "none", name: "Not assessed", def: "We do not hold that rule for this market, or the artwork did not give us what the rule needs. We say so rather than guess.", act: "Follow the link to what we cover in that market, and what we do not." },
  { s: "blocked", name: "Blocked", def: "The product cannot lawfully be sold here, whatever the label says. Most often a registration that has not been filed.", act: "The obligation, the authority, the route, the evidence list and the fee." },
] as const;

const PATHS = [
  { kicker: "Case one", accent: "var(--accent)", title: "Check your label: are we compliant to sell in market X, Y and Z?", body: "Upload the artwork and tell us where you sell. We read every language panel on the pack, not an English original translated afterwards.",
    steps: ["Upload the print-ready artwork", "Pick the markets you sell in", "We classify the product and say so, visibly", "A report per market, per language"],
    out: "You get a verdict you can act on and send, plus a registration list per market." },
  { kicker: "Case two", accent: "var(--accent-700)", title: "Creating new products: make them compliant with the right registrations for you to grow sales", body: "Bring what you have, even if that is half a formula and a market in mind. We will not pretend to give you a verdict on something unfinished.",
    steps: ["Enter what exists — ingredients, claims, markets", "We accept partial input without guessing", "You get a design envelope, not a verdict", "Constraints, ceilings and compliant wording"],
    out: "You find out what is possible before the artwork exists, and what will block you later." },
];

const REPORT_POINTS = [
  { k: "Pinned to a moment", v: "The ruleset version in force, the hash of the artwork it read, and the date. It cannot drift." },
  { k: "Says what it is", v: "It states on its face that it was generated automatically and attested by nobody. A signed certificate is a separate thing." },
  { k: "Includes the gaps", v: "The not-assessed section travels with it. A report that hides what it did not check is worse than no report." },
  { k: "Verifiable by the recipient", v: "A retailer or artwork agency can confirm it still stands without an account and without contacting you." },
];

const AUDIENCES = [
  { k: "The person developing the product", v: "You need to know what is allowed while the recipe is still moving, not after the artwork is at the printer. Bring a half-finished formula and get constraints back.", job: "NPD · PRODUCT DEVELOPMENT · TECHNICAL", tint: true },
  { k: "The person who signs it off", v: "You carry the risk across every recipe and every market. You need one place that shows what is current, what is stale against the rules, and what nobody has checked.", job: "REGULATORY · QUALITY · COMPLIANCE", tint: false },
  { k: "The person selling it", v: "You want a new market and a straight answer about what it costs to get in. Including the registration that makes a compliant label sellable, or not.", job: "COMMERCIAL · FOUNDER · EXPORT", tint: false },
];

/** The design's matrix marks: encoded, partly encoded, not encoded. */
const MARK: Record<DomainState, string> = {
  complete: "display: inline-block; width: 9px; height: 9px; background: var(--ink)",
  partial: "display: inline-block; width: 9px; height: 9px; box-sizing: border-box; border: 1px solid var(--n500); background: linear-gradient(90deg, var(--ink) 50%, transparent 50%)",
  not_encoded: "display: inline-block; width: 9px; height: 9px; box-sizing: border-box; border: 1px solid var(--n400)",
};
const MARK_LABEL: Record<DomainState, string> = { complete: "Encoded", partial: "Partly encoded", not_encoded: "Not encoded" };

const eyebrow = "margin: 0; font-family: var(--mono); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent)";
const h2 = "margin: 14px 0 0; font-size: 34px; font-weight: 600; line-height: 1.12; letter-spacing: -0.03em";
const crosses = (color: string) =>
  [["top", "left"], ["top", "right"], ["bottom", "left"], ["bottom", "right"]].map(([v, h]) => (
    <span key={v + h} aria-hidden="true" style={{ ...sx(`position: absolute; font-family: var(--mono); font-size: 13px; line-height: 1; color: ${color}`), [v]: -8, [h]: -6 }}>+</span>
  ));

export default function LandingPage() {
  return (
    <div style={sx("width: 1280px; margin: 0 auto; background: var(--paper); overflow: hidden; line-height: normal")}>
      <header data-testid="header" style={sx("display: flex; align-items: center; justify-content: space-between; padding: 18px 56px; border-bottom: 1px solid var(--ink); position: sticky; top: 0; z-index: 30; background: var(--paper)")}>
        <Link href="/" aria-label="nutrivo.ai home" style={sx("display: flex; align-items: baseline; gap: 2px; color: var(--ink)")}>
          <span style={sx("font-size: 21px; font-weight: 600; letter-spacing: -0.03em")}>nutrivo</span>
          <span aria-hidden="true" style={sx("width: 6px; height: 6px; background: var(--accent); display: inline-block")} />
          <span style={sx("font-size: 21px; font-weight: 400; color: var(--n600); letter-spacing: -0.03em")}>.ai</span>
        </Link>
        <nav aria-label="Site" style={sx("display: flex; align-items: center; gap: 26px; font-size: 14px; color: var(--n700)")}>
          <a href="#how">How it works</a>
          <a href="#report">The report</a>
          <a href="#coverage">Coverage</a>
          <a href="#pricing">Pricing</a>
          <Link href={START} className="pub-ink" style={sx("border: 1px solid var(--ink); padding: 9px 17px; color: var(--ink); font-weight: 500")}>Check a label free</Link>
        </nav>
      </header>

      <main>
        <section style={sx("border-bottom: 1px solid var(--ink)")}>
          <div data-testid="hero" style={sx("width: 560px; padding: 60px 44px 56px 56px")}>
            <div data-testid="hero-text">
              <p style={sx("margin: 0; font-family: var(--mono); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent)")}>Label compliance for pet food and animal nutrition</p>
              <h1 style={sx("margin: 18px 0 0; font-size: 42px; font-weight: 600; line-height: 1.1; letter-spacing: -0.035em; text-wrap: balance")}>Want to sell in EU? Listing in the UK? Expanding in the US?</h1>
            </div>
            <div style={sx("margin-top: 30px; display: flex; align-items: center; gap: 12px")}>
              <Link href={START} className="pub-primary" style={sx("position: relative; background: var(--accent); color: var(--paper); font-size: 16px; font-weight: 500; padding: 15px 26px; border-radius: 3px")}>
                Check a label free
                {[["top", "left"], ["top", "right"], ["bottom", "left"], ["bottom", "right"]].map(([v, h]) => (
                  <span key={v + h} aria-hidden="true" style={{ ...sx("position: absolute; font-family: var(--mono); font-size: 11px; line-height: 1; color: var(--accent-200)"), [v]: -7, [h]: -5 }}>+</span>
                ))}
              </Link>
            </div>
            <p style={sx("margin: 16px 0 0; font-family: var(--mono); font-size: 11px; letter-spacing: 0.06em; color: var(--n600)")}>NO CARD · NO SALES CALL · THREE LABELS FREE</p>
          </div>
        </section>

        <section id="how" style={sx("padding: 62px 56px 0")}>
          <div data-testid="how-head">
            <p style={sx(eyebrow)}>Four questions, in order</p>
            <h2 style={sx(`${h2}; max-width: 30ch`)}>A label check that answers the questions you actually have to answer</h2>
            <p style={sx("margin: 16px 0 0; font-size: 17px; line-height: 1.55; color: var(--n700); max-width: 68ch")}>Most tools give you a pass or a fail. Neither tells you what to do on Monday. We answer four things in sequence, and we tell you plainly which parts we could not check.</p>
          </div>
          <div style={sx("margin-top: 34px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-top: 1px solid var(--ink)")}>
            {QUESTIONS.map((q, i) => (
              <div key={q.n} style={sx(`padding: 22px 22px 30px; border-bottom: 1px solid var(--ink); ${i < 3 ? "border-right: 1px solid var(--rule);" : ""}`)}>
                {/* The design draws the number in --accent-300, which is not a Cobalt token and, like --accent-200, fails axe's
                    contrast check; --accent passes at this size. */}
                <p aria-hidden="true" style={sx("margin: 0; font-family: var(--mono); font-size: 34px; font-weight: 400; line-height: 1; letter-spacing: -0.02em; color: var(--accent)")}>{q.n}</p>
                <h3 style={sx("margin: 12px 0 0; font-size: 20px; font-weight: 600; line-height: 1.2; letter-spacing: -0.02em")}>{q.q}</h3>
                <p style={sx("margin: 10px 0 0; font-size: 14.5px; line-height: 1.5; color: var(--n700)")}>{q.a}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="states" data-testid="states" style={sx("margin-top: 62px; padding: 58px 56px; border-top: 1px solid var(--ink); border-bottom: 1px solid var(--ink); background: var(--ink)")}>
          <div style={sx("display: flex; align-items: flex-end; justify-content: space-between; gap: 40px")}>
            <div>
              <p style={sx("margin: 0; font-family: var(--mono); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent-200)")}>The vocabulary</p>
              <h2 style={sx(`${h2}; color: var(--paper); max-width: 26ch`)}>Four states, and never a pass or a fail</h2>
            </div>
            <p style={sx("margin: 0; font-size: 15px; line-height: 1.55; color: var(--n400); max-width: 46ch")}>A pass hides the second and third of these. A fail cannot tell you which of them you are looking at. Every finding, in every market, resolves to one of the four.</p>
          </div>
          <div data-testid="states-cards" style={sx("margin-top: 32px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr))")}>
            {STATES.map((st, i) => (
              <div key={st.s} style={sx(`padding: 24px 22px 26px; background: ${STATE_BG[st.s]}; border-top: 3px solid ${STATE_COLOR[st.s]}${i < 3 ? "; border-right: 1px solid var(--paper)" : ""}`)}>
                <div style={sx("display: flex; align-items: center; gap: 9px")}>
                  <span aria-hidden="true" style={sx(GLYPH[st.s])} />
                  <h3 style={sx(`margin: 0; font-size: 18px; font-weight: 600; line-height: 1; letter-spacing: -0.02em; color: ${STATE_COLOR[st.s]}`)}>{st.name}</h3>
                </div>
                <p style={sx("margin: 14px 0 0; font-size: 14px; line-height: 1.5; color: var(--ink)")}>{st.def}</p>
                <p style={sx(`margin: 14px 0 0; padding-top: 12px; border-top: 1px solid ${STATE_COLOR[st.s]}; font-size: 12.5px; line-height: 1.45; color: var(--n700)`)}>{st.act}</p>
              </div>
            ))}
          </div>
          <p data-testid="states-note" style={sx("margin: 26px 0 0; font-size: 14.5px; line-height: 1.55; color: var(--n400); max-width: 78ch")}>A market where we hold no rules can never show as Clear. Not assessed is shown as prominently as the rest, because a gap you can see is worth more than a verdict you cannot check.</p>
        </section>

        <section style={sx("padding: 62px 56px")}>
          <div style={sx("margin-bottom: 30px")}>
            <p style={sx(eyebrow)}>Two real cases</p>
            <h2 style={sx(`${h2}; max-width: 34ch`)}>Whether the label already exists, or the product does not yet</h2>
          </div>
          <div style={sx("display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 22px")}>
            {PATHS.map((p) => (
              <div key={p.kicker} style={sx(`position: relative; border: 1px solid var(--ink); border-top: 4px solid ${p.accent}; padding: 28px 28px 26px; display: flex; flex-direction: column`)}>
                {crosses("var(--n400)")}
                <p style={sx(`margin: 0; font-family: var(--mono); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: ${p.accent}`)}>{p.kicker}</p>
                <h3 style={sx("margin: 12px 0 0; font-size: 22px; font-weight: 600; line-height: 1.2; letter-spacing: -0.02em; text-wrap: pretty; min-height: 80px")}>{p.title}</h3>
                <p style={sx("margin: 12px 0 0; font-size: 15.5px; line-height: 1.55; color: var(--n700)")}>{p.body}</p>
                <ol style={sx("margin: 20px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 9px")}>
                  {p.steps.map((t, i) => (
                    <li key={t} style={sx("display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 10px; align-items: baseline")}>
                      <span style={sx("font-family: var(--mono); font-size: 11px; color: var(--n600)")}>{String(i + 1).padStart(2, "0")}</span>
                      <span style={sx("font-size: 14.5px; line-height: 1.45")}>{t}</span>
                    </li>
                  ))}
                </ol>
                <p style={sx("margin: 22px 0 0; padding-top: 16px; border-top: 1px solid var(--rule); font-size: 13.5px; line-height: 1.5; color: var(--n700)")}>{p.out}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="report" style={sx("padding: 60px 56px; border-top: 1px solid var(--ink); border-bottom: 1px solid var(--ink); background: var(--panel)")}>
          <p style={sx(eyebrow)}>The artefact</p>
          <h2 style={sx(`${h2}; max-width: 28ch`)}>A report you can send to a retailer, and they can check it themselves</h2>
          <p style={sx("margin: 18px 0 0; font-size: 17px; line-height: 1.55; color: var(--n700); max-width: 62ch")}>The answer is only useful once it leaves your desk. Every report is pinned to the artwork it was run against and the exact version of the rules that were in force, so whoever receives it can verify it without an account and without asking you.</p>
          <div style={sx("margin-top: 26px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 18px 28px; max-width: 702px")}>
            {REPORT_POINTS.map((rp) => (
              <div key={rp.k} style={sx("border-left: 2px solid var(--accent); padding-left: 14px")}>
                <h3 style={sx("margin: 0; font-size: 15px; font-weight: 600; line-height: 1.3; letter-spacing: normal")}>{rp.k}</h3>
                <p style={sx("margin: 5px 0 0; font-size: 13.5px; line-height: 1.45; color: var(--n700)")}>{rp.v}</p>
              </div>
            ))}
          </div>
        </section>

        <section style={sx("padding: 60px 56px")}>
          <p style={sx(eyebrow)}>Who it is for</p>
          <h2 style={sx(`${h2}; max-width: 32ch`)}>Built for the person who has to decide before the artwork goes to print</h2>
          <div style={sx("margin-top: 30px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border: 1px solid var(--rule)")}>
            {AUDIENCES.map((a, i) => (
              <div key={a.k} style={sx(`padding: 26px 24px; ${i < 2 ? "border-right: 1px solid var(--rule); " : ""}${a.tint ? "background: var(--accent-100);" : ""}`)}>
                <h3 style={sx("margin: 0; font-size: 17px; font-weight: 600; line-height: 1.25; letter-spacing: normal")}>{a.k}</h3>
                <p style={sx("margin: 10px 0 0; font-size: 14.5px; line-height: 1.5; color: var(--n700)")}>{a.v}</p>
                <p style={sx("margin: 14px 0 0; font-family: var(--mono); font-size: 10.5px; line-height: 1.45; letter-spacing: 0.06em; color: var(--accent-700)")}>{a.job}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="coverage" style={sx("padding: 60px 56px; border-top: 1px solid var(--ink)")}>
          <div style={sx("display: flex; align-items: flex-end; justify-content: space-between; gap: 40px")}>
            <div>
              <p style={sx(eyebrow)}>What we cover</p>
              <h2 style={sx(`${h2}; max-width: 26ch`)}>We publish our depth, including what we do not hold</h2>
            </div>
            <p style={sx("margin: 0; font-size: 15px; line-height: 1.55; color: var(--n700); max-width: 44ch")}>It is the only way a not-assessed finding can mean anything: every gap in the product links to the row that explains it.</p>
          </div>
          <Suspense fallback={<div style={sx("margin-top: 30px")}><LoadingState label="READING THE RELEASED RULESET" /></div>}>
            <CoverageMatrix />
          </Suspense>
        </section>

        <section id="pricing" data-testid="plans" style={sx("padding: 60px 56px; border-top: 1px solid var(--ink)")}>
          <Plans />
          <div data-testid="never" style={sx("margin-top: 24px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 22px")}>
            <div style={sx("border: 1px solid var(--rule); border-left: 3px solid var(--clear); padding: 20px 22px")}>
              <h3 style={sx("margin: 0; font-family: var(--mono); font-size: 10.5px; font-weight: 400; line-height: normal; letter-spacing: 0.1em; text-transform: uppercase; color: var(--clear)")}>Never charged for, on any plan</h3>
              <p style={sx("margin: 10px 0 0; font-size: 14.5px; line-height: 1.6; color: var(--n700)")}>Checking and re-checking as often as you like · checking in the language your label is printed in · the four states and where each answer came from · what we could not check, and why · what you must register, with whom, by when · reading your own answer on screen</p>
            </div>
            <div style={sx("border: 1px solid var(--rule); border-left: 3px solid var(--blocked); padding: 20px 22px")}>
              <h3 style={sx("margin: 0; font-family: var(--mono); font-size: 10.5px; font-weight: 400; line-height: normal; letter-spacing: 0.1em; text-transform: uppercase; color: var(--blocked)")}>What we will never do, at any price</h3>
              <p style={sx("margin: 10px 0 0; font-size: 14.5px; line-height: 1.6; color: var(--n700)")}>We do not submit a registration for you. We do not pay a fee on your behalf. We do not correspond with an authority as your representative. We do not confirm that a registration is valid, and we do not guarantee acceptance. Only the responsible operator named on the label can do those things.</p>
            </div>
          </div>
        </section>

        <section id="start" data-testid="start" style={sx("padding: 62px 56px; border-top: 1px solid var(--ink); background: var(--ink); color: var(--paper)")}>
          <div style={sx("display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 54px; align-items: center")}>
            <div>
              <h2 style={sx("margin: 0; font-size: 38px; font-weight: 600; line-height: 1.1; letter-spacing: -0.03em; color: var(--paper); max-width: 26ch")}>Three labels free. See what we find.</h2>
              <p style={sx("margin: 18px 0 0; font-size: 17px; line-height: 1.55; color: var(--n400); max-width: 58ch")}>The whole product on your first three labels, sending included, with no card and no clock — you keep everything you check in one region for as long as you want it. No card, no questions about your company, no sales call.</p>
            </div>
            <div style={sx("display: flex; flex-direction: column; gap: 12px")}>
              <Link href={START} className="pub-primary" style={sx("background: var(--accent); color: var(--paper); font-size: 17px; font-weight: 500; padding: 17px 24px; text-align: center; border-radius: 3px")}>Check a label free</Link>
              <Link href={PUBLIC_ROUTES.pricing} style={sx("border: 1px solid var(--n600); color: var(--paper); font-size: 16px; font-weight: 500; padding: 15px 24px; text-align: center; border-radius: 3px")}>See what a plan includes</Link>
              <p style={sx("margin: 6px 0 0; font-family: var(--mono); font-size: 11px; letter-spacing: 0.06em; text-align: center; color: var(--n500)")}>EU · UK · US</p>
            </div>
          </div>
        </section>
      </main>

      <footer data-testid="footer" style={sx("padding: 30px 56px; display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--n700); background: var(--ink)")}>
        <div style={sx("display: flex; align-items: baseline; gap: 2px")}>
          <span style={sx("font-size: 16px; font-weight: 600; color: var(--paper); letter-spacing: -0.03em")}>nutrivo</span>
          <span aria-hidden="true" style={sx("width: 5px; height: 5px; background: var(--accent); display: inline-block")} />
        </div>
        <p style={sx("margin: 0; font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--n500)")}>Label compliance for pet food and animal nutrition · EU · UK · US</p>
      </footer>
    </div>
  );
}

/** "Rules encoded, by domain" from public.coverage_snapshot(): one column per region it holds, one row per domain. */
async function CoverageMatrix() {
  await connection();
  const result = await readCoverage((await headers()).get(REQUEST_ID_HEADER) ?? undefined);
  if (!result.ok) {
    return (
      <div data-testid="coverage-error" style={sx("margin-top: 30px")}>
        <ErrorState
          where="COVERAGE · PUBLIC"
          title="Coverage could not be read just now"
          body="Nothing here is shown from memory: until the released ruleset can be read, no depth is published."
          action={{ label: "Open the coverage page", href: PUBLIC_ROUTES.coverage }}
        />
      </div>
    );
  }
  const { regions } = result.coverage;
  const domains = [...new Set(regions.flatMap((r) => r.domains.map((d) => d.domain)))];
  const cols = `display: grid; grid-template-columns: minmax(0, 1fr) ${regions.map(() => "132px").join(" ")}`;
  return (
    <>
      <div role="table" aria-label="Rules encoded, by domain" data-testid="coverage-matrix" style={sx("margin-top: 30px; border: 1px solid var(--ink); background: var(--paper)")}>
        <div role="row" style={sx(`${cols}; border-bottom: 1px solid var(--ink)`)}>
          <p role="columnheader" style={sx("margin: 0; padding: 13px 18px; font-family: var(--mono); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--n600)")}>Rules encoded, by domain</p>
          {regions.map((r) => (
            <p key={r.id} role="columnheader" style={sx("margin: 0; padding: 13px 18px; font-family: var(--mono); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent); text-align: center")}>{r.id}</p>
          ))}
        </div>
        {domains.map((domain) => (
          <div key={domain} role="row" data-domain={domain} style={sx(`${cols}; border-bottom: 1px solid var(--n200)`)}>
            <p role="rowheader" style={sx("margin: 0; padding: 12px 18px; font-size: 14px; line-height: 1.35")}>{DOMAIN_LABEL[domain as keyof typeof DOMAIN_LABEL] ?? domain}</p>
            {regions.map((r) => {
              const state = r.domains.find((d) => d.domain === domain)?.state ?? "not_encoded";
              return (
                <div key={r.id} role="cell" data-region={r.id} data-state={state} style={sx("padding: 12px 18px; display: flex; align-items: center; justify-content: center")}>
                  <span role="img" aria-label={MARK_LABEL[state]} style={sx(MARK[state])} />
                </div>
              );
            })}
          </div>
        ))}
        <div style={sx("display: flex; align-items: center; gap: 24px; padding: 13px 18px")}>
          {(["complete", "partial", "not_encoded"] as const).map((s) => (
            <div key={s} style={sx("display: flex; align-items: center; gap: 8px")}>
              <span aria-hidden="true" style={sx(MARK[s])} />
              <p style={sx("margin: 0; font-size: 12.5px; color: var(--n700)")}>
                {s === "complete" ? "Encoded" : s === "partial" ? "Partly encoded — the excluded parts are named" : "Not encoded — no verdict offered"}
              </p>
            </div>
          ))}
        </div>
      </div>
      <p style={sx("margin: 22px 0 0; font-size: 14.5px; color: var(--n700)")}>
        <Link href={PUBLIC_ROUTES.coverage} style={sx("text-decoration: underline")}>Read the coverage page</Link>
      </p>
    </>
  );
}
