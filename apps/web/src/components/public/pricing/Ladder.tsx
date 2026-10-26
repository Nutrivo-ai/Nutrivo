"use client";

import Link from "next/link";
import { useState } from "react";
import { CONTACT, START } from "@/lib/public/links";
import { addonAmount, euros, FREE_ARTWORKS, inWords, monthsFree, plan, priceLabel, type Interval } from "@/lib/public/pricing";
import { sx } from "@/lib/public/sx";

// S-PRC-001 "Four plans" (P02): the term toggle and the four plan cards. Every figure comes from config/pricing.ts
// through @/lib/public/pricing; the copy is the Pricing Page file's. Omitted from the design (D-19, issue #60): Advanced's
// "to 100 recipes" and "Above 100 recipes the price is quoted…", which docs/08 and config do not hold. Free's editors
// follow D-21 and config (no seat limit, question 2), where the design drew "2". On the highlighted card the grey
// labels are one step darker than drawn (n700), because n600 on accent-100 fails axe's contrast check.

const C = { clear: "var(--clear)", action: "var(--action)", n700: "var(--n700)", ink: "var(--ink)" };

type Dial = { k: string; v: string; color: string };
type Tier = {
  k: string; tag: string; who: string; price: string; per: string; on: boolean; primary: boolean; btn: string; href: string;
  dials: Dial[]; gets: string[]; move: string | null; moveColor: string; tick: string;
};

const card = (on: boolean) =>
  `position: relative; border: 1px solid ${on ? "var(--accent)" : "var(--ink)"}; border-top: 4px solid ${on ? "var(--accent)" : "var(--n400)"}; background: ${on ? "var(--accent-100)" : "var(--paper)"}; padding: 22px 22px 22px; display: flex; flex-direction: column`;
const btn = (primary: boolean) =>
  primary
    ? "margin-top: 16px; text-align: center; background: var(--accent); color: var(--paper); border-radius: 3px; padding: 12px; font-size: 14px; font-weight: 500"
    : "margin-top: 16px; text-align: center; border: 1px solid var(--n400); border-radius: 3px; padding: 12px; font-size: 14px; color: var(--n800)";

const count = (n: number | null, none: string) => (n === null ? none : String(n));

