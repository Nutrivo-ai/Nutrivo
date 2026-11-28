# 25 · Roadmap after launch

The backlog the design direction of 19 Nov 2026 adds after gate G9 (D-33 to D-38). It is the founders' plan, not yet
work: nothing here is in plan/tasks.yaml, and no session builds from this page. A release's tasks move into
plan/tasks.yaml when the founders open its milestone, with GitHub milestones and `ms:` labels for M12 onwards created
first (T-004), and every task gets its workflow spec in docs/workflows/ before it is built.

Before launch, only the existing screens are redesigned to the direction: T-1108 (Home as Today), T-1113 (Board as
the product matrix), T-1114 (Label report as Fix mode), T-1115 (Check in progress) and T-1116 (public site and
verify). New screens enter spec/screens.yaml only after G9, so the launch criteria in docs/21 do not grow.

## Rules every item keeps (D-33)

- "Label clear", never a bare "Clear"; registration is shown separately and Unknown never reads clear.
- Wording is copied or inserted only from accepted term register entries (D-31), never written by a model.
- A model may summarise and explain; every state comes from a rule finding, no rule means Not assessed, and each
  model feature ships only after its eval set passes.
- Counts of open items, never a score, grade or percentage.
- Real engine output on demo data only, in every demo and on the website.

## 1.1 · Interface in German, French and Spanish (D-38)

| Item | What | Depends on |
|---|---|---|
| i18n | Strings extracted from the app, emails, report PDF chrome and public site; a language setting per person | G9 |
| Translations | German, French and Spanish, reviewed by a native speaker; legal texts by counsel | i18n |

## 1.5 · UK, Today, Ask, free tools (Q1 2027)

| Item | What | Depends on |
|---|---|---|
| Today briefing | Two sentences written from the open items only, never mentioning an item not in the list; time estimates labelled as estimates, from a stated source | T-1108, an eval set |
| Ask Nutrivo | A question box on every screen; answer first, then a state chip per cited rule, then actions; a question with no accepted rule answers Not assessed with the reason | a 50-question eval set |
| Fix mode evidence panel | Rule text beside label text with the mismatch marked; Assign and Send to expert | T-1114, D-35 |
| Free tools | "Can I say this?" (daily limit per IP), EU label requirements per country, from accepted rules only, with source and last-verified date | G6 |
| Plan configurator | Markets, recipes and add-ons to a monthly price from config/pricing.ts | D-34 |
| Nutrivo Expert: review | Send a report to the expert; staff queue; sign-off with name and date on the report and on /verify | D-35 accepted |
| MCP server, read-only | Products, market state, findings, rule lookup; per-workspace tokens, rate limits, audit log, security review | D-36 |
| UK | GB and NI as separate regimes, plus EEA and CH | accepted UK rules |

## 2.0 · US pet food (Q2 2027)

| Item | What | Depends on |
|---|---|---|
| US layer | A federal pack with state variances as separate packs that can be retired if the PURR Act passes, keeping registration duties | US rules, D-22 |
| Registrations | Map and table by market and state: status, renewal, fee; pre-filled packs | US layer |
| Nutrivo Expert: filing | Filing only on a stored customer instruction, after mandates and insurance | D-35 |
| Illustrator plugin | Two-week spike, then the build; inserts accepted terms only | D-36 tokens, D-37 |
| Brand trust page | Opt-in public page of a workspace's current verified reports; superseded shown as superseded | /verify |

## Later

Retailer requirement packs ("12 of 15 met", never a percentage, never changing a legal finding) · webshop claim scan
of URLs the customer submits · CoA against specification for supplier documents · barcode and photo lookup on
/verify · Insights and the rule-change radar timeline · the aggregated, opt-in market benchmark · food from Q3 2027
(docs: "Adding food").
