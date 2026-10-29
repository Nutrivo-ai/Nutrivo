import { priceLabel } from "@/lib/public/pricing";

// The questions of S-FAQ-001, verbatim from the GROUPS array of design/public/Nutrivo FAQ and About.dc.html (T-603).
// Nothing is reworded. What is left out follows the plan on issue #60 and D-19, and each omission is named where it
// was cut:
// - coverage: a figure, date or fact about what Nutrivo holds that no released source backs;
// - regulation: a statement of what the law says, which no person has accepted as content (CLAUDE.md 7);
// - after launch / decision: a fact that docs/00-product.md or docs/02-decisions.md contradicts at launch;
// - no source: a commitment no document on record makes.
// A whole Q&A goes only when nothing of its answer is left.

const C = { clear: "var(--clear)", action: "var(--action)", none: "var(--none)", blocked: "var(--blocked)", accent: "var(--accent)" };

export type Question = { slug: string; bar: string; q: string; a: string; more?: string };
export type Group = { n: string; id: string; k: string; qs: Question[] };

export const GROUPS: Group[] = [
  { n: "01", id: "what", k: "What it is, and who it is for", qs: [
    { slug: "what-does-nutrivo-do", bar: C.accent, q: "What does Nutrivo do?",
      a: "It reads your label artwork, checks it against the regulatory rules we hold for every market you sell in, and tells you four things: what is clear, what needs action, what we did not check, and what is blocked outright.",
      more: "It also names what you have to register, with which authority, by when, and what evidence they will ask for — separately from the label check, because a label can be perfect and the product still unsellable." },
    { slug: "who-is-it-for", bar: C.accent, q: "Who is it for?",
      a: "Pet food and animal nutrition brands selling into more than one market, the contract manufacturers who make for them, and the regulatory consultants who do this work on their behalf.",
      more: "In practice the person using it is a regulatory or quality manager, an NPD manager who needs an answer before artwork is signed off, or a founder who is currently their own regulatory function." },
    // Omitted (regulation): "There are good horizontal tools for those, and feed law is a different rulebook — species,
    // life stage, additive conditions of use, PARNUT status."
    { slug: "who-is-it-not-for", bar: C.none, q: "Who is it not for?",
      a: "Human food and supplements. We went deep on one category rather than shallow across several.",
      more: "It is also not for somebody who wants a single green tick to show a retailer. The output is a report with states and gaps, which is more useful and less comfortable." },
    { slug: "what-exactly-is-a-check", bar: C.none, q: "What exactly is a check?",
      a: "One label artwork, assessed against every rule we hold for the markets you have selected, in the language each panel is printed in. A pack with German, French and Dutch panels is three language assessments of one artwork.",
      more: "Checks are never metered. Once a label is in your workspace you can re-check it as often as you like, on every plan including the free allowance." },
    // Omitted (regulation): "That stays with the operator named on the label, which is the whole basis of feed law."
    { slug: "is-this-legal-advice", bar: C.blocked, q: "Is this legal advice?",
      a: "No. It is an assessment against rules we have encoded, with the article cited for each one. It is not an opinion on your legal position and it does not create a lawyer-client relationship.",
      more: "Nothing we produce transfers responsibility for your product's compliance." },
  ] },
  { n: "02", id: "coverage", k: "How compliant is it, really", qs: [
    // Omitted whole: "How compliant is the software with EU, UK and US regulation?" (coverage: "We hold and check the
    // feed and pet food rules for the European Union, the United Kingdom and the United States including every state",
    // the list of domains it continues, and "Not because coverage is thin"; the one sentence left, "We also publish how
    // much we hold for each individual market…", does not answer the question).
    // Omitted whole: "So how do the three regimes actually differ?" (regulation: the EU, UK/Windsor and US regimes; the
    // product sentence that follows begins "None of those").
    { slug: "how-do-you-know-your-rules-are-right", bar: C.accent, q: "How do you know your rules are right?",
      a: "We extract them from official source text with an article-level citation, and a person accepts every entry before it can affect a result. Numeric thresholds and prescribed legal terms are extracted twice, independently, and any disagreement goes to a person rather than to a tie-break rule.",
      more: "One distinction we hold to: a prescribed legal designation is looked up from the official text, never translated. A linguistically perfect translation of a legal term is still a defect." },
    { slug: "what-happens-if-you-do-not-cover-something", bar: C.clear, q: "What happens if you do not cover something?",
      a: "The result is withheld and marked Not assessed, with a link to the coverage record that explains why — the method, the date, and the named gap. It is shown as prominently as any other state.",
      more: "A market where we hold no rules can never return Clear. That is enforced in the engine, not left to wording." },
    // Omitted (coverage): "We watch every source continuously — EUR-Lex, the national gazettes, GB and Northern Ireland,
    // the Federal Register, and every state feed control office — and we track changes at the level of individual
    // rules, so an alert says which of your recipes it touches and which it does not." (D-10: EU primary law only.)
    { slug: "what-happens-when-a-rule-changes", bar: C.clear, q: "What happens when a rule changes?",
      a: "You hear about it from us, with your own recipes named, while there is still time to act.",
      more: "It also carries the date the change takes effect, so you can tell a fourteen-month plan from something urgent. Editorial corrections never notify anybody, and re-checking after a change is free — a rule moving should not cost you anything to respond to." },
    // Omitted (coverage): "We watch what is coming as well as what has passed: Commission proposals, additive
    // re-authorisations under review, consultations in Great Britain, state bills in session, and the AAFCO committee
    // agenda ahead of each annual publication." (D-10: AAFCO not ingested.)
    // Omitted (regulation): "The case we design around is an additive losing its authorisation, because it carries a
    // sell-through deadline and it is the most expensive thing to discover late."
    { slug: "will-i-know-before-it-is-too-late", bar: C.accent, q: "Will I know about something before it is too late?",
      a: "That is the point of the product rather than a feature of it.",
      more: "An alert tells you what changed, whether it is law or still coming, when it takes effect, and which of your recipes it affects." },
    { slug: "do-you-check-in-the-local-language", bar: C.action, q: "Do you check in the local language?",
      a: "Yes, always, on the string as printed. On every plan including the free allowance.",
      more: "This is not a premium feature anywhere. Selling somebody a market and then checking their English copy is selling a verdict we know is invalid for the artwork." },
    { slug: "can-you-guarantee-an-authority-will-accept-my-label", bar: C.none, q: "Can you guarantee an authority will accept my label?",
      a: "No, and nobody honestly can. We can tell you it satisfies the rules we hold and name what we did not assess. An authority's decision is an authority's decision.",
      more: "If a supplier in this category tells you otherwise, ask them what happens contractually when an authority disagrees." },
  ] },
  { n: "03", id: "trying", k: "Trying it and paying for it", qs: [
    { slug: "do-i-need-to-enter-a-card-to-start", bar: C.clear, q: "Do I need to enter a card to start?",
      a: "No. Three labels, no card, no clock, no sales call, and no company-size field.",
      more: "You will not be asked for a card until you choose a plan, and nothing charges automatically at the end of anything." },
    { slug: "what-is-in-the-three-free-labels", bar: C.clear, q: "What is in the three free labels?",
      a: "The whole product. Every finding, every market in your region, where each answer came from, the coverage links, and reports you can export, email and share with somebody who has no account.",
      more: "Nothing is held back to make the trial feel limited. The limit is the count, not the features." },
    { slug: "what-happens-after-the-third-label", bar: C.accent, q: "What happens after the third label?",
      a: "The workspace stops accepting a new label until a plan starts. Nothing is removed: all three labels stay, every answer stays readable, the reports you sent stay verifiable, and re-checking them stays free.",
      more: "Re-checks, adding further markets in your region, and revised versions of the same artwork do not count against the three. Only a new artwork does." },
    // The three prices come from config/pricing.ts (docs/08), the design's own figures: "€249", "€499", "from €999".
    { slug: "how-is-it-priced", bar: C.accent, q: "How is it priced?",
      a: `On what you manage: recipes, regions, and people who edit. Never on how often you check and never on tokens. Basic is ${priceLabel("basic", "month")} a month, Standard ${priceLabel("standard", "month")}, Advanced ${priceLabel("advanced", "month")}, all excluding VAT.`,
      more: "A recipe is the thing you formulate. Pack sizes, artwork versions and label variants of the same recipe are free, so an eight-recipe brand is billed for eight rather than for its twenty-four pack codes." },
    // Omitted whole: "Why can I not buy a single country?" (regulation: "a member state or a US state is one edition of a
    // national rulebook…", federal law; coverage: "the EU means all twenty-seven, the US means every state", against
    // D-01 and D-22; the last sentence begins "It also").
    { slug: "what-happens-if-i-stop-paying", bar: C.clear, q: "What happens if I stop paying?",
      a: "Your workspace stops accepting new labels. Nothing is deleted, everything you have checked stays readable, and every report you sent stays verifiable by whoever is holding it.",
      more: "We will not break a document somebody outside your company is relying on because your card expired." },
    { slug: "do-you-offer-a-discount", bar: C.none, q: "Do you offer a discount?",
      a: "One, and it is the same for everybody: an annual term is ten months for twelve. We concede on term rather than on price, so nobody on your plan is paying less than you." },
  ] },
  { n: "04", id: "using", k: "Using it day to day", qs: [
    { slug: "what-do-i-upload", bar: C.accent, q: "What do I upload?",
      a: "Print-ready artwork as a PDF with live vector text. That is what lets us measure character heights against the legal minimums and pin each finding to a coordinate on the sheet.",
      more: "Outlined text or a flattened image still gets you most of the check, and we tell you exactly which panels we could not measure rather than quietly skipping them." },
    // Omitted whole: "How long does a check take?" (no source: "Minutes for a normal pack across a handful of markets"
    // is a performance commitment spec/nfr.yaml does not make, and the sentence after it explains that figure).
    { slug: "can-my-colleagues-use-it", bar: C.clear, q: "Can my colleagues use it?",
      a: "Yes. People who only read are free and unlimited on every paid plan, internal or external. Only people who edit take a seat.",
      more: "We never charge for read access, because circulation is what makes the tool useful — taxing it would be taxing the thing we want to happen." },
    { slug: "can-my-consultant-or-my-supplier-use-it", bar: C.clear, q: "Can my consultant or my supplier use it?",
      a: "A consultant is invited as an editor or a viewer, scoped to named recipes and markets, and marked external with an optional end date. A supplier gets a scoped link to upload one document and needs no account at all.",
      more: "A supplier is never a seat and never appears on your people screen. You are not charged for your suppliers' access." },
    // Omitted whole: "Who can sign a certificate?" (after launch: signed certificates and signing grants, A08 and I03,
    // come after launch per docs/00-product.md; regulation: "it makes no claim under eIDAS").
    { slug: "can-i-get-my-data-out", bar: C.clear, q: "Can I get my data out?",
      a: "Yes, on every plan including the free allowance, at no charge, with the ruleset version on every row.",
      more: "If you leave, you leave with everything. A tool holding your compliance history hostage is not one you should have trusted with it." },
  ] },
  { n: "05", id: "trust", k: "Data, security and trust", qs: [
    // Omitted (decision): "In the European Union, in Ireland." Hosting is Frankfurt (D-02).
    // Omitted (no source): "The current list of sub-processors is published in our data processing agreement, and we
    // give thirty days' notice before adding or replacing one." The DPA is a draft pending counsel (D-20).
    { slug: "where-is-my-data-held", bar: C.accent, q: "Where is my data held?",
      a: "We do not move it outside the European Economic Area for hosting or for backup." },
    // Omitted (no source): "Your material is never used to train models for the benefit of other customers, and our
    // model providers are engaged on terms that prohibit training on what we send them."
    { slug: "do-you-train-models-on-my-recipes", bar: C.clear, q: "Do you train models on my recipes?",
      a: "No.",
      more: "Your formulations are the most commercially sensitive thing in the product. Treating them as training data would be indefensible." },
    // Omitted (no source): "Our own people access workspace content only if you ask us to, and that access is recorded."
    { slug: "who-can-see-my-recipes", bar: C.clear, q: "Who can see my recipes?",
      a: "The people you admit, at the scope you give them. Each customer's data is separated from every other in the database itself, by row-level policies, rather than by application code — so a defect in the application cannot expose one customer to another." },
    { slug: "can-the-record-be-altered", bar: C.accent, q: "Can the record be altered?",
      a: "No, and that includes by us. Checks, findings and certificates are written to a store that accepts inserts only; update and delete are revoked from every application role and rejected at the database level.",
      more: "That is deliberate. A record the application could rewrite would not be a record, and a certificate resting on it would be a claim." },
    // Omitted whole: "Do you support single sign-on?" (after launch: "Yes, on Advanced" — SSO, A09, comes after launch per
    // docs/00-product.md and D-27).
    { slug: "what-if-a-recipient-wants-to-verify-a-report", bar: C.none, q: "What if a recipient wants to verify a report I sent them?",
      a: "There is a public verification page. They enter the reference on the document and get back whether it is current, superseded or unknown, its issue date, its ruleset version, and whether it contained items we did not assess.",
      more: "It never returns your composition, your findings or anything else about your business, and it needs no account." },
  ] },
];

/**
 * Text the design draws that the FAQ omits (above), for the test that none of it appears on the page. Each is a
 * distinctive part of an omitted sentence.
 */
export const OMITTED_FAQ = [
  "How compliant is the software with EU, UK and US regulation?",
  "We hold and check the feed and pet food rules",
  "including every state",
  "Not because coverage is thin",
  "So how do the three regimes actually differ?",
  "twenty-seven national layers",
  "Northern Ireland",
  "None of those is a flat list",
  "feed law is a different rulebook",
  "PARNUT",
  "There are good horizontal tools",
  "the whole basis of feed law",
  "We watch every source continuously",
  "Federal Register",
  "AAFCO",
  "Commission proposals",
  "sell-through deadline",
  "Why can I not buy a single country?",
  "Texas",
  "the EU means all twenty-seven",
  "How long does a check take?",
  "Minutes for a normal pack",
  "Who can sign a certificate?",
  "eIDAS",
  "signing authority",
  "in Ireland",
  "thirty days' notice",
  "our model providers are engaged on terms",
  "Our own people access workspace content",
  "Do you support single sign-on?",
  "Yes, on Advanced",
];