export function tiers(interval: Interval): Tier[] {
  const free = plan("free"), basic = plan("basic"), standard = plan("standard"), advanced = plan("advanced");
  const per = interval === "year" ? "PER YEAR · EXCL. VAT" : "PER MONTH · EXCL. VAT";
  const region = addonAmount("region", "standard", interval);
  return [
    { k: free.name, tag: "NO CARD, NO CLOCK", who: "Three labels, the whole product. For finding out whether the answer is any good.",
      price: priceLabel("free", interval), per: "THREE LABELS · NOTHING HELD BACK", on: false, primary: false, btn: "Check three labels", href: START,
      dials: [
        { k: "Labels", v: String(FREE_ARTWORKS), color: C.ink },
        { k: "Regions", v: `${free.regionsMax}, whole`, color: C.n700 },
        { k: "People who edit", v: count(free.editors, "NO LIMIT"), color: C.n700 },
        { k: "Sending", v: "INCLUDED", color: C.clear },
      ],
      gets: ["Whether your label is compliant, or not", "Every problem we found, in plain terms", "Where each answer came from, and what we could not check", "Reports you can export, email and share", "Re-check the same label as often as you like"],
      move: "The fourth label is where a plan starts. Nothing you checked is taken away.", moveColor: C.action, tick: "var(--n400)" },
    { k: basic.name, tag: "", who: "One brand, selling into one region. The plan most first customers need.",
      price: priceLabel("basic", interval), per, on: false, primary: false, btn: `Choose ${basic.name}`, href: START,
      dials: [
        { k: "Recipes", v: count(basic.recipes, "NO LIMIT"), color: C.ink },
        { k: "Regions", v: `${basic.regionsMax}, whole`, color: C.ink },
        { k: "People who edit", v: count(basic.editors, "FREE"), color: C.ink },
        { k: "People who read", v: "FREE", color: C.clear },
      ],
      gets: ["Everything in Free", "A report you can send, email or share", "Whoever receives it can check it is real", "What you must register, with whom, by when", "Your document pack per market"],
      move: "You outgrow it at a second region, thirty recipes, or a fourth person who edits.", moveColor: C.n700, tick: "var(--n400)" },
    { k: standard.name, tag: "MOST RANGES", who: "A full range, selling into one region or two. Room to expand without a conversation.",
      price: priceLabel("standard", interval), per, on: true, primary: true, btn: `Choose ${standard.name}`, href: START,
      dials: [
        { k: "Recipes", v: count(standard.recipes, "NO LIMIT"), color: C.ink },
        { k: "Regions", v: `${standard.regionsIncluded}, plus ${standard.regionsMax - standard.regionsIncluded} more`, color: C.ink },
        { k: "People who edit", v: count(standard.editors, "FREE"), color: C.ink },
        { k: "People who read", v: "FREE", color: C.clear },
      ],
      gets: ["Everything in Basic", `A second region for ${euros(region ?? 0)} a ${interval}`, "Ask a supplier for a specification once, not per recipe", "Give a consultant or co-packer access to named recipes", "Watch every market for rule changes that touch you"],
      move: "You move up at a third region, or when somebody has to sign for a label.", moveColor: C.n700, tick: "var(--accent)" },
    { k: advanced.name, tag: "", who: "When somebody in your company has to put their name to a label.",
      price: priceLabel("advanced", interval), per, on: false, primary: false, btn: "Talk to us", href: CONTACT,
      dials: [
        { k: "Recipes", v: count(advanced.recipes, "NO LIMIT"), color: C.clear },
        { k: "Regions", v: `ALL ${inWords(advanced.regionsIncluded).toUpperCase()}`, color: C.clear },
        { k: "People", v: count(advanced.editors, "FREE"), color: C.clear },
        { k: "Signing", v: "PER MARKET", color: C.clear },
      ],
      gets: ["Everything in Standard", "All three regions: the EU, the UK and the US", "As many people as you like, all free", "A signed certificate, not only a report", "Single sign-on, and audit history you can export"],
      move: null, moveColor: C.n700, tick: "var(--n400)" },
  ];
}

