"use client";

import Link from "next/link";
import { useState } from "react";
import { CONTACT, START } from "@/lib/public/links";
import { addonAmount, euros, FREE_ARTWORKS, inWords, monthsFree, plan, priceLabel, type Interval } from "@/lib/public/pricing";
import { sx } from "@/lib/public/sx";

// S-LND-001 "Pricing" (P02): the landing page's own four plan cards, every figure from config/pricing.ts. Departures
// from the Landing Page file (plan on issue #60, review on PR 142): Free's people follow D-21 and config (no seat
// limit, question 2); Advanced's experts on quotation are omitted (no source holds them); regions show as config's
// count, never named or "whole", and the heading, lead and "Pick your region" chips that sell the EU, UK and US whole
// are omitted (D-01, D-22); the signed certificate and the "who" line resting on it come after launch (docs/00).

type Tier = {
  key: "free" | "basic" | "standard" | "advanced"; name: string; who: string; price: string; priceNote: string; cta: string; href: string;
  caps: [string, string][]; lines: string[]; primary: boolean;
};

const chip = (on: boolean) =>
  `font-family: var(--mono); font-size: 11px; letter-spacing: 0.06em; padding: 6px 12px; border: 1px solid ${on ? "var(--accent)" : "var(--n400)"}; background: ${on ? "var(--accent)" : "transparent"}; color: ${on ? "var(--paper)" : "var(--n700)"}; border-radius: 3px`;

function tiers(interval: Interval): Tier[] {
  const year = interval === "year";
  const months = inWords(monthsFree("basic"));
  const free = plan("free"), basic = plan("basic"), standard = plan("standard"), advanced = plan("advanced");
  const count = (n: number | null, none: string) => (n === null ? none : String(n));
  const region = addonAmount("region", "standard", interval) ?? 0;
  return [
    { key: "free", name: free.name, who: "See what we find on your first three labels.", price: priceLabel("free", interval), priceNote: "The whole product on three labels, sending included. No card, no clock.", cta: "Check three labels", href: START,
      caps: [["Labels", String(FREE_ARTWORKS)], ["Regions", String(free.regionsMax)], ["People", count(free.editors, "no limit")], ["Checks", "as you like"]],
      lines: ["Whether your label is compliant, or not", "Every problem we find, in plain terms", "Where each answer came from", "What we could not check, and why", "A note whenever a rule changes"],
      primary: false },
    { key: "basic", name: basic.name, who: "One brand, selling in one region.", price: priceLabel("basic", interval), priceNote: year ? `per year — ${months} months free` : "per month, billed monthly", cta: "Start free", href: START,
      caps: [["Recipes", count(basic.recipes, "no limit")], ["Regions", String(basic.regionsMax)], ["Can edit", count(basic.editors, "free")], ["Only read", "free"]],
      lines: ["Everything in Free", "A report you can send", "Download it, email it, or share a link", "What you must register, with whom, by when", "Every pack size and artwork version included"],
      primary: true },
    { key: "standard", name: standard.name, who: "A full range, selling in one region or two.", price: priceLabel("standard", interval), priceNote: year ? `per year — ${months} months free` : "per month, billed monthly", cta: "Start free", href: START,
      caps: [["Recipes", count(standard.recipes, "no limit")], ["Regions", `${standard.regionsIncluded}, ${standard.regionsMax} max`], ["Can edit", count(standard.editors, "free")], ["Only read", "free"]],
      lines: ["Everything in Basic", `Add a second region? ${euros(region)} a ${interval}`, "Ask a supplier for a spec once, not per product", "A document pack per market, ready to send", "Your whole range on one board"],
      primary: false },
    { key: "advanced", name: advanced.name, who: "", price: priceLabel("advanced", interval), priceNote: year ? "per year, for the software" : "per month, for the software", cta: "Talk to us", href: CONTACT,
      caps: [["Recipes", count(advanced.recipes, "no limit")], ["Regions", String(advanced.regionsIncluded)], ["People", "unlimited, free"]],
      lines: ["Everything in Standard", "As many people as you like, all free"],
      primary: false },
  ];
}

