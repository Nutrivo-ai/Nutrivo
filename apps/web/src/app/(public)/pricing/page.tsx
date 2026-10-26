import type { Metadata } from "next";
import Link from "next/link";
import { SiteMark } from "@/components/public/Site";
import { Ladder } from "@/components/public/pricing/Ladder";
import { CONTACT, PUBLIC_ROUTES, SEGMENTS, START, segmentHref } from "@/lib/public/links";
import { addonAmount, amount, euros, inWords, PARTNER, plan } from "@/lib/public/pricing";
import { sx } from "@/lib/public/sx";

export const metadata: Metadata = { title: "Pricing · Nutrivo" };

// S-PRC-001 (P02): design/public/Nutrivo Pricing Page.dc.html, static, with every figure from config/pricing.ts.
// Departures from the design, each from the plan on issue #60:
// - "A region is sold whole" is omitted whole: its copy and figures ("all twenty-seven", "every state", 27 / 24 / 1) state
//   regions and coverage that D-01 and D-22 contradict at launch (review on PR 142).
// - Advanced's signed certificate and single sign-on, and the plan table's signing and third-region rows, are omitted:
//   both come after launch (docs/00); so is the Texas answer and "Tells you whether a label is legal" (it overstates).
// - Partner is labelled after launch, as docs/08 lists it.
// - Partner keeps what docs/08 holds (€1,499 per 10 client workspaces, question 3); its per-year price, recipes per
//   client, further-client price, people and "above 25" rows are omitted, because no source on record holds them.

const C = { clear: "var(--clear)", action: "var(--action)", blocked: "var(--blocked)", none: "var(--none)", accent: "var(--accent)", n600: "var(--n600)", n700: "var(--n700)", ink: "var(--ink)" };
const corners = (
  <>
    <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
  </>
);
const eyebrow = "margin: 0; font-family: var(--mono); font-size: 10px; letter-spacing: 0.13em; text-transform: uppercase; color: var(--accent)";

const QUESTIONS = [
  { n: "What it does", k: null, v: "We read your artwork, check it against the rules we hold for every market you sell in, and report four things: what is clear, what needs action, what we did not check, and what is blocked outright." },
  { n: "Who it is for", k: "Pet food and animal nutrition brands, and the people who answer for them", v: "Brands selling into more than one market, their contract manufacturers, and the consultants who do the regulatory work on their behalf." },
  { n: "What it costs", k: `Three labels free. From ${euros(amount("basic", "month"))} a month after that`, v: `Your first three labels are the full product, sending included. Paid plans start at ${euros(amount("basic", "month"))} a month and are priced on what you manage: recipes, regions and people who edit.` },
];

const NEVER = ["Checks and re-checks", "Checking in the language the label is printed in", "The four states", "Where each answer came from", "What we could not check, and why", "What you must register, with whom, by when", "Reading your own answer"];
const NOT_SOLD = [
  "Filing a registration, notification or application for you",
  "Paying an authority's fee on your behalf",
  "Corresponding with an authority about your product",
  "Confirming that a registration is valid or in force",
  "Guaranteeing that anybody will accept your label",
];

const basic = plan("basic"), standard = plan("standard");
const QUALIFY = [
  { who: "You want to see whether this is any good", why: "Three labels, the whole product, sending included. No card, no clock, no sales call.", tier: "FREE", color: C.n700 },
  { who: "You have a fourth label to check", why: "Three was enough to judge us. A fourth means this is work rather than an evaluation.", tier: "BASIC", color: C.accent },
  { who: "One brand, one region, under ten recipes", why: "Ten recipes and three people who edit, with every pack size and artwork version free.", tier: "BASIC", color: C.accent },
  { who: "A range, or a second region coming", why: "A second region is the reason most brands move here. Thirty recipes and five people who edit.", tier: "STANDARD", color: C.accent },
  { who: "You work inside your clients' workspaces", why: "Scoped access to named recipes, every action attributed to you. Your client pays for their own plan.", tier: "STANDARD", color: C.accent },
  { who: "You answer for other companies' products", why: "Ten client workspaces under one account you control, with your clients reading their own free.", tier: "PARTNER · AFTER LAUNCH", color: C.accent },
];