export function Ladder() {
  const [interval, setTerm] = useState<Interval>("month");
  const terms: { id: Interval; k: string }[] = [
    { id: "month", k: "Monthly" },
    { id: "year", k: `Annual · ${inWords(monthsFree("basic"))} months free` },
  ];
  return (
    <section data-testid="ladder" style={sx("border-bottom: 1px solid var(--ink); background: var(--panel)")}>
      <div style={sx("max-width: 1180px; margin: 0 auto; padding: 36px 26px 44px")}>
        <div data-testid="ladder-head" style={sx("display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; flex-wrap: wrap")}>
          <div>
            <h2 style={sx("margin: 0; font-size: 30px; font-weight: 600; line-height: 1.1")}>Four plans</h2>
            <p style={sx("margin: 9px 0 0; font-size: 14.5px; line-height: 1.55; color: var(--n700); max-width: 70ch")}>Priced on what you manage — recipes, regions and people who edit. Never on how often you check, and never on tokens.</p>
          </div>
          <div style={sx("display: flex; flex-direction: column; gap: 9px; align-items: flex-end")}>
            <div role="group" aria-label="Billing term" style={sx("display: flex; border: 1px solid var(--n400); border-radius: 3px; overflow: hidden; background: var(--paper)")}>
              {terms.map((t) => {
                const on = interval === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setTerm(t.id)}
                    style={sx(`border: none; background: ${on ? "var(--accent)" : "transparent"}; color: ${on ? "var(--paper)" : "var(--n700)"}; padding: 10px 16px; font-size: 13px; font-weight: ${on ? "500" : "400"}; cursor: pointer`)}
                  >
                    {t.k}
                  </button>
                );
              })}
            </div>
            <span style={sx("font-family: var(--mono); font-size: 10px; letter-spacing: 0.05em; color: var(--n600)")}>ALL PRICES EXCLUDE VAT</span>
          </div>
        </div>

        <div style={sx("margin-top: 24px; display: grid; grid-template-columns: repeat(auto-fit, minmax(252px, 1fr)); gap: 16px; align-items: stretch")}>
          {tiers(interval).map((p) => (
            <div key={p.k} data-testid={`plan-${p.k.toLowerCase()}`} className="blueprint" style={sx(card(p.on))}>
              <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
              <div style={sx("display: flex; align-items: baseline; justify-content: space-between; gap: 10px; min-height: 22px")}>
                <h3 style={sx("margin: 0; font-size: 21px; font-weight: 600; line-height: 1.55; letter-spacing: normal")}>{p.k}</h3>
                {p.tag ? (
                  <span style={sx(`flex: none; font-family: var(--mono); font-size: 9px; letter-spacing: 0.07em; padding: 4px 7px; border: 1px solid ${p.on ? "var(--accent)" : "var(--n400)"}; color: ${p.on ? "var(--accent-700)" : "var(--n600)"}; background: var(--paper); white-space: nowrap`)}>{p.tag}</span>
                ) : null}
              </div>
              <p style={sx("margin: 8px 0 0; font-size: 13px; line-height: 1.5; color: var(--n700); min-height: 40px")}>{p.who}</p>
              <p data-testid="price" style={sx(`margin: 16px 0 0; font-family: var(--mono); font-size: 30px; line-height: 1; color: ${p.on ? "var(--accent-700)" : "var(--ink)"}`)}>{p.price}</p>
              <p style={sx(`margin: 7px 0 0; font-family: var(--mono); font-size: 10px; letter-spacing: 0.05em; color: ${p.on ? "var(--n700)" : "var(--n600)"}`)}>{p.per}</p>
              <div style={sx("margin-top: 16px; border-top: 1px solid var(--n200); padding-top: 13px; display: flex; flex-direction: column; gap: 8px")}>
                {p.dials.map((d) => (
                  <div key={d.k} style={sx("display: flex; justify-content: space-between; gap: 10px; align-items: baseline")}>
                    <span style={sx(`font-size: 12.5px; color: ${p.on ? "var(--n700)" : "var(--n600)"}`)}>{d.k}</span>
                    <span style={sx(`font-family: var(--mono); font-size: 11.5px; text-align: right; color: ${d.color}`)}>{d.v}</span>
                  </div>
                ))}
              </div>
              <ul style={sx("margin: 15px 0 0; list-style: none; border-top: 1px solid var(--n200); padding: 13px 0 0; display: flex; flex-direction: column; gap: 8px; flex: 1")}>
                {p.gets.map((g) => (
                  <li key={g} style={sx("display: flex; gap: 9px; align-items: baseline")}>
                    <span aria-hidden="true" style={sx(`width: 9px; height: 9px; flex: none; margin-top: 4px; background: ${p.tick}`)} />
                    <span style={sx("font-size: 12.5px; line-height: 1.45; color: var(--n800)")}>{g}</span>
                  </li>
                ))}
              </ul>
              {p.move ? (
                <p style={sx(`margin: 15px 0 0; padding-top: 12px; border-top: 1px solid var(--n200); font-size: 12.5px; line-height: 1.5; color: ${p.moveColor}`)}>{p.move}</p>
              ) : null}
              <Link href={p.href} className={p.primary ? "pub-primary" : "pub-secondary"} style={sx(`display: block; ${btn(p.primary)}`)}>{p.btn}</Link>
            </div>
          ))}
        </div>

        <p style={sx("margin: 20px 0 0; font-size: 13.5px; line-height: 1.6; color: var(--n700); max-width: 88ch")}>An annual term is ten months for twelve, on every plan. We concede on term, never on price — so nobody who signs the same plan as you pays less for it.</p>
      </div>
    </section>
  );
}

