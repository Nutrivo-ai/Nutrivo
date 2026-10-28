// The data of S-FAQ-002, verbatim from renderVals() in design/public/Nutrivo FAQ and About.dc.html (T-603). The rules
// for what is left out are those in questions.ts (plan on issue #60, D-19). Omitted from /about:
// - the "Draft — the facts about the company are placeholders" banner;
// - the heading "We check pet food labels against the law of every market you sell in" (coverage: every market,
//   against D-01's four launch nodes);
// - "The European Union, the United Kingdom and the United States including every state, in the language each panel is
//   printed in. Composition, additives, mandatory particulars, claims, character heights measured against the legal
//   minimum, and every registration you owe with the authority and the deadline." (coverage, against D-01 and D-22);
// - "Not because we are being careful with our liability, but because only the operator named on the label is
//   entitled to." (regulation);
// - "How this started" and "Who does this", with their story and people (placeholders; no named people, D-19);
// - from "The company": "Governing law: Swedish law, Stockholm District Court" (no source: legal terms await counsel,
//   D-20), "Data processed in: Ireland, European Union" (decision: hosting is Frankfurt, D-02) and "Security:
//   security@nutrivo.ai · acknowledged within one working day" (no source on record for the address or the time).

const C = { clear: "var(--clear)", action: "var(--action)", accent: "var(--accent)" };

export const BELIEFS = [
  { k: "An answer you can audit", v: "Every result carries four states, and Not assessed is one of them, shown as prominently as Clear and never inferred away into a pass. A regulatory manager can trace any verdict back to the article behind it.", proof: "The four states, on every screen and every document.", bar: C.accent },
  { k: "An answer should say where it came from", v: "A deterministic rule and a model judgement are different kinds of claim, and a regulatory professional's first question is which one they are reading. So we mark it, per finding, rather than in a footer.", proof: "Provenance on every finding, and on every translated string.", bar: C.clear },
  { k: "Publish the depth, including the holes", v: "We only sell a market once we have published exactly how much of it we hold. If we would not publish a market's depth, we do not offer it.", proof: "The coverage page, rendered from the same table the engine queries.", bar: C.clear },
  { k: "Never charge for the check", v: "A meter on a compliance check is a reason not to run one, and the check somebody skipped is the one that costs money. We price the portfolio and never the activity.", proof: "Unlimited re-checks on every plan, including the free allowance.", bar: C.action },
];

export const NEVER = [
  "File a registration, notification or application for you",
  "Pay an authority's fee on your behalf",
  "Correspond with an authority about your product",
  "Confirm that a registration is valid or in force",
  "Guarantee that anybody will accept your label",
];

/** Company details as docs/14-research-log.md records them for Stripe and the legal pages. */
export const COMPANY = [
  { k: "Legal entity", v: "Sunny Ventures AB, company registration 5594297151" },
  { k: "Trading as", v: "Nutrivo.ai" },
  { k: "Registered office", v: "Karlbergsvägen 48, 113 37 Stockholm, Sweden" },
  { k: "VAT", v: "SE559429715101" },
  { k: "General enquiries", v: "hello@nutrivo.ai" },
];

/** Distinctive parts of what /about omits, for the test that none of it appears on the page. */
export const OMITTED_ABOUT = [
  "Draft — the facts about the company are placeholders",
  "placeholders",
  "We check pet food labels against the law of every market you sell in",
  "including every state",
  "The European Union, the United Kingdom",
  "character heights measured against the legal minimum",
  "only the operator named on the label is entitled to",
  "How this started",
  "Who does this",
  "Placeholder",
  "PLACEHOLDER",
  "Founder",
  "Stockholm District Court",
  "Governing law",
  "Ireland",
  "security@nutrivo.ai",
  "one working day",
];