export function Plans() {
  const [interval, setTerm] = useState<Interval>("month");
  const terms: { id: Interval; label: string }[] = [
    { id: "month", label: "Monthly" },
    { id: "year", label: `Annual — ${monthsFree("basic")} months free` },
  ];
  return (
    <>
      <div style={sx("display: flex; align-items: flex-end; justify-content: space-between")}>
        <div data-testid="plans-head">
          <p style={sx("margin: 0; font-family: var(--mono); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent)")}>Pricing</p>
        </div>
        <div role="group" aria-label="Billing term" style={sx("display: flex; gap: 4px; padding-bottom: 6px")}>
          {terms.map((t) => (
            <button key={t.id} type="button" aria-pressed={interval === t.id} onClick={() => setTerm(t.id)} className="pub-tab" style={sx(`cursor: pointer; ${chip(interval === t.id)}`)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={sx("margin-top: 30px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; align-items: stretch")}>
        {tiers(interval).map((t) => (
          <div
            key={t.key}
            data-testid={`landing-plan-${t.key}`}
            style={sx(`position: relative; border: 1px solid ${t.primary ? "var(--ink)" : "var(--rule)"}; border-top: 4px solid ${t.primary ? "var(--accent)" : "var(--n400)"}; padding: 24px 22px 26px; display: flex; flex-direction: column; background: ${t.primary ? "var(--accent-100)" : "transparent"}`)}
          >
            {t.primary ? (
              <div aria-hidden="true">
                {[["top", "left"], ["top", "right"], ["bottom", "left"], ["bottom", "right"]].map(([v, h]) => (
                  <span key={v + h} style={{ ...sx("position: absolute; font-family: var(--mono); font-size: 13px; line-height: 1; color: var(--accent-200)"), [v]: -8, [h]: -6 }}>+</span>
                ))}
              </div>
            ) : null}
            <h3 style={sx("margin: 0; font-size: 20px; font-weight: 600; line-height: 1; height: 22px; letter-spacing: normal")}>{t.name}</h3>
            <p style={sx(`margin: 8px 0 0; font-size: 13.5px; line-height: 1.4; color: ${t.primary ? "var(--accent-700)" : "var(--n600)"}; height: 38px`)}>{t.who}</p>
            <p data-testid="price" style={sx("margin: 14px 0 0; font-size: 30px; font-weight: 600; line-height: 1.05; letter-spacing: -0.03em; min-height: 34px")}>{t.price}</p>
            <p style={sx(`margin: 6px 0 0; font-size: 12.5px; line-height: 1.4; color: ${t.primary ? "var(--n700)" : "var(--n600)"}; min-height: 36px`)}>{t.priceNote}</p>
            <Link
              href={t.href}
              className={t.primary ? "pub-primary" : "pub-secondary"}
              style={sx(`margin-top: 16px; display: block; text-align: center; font-size: 14.5px; font-weight: 500; padding: 12px 16px; border-radius: 3px; ${t.primary ? "background: var(--accent); color: var(--paper); border: 1px solid var(--accent);" : "border: 1px solid var(--n400); color: var(--ink);"}`)}
            >
              {t.cta}
            </Link>
            <div style={sx("margin-top: 18px; border-top: 1px solid var(--ink)")}>
              {t.caps.map(([k, v]) => (
                <div key={k} style={sx("display: flex; justify-content: space-between; align-items: baseline; gap: 8px; border-bottom: 1px solid var(--n200); padding: 7px 0")}>
                  <p style={sx(`margin: 0; font-size: 12.5px; color: ${t.primary ? "var(--n700)" : "var(--n600)"}`)}>{k}</p>
                  <p style={sx("margin: 0; font-family: var(--mono); font-size: 12px; font-weight: 500; text-align: right")}>{v}</p>
                </div>
              ))}
            </div>
            <div style={sx("margin-top: 16px; min-height: 96px")}>
            </div>
            <div style={sx("flex: 1; display: flex; flex-direction: column; gap: 6px")}>
              {t.lines.map((l) => (
                <p key={l} style={sx("margin: 0; font-size: 13px; line-height: 1.4")}>{l}</p>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
