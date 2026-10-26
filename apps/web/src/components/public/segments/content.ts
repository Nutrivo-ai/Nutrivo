// The five segment pages (S-SEG-001…005), ported from design/public/Nutrivo Segment Pages.dc.html: its `SEG` data, per
// segment, verbatim. T-603 rules (plan on issue #60, D-19, CLAUDE.md 7): nothing is rewritten, and these are omitted
// whole, each marked where it was with `// omitted:`:
//   - figures or facts about Nutrivo's coverage, pricing or speed that no source backs (docs/08 and config/pricing.ts are
//     the sources for prices);
//   - regulatory statements: what a law, authority or market requires, and the example panels that show permitted
//     wordings, levels or registrations (no person has accepted them as content);
//   - invented example data the public site may not show (INVENTED in tests/e2e/support/public.ts).
import { CONTACT, PUBLIC_ROUTES, SEGMENTS, START } from "@/lib/public/links";
import { amount, euros, PARTNER } from "@/lib/public/pricing";

export type SegmentKey = (typeof SEGMENTS)[number]["key"];
export type Glyph = "clear" | "action" | "none";
export type Tone = "clear" | "action" | "none" | "blocked" | "accent" | "ink";

export type Cta = { label: string; href: string };

export type Segment = {
  key: SegmentKey;
  slug: string;
  tab: string;
  n: string;
  kicker: string;
  headline: string;
  sub: string;
  cta: Cta;
  cta2: Cta;
  ctaNote?: string;
  heroCard: { kicker: string; title: string; body: string; tone: Tone; bg: string };
  problemTitle: string;
  problems: { k: string; v?: string; bar: Tone }[];
  flowKicker: string;
  flowTitle: string;
  flowNote: string;
  flow: { n: string; k: string; v: string; meta?: string }[];
  proofKicker: string;
  proofTitle: string;
  proofBody?: string;
  proofRows: { v: string; glyph: Glyph }[];
  panel?: { kicker: string; title: string; rows: { k: string; v: string; tone: Tone }[]; foot?: string };
  closeTitle: string;
  closeBody: string;
  nevers: string[];
  neverFoot?: string;
};

/** In-page anchors the secondary calls to action point at. */
export const ANCHOR = { flow: "how-it-works", proof: "the-detail", panel: "also-true" } as const;

const SEE_COVERAGE: Cta = { label: "See what we cover", href: PUBLIC_ROUTES.coverage };
export { SEE_COVERAGE };

const slug = (key: SegmentKey) => SEGMENTS.find((s) => s.key === key)!.slug;