/** An add-on's monthly price on a plan, "not available" where the plan cannot buy it, as the design's table prints it. */
function addonCell(key: "recipe" | "region" | "editor_seat", planKey: "basic" | "standard") {
  const cents = addonAmount(key, planKey, "month");
  return cents === null ? { v: "not available", c: C.blocked } : { v: `${euros(cents)}/mo`, c: C.n700 };
}
const secondRegion = (key: "basic" | "standard") =>
  plan(key).regionsMax >= 2 ? addonCell("region", key) : { v: "not available", c: C.blocked };
const thirdRegion = (key: "basic" | "standard") => (plan(key).regionsMax >= 3 ? addonCell("region", key) : { v: "not available", c: C.blocked });
const included = { v: "included", c: C.clear };
const free = { v: "free", c: C.clear };

const GROW = [
  { k: "One more recipe", note: "Pack sizes and artwork versions are always free", b: addonCell("recipe", "basic"), s: addonCell("recipe", "standard"), a: included },
  { k: "A second region", note: null, b: secondRegion("basic"), s: secondRegion("standard"), a: included },
  { k: "A third region", note: null, b: thirdRegion("basic"), s: thirdRegion("standard"), a: included },
  { k: "One more person who edits", note: `Beyond the ${inWords(basic.editors ?? 0)} or ${inWords(standard.editors ?? 0)} included`, b: addonCell("editor_seat", "basic"), s: addonCell("editor_seat", "standard"), a: free },
  { k: "Somebody who only reads", note: "Internal or external, as many as you like", b: free, s: free, a: free },
  { k: "A supplier who uploads a document", note: "A scoped link, not an account", b: free, s: free, a: free },
  { k: "The most extra recipes can cost you", note: "Then we offer you the next plan instead", b: { v: `${euros(basic.overageCap ?? 0)}/mo`, c: C.action }, s: { v: `${euros(standard.overageCap ?? 0)}/mo`, c: C.action }, a: { v: "n/a", c: C.n600 } },
];

const ANSWERS = [
  { q: "Is there a catch in the three free labels?", a: "No feature is held back. You get every finding, every market in your region, the provenance on each answer, and reports you can export, email and share. The limit is the count, not the product — and there is no clock, so a label you upload in three months still counts as one of the three.", bar: C.accent },
  { q: "Why is checking never charged for?", a: "Because a meter on a compliance check is a reason not to run one, and the check somebody skipped is the one that costs money. It also means a rule change never costs you anything to respond to.", bar: C.clear },
  { q: "What happens if I stop paying?", a: "Your workspace stops accepting new labels. Nothing is deleted, everything you have already checked stays readable, and every report you sent stays verifiable by whoever holds it. We do not hold a compliance history hostage, and we never break a document somebody else is relying on.", bar: C.clear },
  { q: "Can I get my data out?", a: "Yes, on every plan including the free one, at no charge, with the ruleset version on every row. If you leave, you leave with everything.", bar: C.clear },
  { q: "Do you offer a discount?", a: "One, and it is the same for everybody: an annual term is ten months for twelve. We concede on term rather than on price, so nobody on your plan is paying less than you are.", bar: C.none },
];