export const SEGMENT_CONTENT: Segment[] = [
  {
    key: "npd",
    slug: slug("npd"),
    tab: "New product development", n: "01",
    kicker: "For product developers",
    headline: "Find the constraints before you commit to the recipe",
    sub: "A brief is not a label, so we do not pretend to judge one. Tell us the species, the claim you want to make and the markets you have in mind, and you get an envelope back: what is permitted, what the ceilings are, and which wording is allowed in each language you will print.",
    // "Start a brief": briefs are a later milestone, so it starts the free allowance like every other start (issue #60, Q10).
    cta: { label: "Start a brief", href: START },
    cta2: { label: "See a design envelope", href: `#${ANCHOR.flow}` },
    ctaNote: "NO ARTWORK NEEDED · NO CARD · THREE LABELS FREE",
    heroCard: { kicker: "The distinction", title: "An envelope, not a verdict", body: "There is nothing to check yet. A verdict on an unfinished product would be a guess dressed up as an answer, so we give you the boundaries you have to design inside instead.", tone: "accent", bg: "var(--accent-100)" },
    problemTitle: "The compliance question arrives too late to be cheap",
    problems: [
      { k: "The claim was in the brief", v: "Marketing wrote it, the recipe was built around it, and nobody asked whether it is permitted in French until the artwork came back from the agency.", bar: "action" },
      { k: "The ceiling was found by failing it", v: "An inclusion level is only obviously too high once somebody checks it against the market you are launching in, and by then the trials are done.", bar: "blocked" },
      { k: "The answer came as a PDF opinion", v: "Six weeks, a consultant's day rate, and a document that answers the question you asked in June about the recipe you had in June.", bar: "none" },
    ],
    flowKicker: "How a brief works", flowTitle: "Partial input in, a design envelope out", flowNote: "Every field is optional except the species and one market. The envelope gets tighter as you fill more in, and it says which parts are still open.",
    flow: [
      { n: "01", k: "Say what you know", v: "Species, life stage, the product class you have in mind, target markets, and the claims you want to make.", meta: "PARTIAL INPUT ACCEPTED" },
      { n: "02", k: "Get the ceilings", v: "Permitted inclusion levels per ingredient and additive, per market, with the authorisation cited.", meta: "AS A SHEET R&D CAN WORK AGAINST" },
      { n: "03", k: "Get the wording", v: "The approved phrasing for your claim in every language you will print, or a plain statement that there is none.", meta: "LOOKED UP, NEVER TRANSLATED" },
      { n: "04", k: "Get the feasibility", v: "Which of your target markets this product can be sold in at all, and what each one would require.", meta: "INCLUDING WHAT TO REGISTER" },
    ],
    proofKicker: "The part nobody else does", proofTitle: "A claim is checked in the language it will be printed in",
    // omitted: "Checking your English copy … so we hold the permitted wording per market and per language …" (held coverage).
    proofBody: "A prescribed legal term is a lookup, not a translation.",
    // omitted: the three example rows (German approved wording, French prohibition "with the article", Italian wording):
    // statements of what markets permit.
    proofRows: [],
    // omitted: the "Example envelope" panel (glucosamine ceiling, permitted and prohibited claims, markets feasible).
    closeTitle: "Design against the constraints, not around a rejection",
    closeBody: "Start with a brief today and keep the same record all the way to the printed label. The brief becomes the product, the product keeps its history, and the first label check runs against the same object you started with.",
    nevers: ["Give a verdict on a product that does not exist yet", "Translate a prescribed legal term", "Guarantee a formulation will be authorised", "Submit anything to an authority", "Confirm a registration is valid"],
    neverFoot: "An envelope tells you where the walls are. It does not tell you the room is approved.",
  },
  {
    key: "pm",
    slug: slug("pm"),
    tab: "Product & range management", n: "02",
    kicker: "For product and range managers",
    headline: "Every recipe, every market, one screen, and no green wall",
    sub: "One row per recipe, one column per market, and four states in each cell. The cell also carries the ruleset version it was judged against, so a stale answer cannot pass itself off as a current one in a slide.",
    cta: { label: "Check a label free", href: START },
    cta2: { label: "See the board", href: `#${ANCHOR.flow}` },
    ctaNote: "THREE LABELS FREE · NO CARD · NO SALES CALL",
    heroCard: { kicker: "The number that matters", title: "Not assessed is shown as prominently as clear", body: "A board where everything is green is either much better than it looks or hiding something. The count of things nobody has checked is on the screen at the same size as the count of things that passed.", tone: "none", bg: "var(--none-bg)" },
    problemTitle: "The portfolio view is a spreadsheet somebody maintains by hand",
    problems: [
      { k: "It is out of date the day it is circulated", v: "Compiled from emails, a consultant's last report and whatever regulatory remembers. Nothing in it says when each cell was last true.", bar: "action" },
      { k: "It cannot tell you what changed", v: "A rule moved in France last month. Finding out which of your forty recipes it touches is a person reading forty reports.", bar: "blocked" },
      { k: "It has two states, not four", v: "Compliant or not. Nothing distinguishes a product that passed from one nobody has looked at, which is the distinction that gets people fired.", bar: "none" },
    ],
    flowKicker: "How the board works", flowTitle: "One cell per recipe and market, and the cell knows its own age", flowNote: "Markets group under their region, so a parent never conceals a failing child. Re-checks are never metered, so the board stays current instead of being current on the day it was built.",
    flow: [
      { n: "01", k: "Four states per cell", v: "Clear, action needed, not assessed, blocked. Each with its own mark, so the board reads without colour.", meta: "NEVER A SCORE OR A PERCENTAGE" },
      { n: "02", k: "Freshness travels with it", v: "The ruleset version each cell was judged against, and whether the rules have moved since.", meta: "STALE IS VISIBLE, NOT SILENT" },
      { n: "03", k: "Open actions counted", v: "How many findings sit behind each cell, and which single action unblocks the most markets.", meta: "SORTABLE BY MARKETS UNBLOCKED" },
      { n: "04", k: "Exports that cannot lie", v: "The matrix as a sheet, with freshness and not-assessed rows included by default.", meta: "SCHEDULABLE MONTHLY" },
    ],
    proofKicker: "The one that costs money", proofTitle: "A label can be perfect and the product still unsellable",
    // omitted: "An unregistered market never renders as Clear, because a compliant panel and a missing state filing produce
    // the same commercial outcome: you cannot sell it." (what a market requires).
    proofBody: "Registration is its own state on the market, not a footnote on the label.",
    // omitted: the three rows: Texas's commercial feed registration (a market requirement); "We name the authority, the
    // route, the evidence list, the fee and the deadline" (held coverage); "Only the operator named on the label can"
    // file (a requirement).
    proofRows: [],
    // omitted: the "Example cell" panel (Texas registration, "RULESET 2026.08-b").
    closeTitle: "Know where the whole range stands, and when you last knew it",
    // omitted: "Add one recipe and one artwork file and the first cell is filled in four minutes." (unbacked figure).
    closeBody: "Add the rest of the range and the board is the thing you take into the meeting instead of a spreadsheet somebody has to defend.",
    nevers: ["Give you a compliance score or a percentage", "Show a stale cell as current", "Meter your checks or re-checks", "Submit a registration on your behalf", "Guarantee acceptance by an authority"],
    // omitted: "There is no number that honestly summarises four states across 27 markets, …" (a count of markets).
  },
  {
    key: "consultant",
    slug: slug("consultant"),
    tab: "Consultants & agencies", n: "03",
    kicker: "For consultancies and regulatory agencies",
    headline: "Your judgement is the product. The measuring is ours.",
    sub: "You hold twelve clients' portfolios, not one. Each stays separate — separate recipes, separate history, separate reports, and a different operator named on every label. Your client reads their own workspace for nothing.",
    // "See Partner" names the Partner tier, which the pricing page shows; "Talk to us" is the design's contact address.
    cta: { label: "See Partner", href: PUBLIC_ROUTES.pricing },
    cta2: { label: "Talk to us", href: CONTACT },
    // Partner's €1,499 per 10 client workspaces, net of VAT: docs/08-billing.md.
    // Partner comes after launch (docs/08, review on PR #142).
    ctaNote: `${euros(PARTNER.monthly)}/MO FOR TEN CLIENT WORKSPACES · EXCL. VAT · AFTER LAUNCH`,
    heroCard: { kicker: "What we will not sell", title: "We do not do your job", body: "Representing an applicant, the borderline classification call, signing off a launch, arguing with an authority. Not sold at any price by us, and frequently the whole engagement for you.", tone: "clear", bg: "var(--clear-bg)" },
    problemTitle: "The billable work is judgement, and the hours go on measuring",
    problems: [
      { k: "Reading artwork by hand", v: "Character heights with a loupe, panel by panel, language by language, for a client who will send revised artwork on Thursday.", bar: "action" },
      { k: "Twelve clients, twelve methods", v: "A folder structure per client, a spreadsheet per client, and no way to answer what changed across all of them this month.", bar: "blocked" },
      { k: "Priced as one large brand", v: "Every platform assumes one portfolio. Twelve separate subscriptions is absurd, and one shared workspace mixes clients who must never be mixed.", bar: "none" },
    ],
    flowKicker: "How Partner works", flowTitle: "One subscription, ten client workspaces, held apart by the schema", flowNote: "Not by discipline, not by folder naming. No export, report or certificate can contain two clients' data, and a client's people can never see another client's workspace exists.",
    flow: [
      // omitted: meta "TEN INCLUDED · €129/MO EACH BEYOND" (the per-client price is in neither docs/08 nor config).
      { n: "01", k: "A workspace per client", v: "Their recipes, their markets, their operator entered once for their whole range." },
      { n: "02", k: "Your firm, unlimited", v: "Every colleague edits across every client. A consultancy is people, not seats, so people are free.", meta: "NO SEAT COUNT" },
      { n: "03", k: "One roll-up", v: "Where your week goes: which clients have a blocked market, which rule change reaches whose recipes.", meta: "COUNTS ACROSS · NEVER CONTENTS" },
      { n: "04", k: "Your name on the record", v: "Every check names the person and the firm who ran it, permanently, in the client's own history.", meta: "THE RECORD THEY PAY YOU FOR" },
    ],
    proofKicker: "The arithmetic", proofTitle: "Twelve clients on Standard is the wrong shape and the wrong number",
    // Twelve Standard subscriptions at the config/pricing.ts price (€5,988 in the design).
    proofBody: `Twelve separate subscriptions is ${euros(12 * amount("standard", "month"))} a month and twelve logins nobody wants to hold. One large workspace breaks the thing that matters most, because each client's products, findings and reports have to stay unmixable and each has a different operator on the label.`,
    proofRows: [
      // omitted: "Partner at twelve clients is €1,757 a month, …" (needs the per-client price no source holds).
      { v: "Your client reads their own workspace free, which is how a twelve-client firm becomes our best distribution.", glyph: "clear" },
      // omitted: "Above twenty-five clients we quote, …" (not in docs/08 or config).
    ],
    panel: {
      kicker: "Twelve clients", title: "Standard against Partner",
      rows: [
        // omitted: "Monthly cost  €5,988 → €1,757" (the Partner figure has no source).
        { k: "Subscriptions held", v: "12 → 1", tone: "clear" },
        { k: "Clients kept separate", v: "BY THE SCHEMA", tone: "clear" },
        { k: "Operator per client", v: "ONE EACH", tone: "clear" },
        { k: "Client reads their own", v: "FREE", tone: "clear" },
      ],
      foot: "The saving is not the argument. Separation you can point at in a contract is the argument, and the price is what makes it obvious.",
    },
    closeTitle: "Keep the advisory work. Hand us the measuring.",
    closeBody: "We replace the mechanical part you do slowly today because nobody has given you tooling: reading artwork, measuring character heights, naming registration obligations per market. The judgement was always yours and it stays yours.",
    nevers: ["Represent your client to an authority", "Make the borderline classification call for you", "Sign off a launch", "Sell general advisory retainers against you", "Mix two clients in one document"],
    neverFoot: "Our own services stay narrow on purpose — registration prep, market encoding and translation review — so we do not compete with our channel.",
  },
  {
    key: "cm",
    slug: slug("cm"),
    tab: "Contract manufacturers", n: "04",
    kicker: "For contract manufacturers and co-packers",
    headline: "You are not a seat, and you should never be asked to buy one",
    sub: "You make somebody else's product. When their compliance record needs a specification from you, you get a link, upload the one document, and you are done. No account, no login, no cost, and no visibility into anything but the request.",
    cta: { label: "See how a request works", href: `#${ANCHOR.flow}` },
    cta2: { label: "For your own brands", href: `#${ANCHOR.panel}` },
    ctaNote: "NO ACCOUNT · UPLOAD ONCE · NEVER A SEAT",
    heroCard: { kicker: "Why this matters", title: "Charging for supplier logins is how tools become shared passwords", body: "If a brand has to pay for your access, they will send you a spreadsheet instead — and their compliance record will be a folder of emails nobody can audit.", tone: "action", bg: "var(--action-bg)" },
    problemTitle: "The specification request arrives as an email chain",
    problems: [
      { k: "Nobody knows which version you sent", v: "Three revisions of the same premix specification, two inboxes, and a client asking whether the one on file is current.", bar: "action" },
      { k: "It expires and nobody notices", v: "The document you sent in March lapses in October. The first anyone hears of it is when a registration filing needs evidence.", bar: "blocked" },
      { k: "You are asked to create an account", v: "For one PDF. So you do not, and the brand copies the file into a folder where its provenance is lost.", bar: "none" },
    ],
    flowKicker: "How a request works", flowTitle: "A link, one document, and a record of what you sent",
    flowNote: "The link is scoped to the one request. It expires, it shows you nothing about the brand's portfolio, and using it does not create an account or a relationship you have to manage.",
    flow: [
      { n: "01", k: "You get a link", v: "Naming the brand, the material, and exactly which document is being asked for and why.", meta: "NO LOGIN · NO PASSWORD" },
      { n: "02", k: "You upload once", v: "The current version. It lands against the material, with the date and your name on it.", meta: "ONE FILE, ONE ACTION" },
      { n: "03", k: "It is dated and tracked", v: "The brand is warned before it expires, sixty, thirty and seven days out, and asks you again then.", meta: "YOU ARE NOT CHASED DAILY" },
    ],
    proofKicker: "What is in it for you", proofTitle: "Fewer requests, and the ones you get are specific",
    proofBody: "A brand with a real document pack asks you once for the right thing, rather than four times because nobody could find what you already sent. When it expires you get one clear request instead of an urgent call the week a filing is due.",
    proofRows: [
      { v: "The request names the material, the recipe and the market it is evidence for.", glyph: "clear" },
      { v: "What you sent stays attached to the material, with its date, so nobody asks again by mistake.", glyph: "clear" },
      { v: "You see nothing else. Not the portfolio, not the findings, not the other suppliers.", glyph: "none" },
    ],
    panel: {
      kicker: "Also true", title: "If you make your own brands too",
      rows: [
        { k: "Your own recipes", v: "YOUR WORKSPACE", tone: "ink" },
        { k: "Clients' recipes", v: "STAY THEIRS", tone: "ink" },
        { k: "Held apart", v: "BY THE SCHEMA", tone: "clear" },
        { k: "Operator on the label", v: "ONE PER BRAND", tone: "ink" },
        { k: "Starting cost", v: "THREE LABELS FREE", tone: "clear" },
      ],
      foot: "Plenty of co-packers own labels of their own. Those are a normal workspace, entirely separate from the documents you upload for other people.",
    },
    closeTitle: "Answer the request in one action and go back to work",
    // omitted: "If a customer has sent you a link, open it and you are three minutes from done." (unbacked figure).
    closeBody: "If you own brands as well, the product is the same one they are using, and your first three labels are free with no card.",
    nevers: ["Charge a brand for your access", "Ask you to create an account for one file", "Show you anything outside the request", "Share what you upload with another customer", "Chase you daily as a date approaches"],
    neverFoot: "A supplier is not a seat. That is a pricing rule, not a courtesy, and it is why the link exists at all.",
  },
  {
    key: "retailer",
    slug: slug("retailer"),
    tab: "Retailers & buyers", n: "05",
    kicker: "For retailers, buyers and procurement",
    headline: "Confirm what a supplier sent you, without taking their word for it",
    sub: "A compliance report you were emailed is a claim until you can check it. Every report we generate has a reference you can verify without an account: whether it is still current, what ruleset it was judged against, and whether anything was left unchecked.",
    cta: { label: "Verify a report", href: START },
    cta2: { label: "See what a report contains", href: `#${ANCHOR.proof}` },
    ctaNote: "NO ACCOUNT NEEDED · ONE REFERENCE · FREE",
    heroCard: { kicker: "The honest part", title: "It tells you what was not checked", body: "The verification page says whether the report contained not-assessed items. A report with none is rare, and a supplier claiming none is worth a question.", tone: "none", bg: "var(--none-bg)" },
    problemTitle: "You are asked to trust a PDF you cannot interrogate",
    problems: [
      { k: "It has no date you can rely on", v: "A report from March may have been correct in March. Nothing on the face of most documents tells you whether the rules have moved since.", bar: "action" },
      { k: "It says compliant and stops", v: "Compliant against what, in which market, in which language, and which parts did nobody look at? A single word is not an answer to four questions.", bar: "blocked" },
      // omitted: "A German panel checked against German rules tells you very little about the product you are listing in
      // Northern Ireland." (a statement of how two markets' rules differ).
      { k: "It may not cover the market you sell in", bar: "none" },
    ],
    flowKicker: "How verification works", flowTitle: "A reference, and four facts back",
    flowNote: "No account, no table access, and no composition. The page tells you the status of the document you are holding and nothing about the supplier's other products.",
    flow: [
      { n: "01", k: "Enter the reference", v: "It is printed on the report. Nothing else is required and nothing is recorded about you.", meta: "UNGUESSABLE BY DESIGN" },
      { n: "02", k: "Get the status", v: "Current, superseded, or unknown. A ruleset change that materially affects it supersedes it.", meta: "NEVER SILENTLY RE-SCORED" },
      { n: "03", k: "See the boundaries", v: "The issue date, the ruleset version it was judged against, and whether not-assessed items existed.", meta: "COUNTS ONLY, NOT FINDINGS" },
      { n: "04", k: "Ask the right question", v: "You now know what to ask the supplier, and whether the answer you were given was complete.", meta: "THE POINT OF THE EXERCISE" },
    ],
    proofKicker: "What you will not get", proofTitle: "We show you the status, never the supplier's findings",
    proofBody: "The verification page is not a back door into somebody else's compliance record. It confirms the document you were handed, and it stops there — which is exactly why suppliers are willing to send you a verifiable report in the first place.",
    proofRows: [
      { v: "You see: current or superseded, the issue date, the ruleset version, whether anything was unchecked.", glyph: "clear" },
      { v: "You do not see: the composition, the findings, the other markets, or anything about other products.", glyph: "none" },
      { v: "A superseded report is answered as superseded, not as invalid. It was true when it was issued.", glyph: "action" },
    ],
    // omitted: the "Example verification" panel, as on the landing page (issue #60): an invented reference, issue date
    // "4 SEP 2026", ruleset "2026.08-b" and counts, and its foot note about them.
    closeTitle: "Ask your suppliers for a report you can verify",
    closeBody: "Any brand on a paid plan can send one, and the reference is on every document. If a supplier cannot produce one, that is itself an answer about how their compliance record is kept.",
    nevers: ["Show you a supplier's composition or findings", "Confirm that a registration is valid", "Guarantee a product will be accepted", "Record who verified a reference", "Answer a report as invalid when it is merely superseded"],
    neverFoot: "A report states on its face that it was generated automatically and attested by nobody. That is a boundary, not a disclaimer.",
  },
];

export const segmentBySlug = (s: string) => SEGMENT_CONTENT.find((seg) => seg.slug === s);