export default function PricingPage() {
  return (
    <div style={sx("background: var(--paper)")}>
      <header data-testid="header" style={sx("border-bottom: 1px solid var(--ink); background: var(--paper)")}>
        <div style={sx("max-width: 1180px; margin: 0 auto; padding: 15px 26px; display: flex; align-items: center; gap: 22px")}>
          <SiteMark ai={14} />
          <div style={sx("flex: 1")} />
          <Link href={PUBLIC_ROUTES.coverage} style={sx("font-size: 13.5px")}>Coverage</Link>
          <Link href={segmentHref(SEGMENTS[0].slug)} style={sx("font-size: 13.5px")}>Who it is for</Link>
          <Link href={START} className="pub-tab" style={sx("border: 1px solid var(--accent); color: var(--accent-700); border-radius: 3px; padding: 8px 15px; font-size: 13.5px")}>Check three labels free</Link>
        </div>
      </header>

      <main>
        <section data-testid="intro" style={sx("border-bottom: 1px solid var(--ink)")}>
          <div style={sx("max-width: 1180px; margin: 0 auto; padding: 44px 26px 38px")}>
            <p style={sx("margin: 0; font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent)")}>Pricing</p>
            <h1 style={sx("margin: 14px 0 0; font-size: 46px; font-weight: 600; line-height: 1.03; max-width: 22ch; text-wrap: pretty")}>Check three labels free. Then decide.</h1>
            <p style={sx("margin: 16px 0 0; font-size: 17px; line-height: 1.55; color: var(--n700); max-width: 74ch; text-wrap: pretty")}>The whole product for your first three labels, with no card and no clock: every finding, every market, and reports you can export, email and share. If it is any good you will know by the third one.</p>
            <div style={sx("margin-top: 32px; display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 18px")}>
              {QUESTIONS.map((q, i) => (
                <div key={q.n} className="blueprint" style={sx(`position: relative; border: 1px solid var(--ink); border-top: 4px solid ${i === 2 ? "var(--accent)" : "var(--n400)"}; background: var(--paper); padding: 20px 22px`)}>
                  {corners}
                  <p style={sx("margin: 0; font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.11em; text-transform: uppercase; color: var(--n600)")}>{q.n}</p>
                  {q.k ? <p style={sx("margin: 10px 0 0; font-size: 17px; font-weight: 600; line-height: 1.2")}>{q.k}</p> : null}
                  <p style={sx("margin: 9px 0 0; font-size: 13.5px; line-height: 1.6; color: var(--n700)")}>{q.v}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <Ladder />

        <section data-testid="never" style={sx("border-bottom: 1px solid var(--ink); background: var(--panel)")}>
          <div style={sx("max-width: 1180px; margin: 0 auto; padding: 38px 26px 42px")}>
            <div style={sx("display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; align-items: start")}>
              <div className="blueprint" style={sx("position: relative; border: 1px solid var(--ink); border-top: 4px solid var(--clear); background: var(--paper); padding: 24px 26px")}>
                {corners}
                <p style={sx("margin: 0; font-family: var(--mono); font-size: 10px; letter-spacing: 0.13em; text-transform: uppercase; color: var(--clear)")}>Never charged for, on any plan</p>
                <h2 style={sx("margin: 11px 0 0; font-size: 24px; font-weight: 600; line-height: 1.15")}>Check as often as you like</h2>
                <p style={sx("margin: 10px 0 0; font-size: 13.5px; line-height: 1.6; color: var(--n700)")}>A meter on a compliance check is a reason not to run one, and the check you did not run is the one that costs you. So we price the portfolio and never the activity.</p>
                <div style={sx("margin-top: 16px; display: flex; flex-wrap: wrap; gap: 8px")}>
                  {NEVER.map((nv) => (
                    <span key={nv} style={sx("border: 1px solid var(--clear); background: var(--clear-bg); padding: 6px 11px; font-size: 12.5px; color: var(--n800)")}>{nv}</span>
                  ))}
                </div>
              </div>
              <div className="blueprint" style={sx("position: relative; border: 1px solid var(--ink); border-top: 4px solid var(--blocked); background: var(--paper); padding: 24px 26px")}>
                {corners}
                <p style={sx("margin: 0; font-family: var(--mono); font-size: 10px; letter-spacing: 0.13em; text-transform: uppercase; color: var(--blocked)")}>Not sold at any price</p>
                <h2 style={sx("margin: 11px 0 0; font-size: 24px; font-weight: 600; line-height: 1.15")}>Where we stop</h2>
                <p style={sx("margin: 10px 0 0; font-size: 13.5px; line-height: 1.6; color: var(--n700)")}>We name the obligation, the authority, the route, the evidence, the fee and the deadline, and we fill in everything your product record already answers. Then you file it, because only the operator named on the label can.</p>
                <div style={sx("margin-top: 16px; display: flex; flex-direction: column; gap: 9px")}>
                  {NOT_SOLD.map((ns) => (
                    <div key={ns} style={sx("display: flex; gap: 10px; align-items: baseline")}>
                      <span aria-hidden="true" style={sx("width: 11px; height: 11px; flex: none; margin-top: 4px; background: var(--blocked); box-shadow: inset 0 4px 0 var(--paper), inset 0 -4px 0 var(--blocked)")} />
                      <span style={sx("font-size: 13px; line-height: 1.5; color: var(--n800)")}>{ns}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section data-testid="qualify" style={sx("border-bottom: 1px solid var(--ink)")}>
          <div style={sx("max-width: 1180px; margin: 0 auto; padding: 38px 26px 42px")}>
            <p style={sx(eyebrow)}>Work out which one without asking us</p>
            <h2 style={sx("margin: 12px 0 0; font-size: 30px; font-weight: 600; line-height: 1.1; max-width: 28ch")}>Find yourself in this table</h2>
            <div className="blueprint" role="table" aria-label="Which plan" style={sx("position: relative; margin-top: 24px; border: 1px solid var(--ink); background: var(--paper)")}>
              {corners}
              <div role="row" style={sx("display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1.35fr) 132px; background: var(--panel); border-bottom: 1px solid var(--ink)")}>
                <p role="columnheader" style={sx("margin: 0; padding: 11px 16px; font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--n600)")}>If this is you</p>
                <p role="columnheader" style={sx("margin: 0; padding: 11px 16px; font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--n600)")}>What decides it</p>
                <p role="columnheader" style={sx("margin: 0; padding: 11px 16px; font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent)")}>Plan</p>
              </div>
              {QUALIFY.map((q, i, a) => (
                <div key={q.who} role="row" style={sx(`display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1.35fr) 132px; border-bottom: ${i < a.length - 1 ? "1px solid var(--n200)" : "none"}; background: ${i % 2 ? "var(--panel)" : "transparent"}`)}>
                  <p role="cell" style={sx("margin: 0; padding: 13px 16px; font-size: 13.5px; font-weight: 500; line-height: 1.4")}>{q.who}</p>
                  <p role="cell" style={sx("margin: 0; padding: 13px 16px; font-size: 13px; line-height: 1.5; color: var(--n700)")}>{q.why}</p>
                  <p role="cell" style={sx(`margin: 0; padding: 13px 16px; font-family: var(--mono); font-size: 11px; letter-spacing: 0.05em; color: ${q.color}`)}>{q.tier}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section data-testid="grow" style={sx("border-bottom: 1px solid var(--ink); background: var(--panel)")}>
          <div style={sx("max-width: 1180px; margin: 0 auto; padding: 38px 26px 42px")}>
            <div style={sx("display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 22px; align-items: start")}>
              <div>
                <p style={sx(eyebrow)}>When you outgrow a plan</p>
                <h2 style={sx("margin: 12px 0 0; font-size: 28px; font-weight: 600; line-height: 1.1; max-width: 26ch")}>What it costs to grow, before you grow</h2>
                <p style={sx("margin: 11px 0 0; font-size: 14.5px; line-height: 1.6; color: var(--n700)")}>Every one of these is published so nothing on an invoice is a surprise. And the bill for extra recipes stops at half again the plan price — past that we offer you the next plan rather than keep charging.</p>
                <div className="blueprint" style={sx("position: relative; margin-top: 20px; border: 1px solid var(--ink); border-left: 4px solid var(--action); background: var(--paper); padding: 18px 20px")}>
                  {corners}
                  <p style={sx("margin: 0; font-size: 14px; font-weight: 600")}>The one number to know</p>
                  <p style={sx("margin: 7px 0 0; font-size: 13px; line-height: 1.55; color: var(--n700)")}>A recipe is the thing you formulate. Pack sizes, artwork versions and label variants of the same recipe are free and always have been — an eight-recipe brand is billed for eight, not for its twenty-four pack codes.</p>
                </div>
              </div>
              <div className="blueprint" role="table" aria-label="What it costs to grow" style={sx("position: relative; border: 1px solid var(--ink); background: var(--paper)")}>
                {corners}
                <div role="row" style={sx("display: grid; grid-template-columns: minmax(0, 1fr) 96px 96px 96px; background: var(--panel); border-bottom: 1px solid var(--ink)")}>
                  {["What you add", basic.name, standard.name, plan("advanced").name].map((gh) => (
                    <p key={gh} role="columnheader" style={sx("margin: 0; padding: 10px 13px; font-family: var(--mono); font-size: 9px; letter-spacing: 0.09em; text-transform: uppercase; color: var(--n600)")}>{gh}</p>
                  ))}
                </div>
                {GROW.map((g, i, a) => (
                  <div key={g.k} role="row" data-testid="grow-row" style={sx(`display: grid; grid-template-columns: minmax(0, 1fr) 96px 96px 96px; border-bottom: ${i < a.length - 1 ? "1px solid var(--n200)" : "none"}; background: ${i % 2 ? "var(--panel)" : "transparent"}`)}>
                    <div role="cell" style={sx("padding: 12px 13px")}>
                      <p style={sx("margin: 0; font-size: 13px; font-weight: 500")}>{g.k}</p>
                      {g.note ? <p style={sx("margin: 4px 0 0; font-size: 11.5px; line-height: 1.4; color: var(--n600)")}>{g.note}</p> : null}
                    </div>
                    {[g.b, g.s, g.a].map((cell, j) => (
                      <p key={j} role="cell" style={sx(`margin: 0; padding: 12px 13px; font-family: var(--mono); font-size: 11px; color: ${cell.c}`)}>{cell.v}</p>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section data-testid="partner" style={sx("border-bottom: 1px solid var(--ink)")}>
          <div style={sx("max-width: 1180px; margin: 0 auto; padding: 36px 26px 40px")}>
            <div className="blueprint" style={sx("position: relative; border: 1px solid var(--ink); border-top: 4px solid var(--accent); background: var(--paper); padding: 26px 28px")}>
              {corners}
              <div style={sx("display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px; align-items: start")}>
                <div>
                  <p style={sx(eyebrow)}>If you answer for other companies&apos; products</p>
                  <h2 style={sx("margin: 11px 0 0; font-size: 28px; font-weight: 600; line-height: 1.1; max-width: 26ch")}>{PARTNER.name}</h2>
                  <p style={sx("margin: 11px 0 0; font-size: 14.5px; line-height: 1.6; color: var(--n700)")}>A consultancy does not have a portfolio. It has ten of somebody else&apos;s, each with its own markets, its own artwork and its own confidentiality. Priced on client workspaces rather than on recipes.</p>
                  <p style={sx("margin: 16px 0 0; font-size: 13.5px; line-height: 1.6; color: var(--n700)")}>Your clients read their own workspace free, their data never mixes with another client&apos;s, and they can revoke your access at any time and keep everything.</p>
                </div>
                <div>
                  <p data-testid="partner-price" style={sx("margin: 0; font-family: var(--mono); font-size: 32px; line-height: 1; color: var(--accent-700)")}>{euros(PARTNER.monthly)}</p>
                  <p style={sx("margin: 7px 0 0; font-family: var(--mono); font-size: 10px; letter-spacing: 0.05em; color: var(--n600)")}>PER MONTH · EXCL. VAT · AFTER LAUNCH</p>
                  <div style={sx("margin-top: 18px; display: flex; flex-direction: column; gap: 8px")}>
                    <div style={sx("display: flex; justify-content: space-between; gap: 12px; align-items: baseline; border-bottom: 1px solid var(--n200); padding-bottom: 8px")}>
                      <span style={sx("font-size: 13px; color: var(--n700)")}>Client workspaces</span>
                      <span style={sx("font-family: var(--mono); font-size: 11.5px; text-align: right; color: var(--ink)")}>{PARTNER.clientWorkspaces}</span>
                    </div>
                  </div>
                  <a href={CONTACT} className="pub-primary" style={sx("margin-top: 16px; display: inline-block; background: var(--accent); color: var(--paper); border-radius: 3px; padding: 11px 18px; font-size: 14px; font-weight: 500")}>Talk to us about Partner</a>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section data-testid="answers" style={sx("border-bottom: 1px solid var(--ink); background: var(--panel)")}>
          <div style={sx("max-width: 1180px; margin: 0 auto; padding: 38px 26px 42px")}>
            <p style={sx(eyebrow)}>Before you ask</p>
            <h2 style={sx("margin: 12px 0 0; font-size: 30px; font-weight: 600; line-height: 1.1")}>Answers we would rather give you now</h2>
            <div style={sx("margin-top: 24px; display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 20px")}>
              {ANSWERS.map((an) => (
                <div key={an.q} style={sx(`border-left: 3px solid ${an.bar}; padding-left: 16px`)}>
                  <h3 style={sx("margin: 0; font-size: 15px; font-weight: 600; line-height: 1.25; letter-spacing: normal")}>{an.q}</h3>
                  <p style={sx("margin: 8px 0 0; font-size: 13.5px; line-height: 1.6; color: var(--n700)")}>{an.a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section data-testid="close">
          <div style={sx("max-width: 1180px; margin: 0 auto; padding: 46px 26px 56px; text-align: center")}>
            <h2 style={sx("margin: 0 auto; font-size: 34px; font-weight: 600; line-height: 1.1; max-width: 24ch; text-wrap: pretty")}>Three labels. Then decide.</h2>
            <p style={sx("margin: 14px auto 0; font-size: 16px; line-height: 1.6; color: var(--n700); max-width: 62ch")}>The whole product, no card, no sales call, no company-size field. No countdown either — the three labels wait for you, because artwork does not arrive on our schedule.</p>
            <div style={sx("margin-top: 24px; display: flex; gap: 12px; justify-content: center; flex-wrap: wrap")}>
              <Link href={START} className="pub-primary" style={sx("background: var(--accent); color: var(--paper); border-radius: 3px; padding: 14px 26px; font-size: 15.5px; font-weight: 500")}>Check three labels free</Link>
              <Link href={PUBLIC_ROUTES.coverage} className="pub-secondary" style={sx("border: 1px solid var(--n400); border-radius: 3px; padding: 14px 22px; font-size: 15.5px; color: var(--n800)")}>See what we cover first</Link>
            </div>
            <p style={sx("margin: 22px auto 0; font-size: 12.5px; line-height: 1.6; color: var(--n600); max-width: 76ch")}>Nutrivo names regulatory obligations and checks label artwork against encoded rules. It does not file registrations, pay fees, correspond with authorities, confirm that a registration is valid, or guarantee acceptance.</p>
          </div>
        </section>
      </main>

      <footer data-testid="footer" style={sx("border-top: 1px solid var(--ink); background: var(--paper)")}>
        <div style={sx("max-width: 1180px; margin: 0 auto; padding: 20px 26px; display: flex; align-items: baseline; gap: 20px; flex-wrap: wrap")}>
          <p style={sx("margin: 0; font-size: 12.5px; color: var(--n600)")}>Sunny Ventures AB, trading as Nutrivo.ai · Karlbergsvägen 48, 113 37 Stockholm, Sweden · VAT SE559429715101</p>
          <div style={sx("flex: 1")} />
          <Link href={PUBLIC_ROUTES.terms} style={sx("font-size: 12.5px")}>Terms</Link>
          <Link href={PUBLIC_ROUTES.privacy} style={sx("font-size: 12.5px")}>Privacy</Link>
          <Link href={PUBLIC_ROUTES.coverage} style={sx("font-size: 12.5px")}>Coverage</Link>
        </div>
      </footer>
    </div>
  );
}
