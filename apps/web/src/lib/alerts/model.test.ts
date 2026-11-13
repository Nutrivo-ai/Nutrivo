import { describe, expect, it } from "vitest";
import {
  age,
  buildCards,
  buildHorizon,
  cardSentence,
  effectiveLabel,
  inbox,
  parseFilter,
  type AlertRow,
  type InboxInput,
} from "./model";

const WS = "11111111-1111-4111-8111-111111111111";
const TODAY = "2026-11-13";
const P1 = "aaaaaaaa-0000-4000-8000-000000000001";
const P2 = "aaaaaaaa-0000-4000-8000-000000000002";
const P3 = "aaaaaaaa-0000-4000-8000-000000000003";
const D_FR = "dddddddd-0000-4000-8000-000000000001";
const D_ETHOX = "dddddddd-0000-4000-8000-000000000002";
const D_US = "dddddddd-0000-4000-8000-000000000003";

let n = 0;
function alert(over: Partial<AlertRow>): AlertRow {
  n += 1;
  return {
    id: `eeeeeeee-0000-4000-8000-${String(n).padStart(12, "0")}`,
    rule_diff_id: D_FR,
    product_id: P1,
    node_id: "EU-FR",
    phase: "coming",
    effect_type: "prescribed_wording",
    effective_from: "2027-01-01",
    sell_through_until: null,
    created_at: "2026-11-08T07:23:00Z",
    ...over,
  };
}

function input(alerts: AlertRow[], over: Partial<InboxInput> = {}): InboxInput {
  return {
    workspaceId: WS,
    today: TODAY,
    entitledRegions: ["EU"],
    alerts,
    readIds: new Set(),
    diffs: [
      { id: D_FR, rule_key: "e2e.fr.wording", to_version: 2 },
      { id: D_ETHOX, rule_key: "e2e.eu.ethox", to_version: 1 },
      { id: D_US, rule_key: "e2e.us.fee", to_version: 1 },
    ],
    rules: [
      { rule_key: "e2e.fr.wording", title: "Prescribed wording for complete feed changes in France" },
      { rule_key: "e2e.eu.ethox", title: "Ethoxyquin authorisation withdrawn for all species" },
      { rule_key: "e2e.us.fee", title: "Texas registration form changed" },
    ],
    citations: [
      { rule_key: "e2e.fr.wording", version: 1, article_ref: "Old ref" },
      { rule_key: "e2e.fr.wording", version: 2, article_ref: "JORF · Arrêté du 12 août 2026" },
    ],
    products: [
      { id: P1, name: "Puppy complete wet", stage: "active" },
      { id: P2, name: "Adult cat wet", stage: "active" },
      { id: P3, name: "Old lamb dry", stage: "discontinued" },
    ],
    jurisdictions: [
      { id: "EU", name: "European Union", parent_id: null },
      { id: "EU-FR", name: "France", parent_id: "EU" },
      { id: "EU-DE", name: "Germany", parent_id: "EU" },
      { id: "US", name: "United States", parent_id: null },
      { id: "US-TX", name: "Texas", parent_id: "US" },
    ],
    ...over,
  };
}

describe("alerts inbox model (T-902, J04)", () => {
  it("[J04.main] groups alert rows into one card per rule change, naming each recipe once, newest first", () => {
    const rows = [
      alert({ product_id: P1, node_id: "EU-FR" }),
      alert({ product_id: P2, node_id: "EU-FR" }),
      alert({ product_id: P1, node_id: "EU-DE" }),
      alert({ rule_diff_id: D_ETHOX, effect_type: "withdrawn_authorisation", phase: "in_force", effective_from: "2026-11-12", sell_through_until: "2027-10-01", created_at: "2026-11-12T07:23:00Z" }),
    ];
    const cards = buildCards(input(rows));
    expect(cards.map((c) => c.diffId)).toEqual([D_ETHOX, D_FR]);
    const fr = cards[1];
    expect(fr.title).toBe("Prescribed wording for complete feed changes in France");
    expect(fr.citation).toBe("JORF · Arrêté du 12 août 2026"); // the diff's own version, not the older one
    expect(fr.phase).toBe("coming");
    expect(fr.severity).toBe("action");
    expect(fr.recipes.map((r) => r.name)).toEqual(["Adult cat wet", "Puppy complete wet"]);
    expect(fr.markets.map((m) => m.nodeId)).toEqual(["EU-DE", "EU-FR"]);
    expect(fr.recipes[1].href).toBe(`/w/${WS}/products/${P1}/nodes/EU-DE`);
    expect(fr.unread).toBe(true);
    expect(fr.alertIds).toHaveLength(3);
    expect(cards[0].severity).toBe("blocked");
  });

  it("[J04.main] a card is in force once the sweep has written its in_force rows, and unread again until read", () => {
    const coming = alert({ phase: "coming", effective_from: "2026-11-10" });
    const skipped = alert({ phase: "coming", effective_from: "2026-11-10", product_id: P2 });
    const inForce = alert({ phase: "in_force", effective_from: "2026-11-10", created_at: "2026-11-10T07:23:00Z" });
    const [card] = buildCards(input([coming, skipped, inForce], { readIds: new Set([coming.id]) }));
    expect(card.phase).toBe("in_force");
    // P2's coming row has no in_force row: the sweep found contract 5 no longer names it, so the card drops it.
    expect(card.recipes.map((r) => r.productId)).toEqual([P1]);
    expect(card.alertIds).toEqual([inForce.id]);
    expect(card.unread).toBe(true);
    const [read] = buildCards(input([coming, inForce], { readIds: new Set([inForce.id]) }));
    expect(read.unread).toBe(false);
    expect(read.unreadIds).toEqual([]);
  });

  it("[J04.must.1] an alert for a region outside the plan names its recipes but cannot open the finding (BE-39)", () => {
    const rows = [alert({ rule_diff_id: D_US, node_id: "US-TX", effect_type: "new_obligation", phase: "in_force", effective_from: "2026-09-01" })];
    const [card] = buildCards(input(rows, { entitledRegions: ["EU"] }));
    expect(card.recipes).toEqual([{ productId: P1, name: "Puppy complete wet", href: null }]);
    expect(card.outsidePlan).toEqual(["United States"]);
    const [held] = buildCards(input(rows, { entitledRegions: ["EU", "US"] }));
    expect(held.recipes[0].href).toBe(`/w/${WS}/products/${P1}/nodes/US-TX`);
    expect(held.outsidePlan).toEqual([]);
  });

  it("a discontinued recipe is not named, and a change left with no recipe has no card", () => {
    expect(buildCards(input([alert({ product_id: P3 })]))).toEqual([]);
    const [card] = buildCards(input([alert({ product_id: P3 }), alert({ product_id: P1 })]));
    expect(card.recipes.map((r) => r.productId)).toEqual([P1]);
  });

  it("filters by phase and by one change, while the counts cover every card", () => {
    const rows = [
      alert({}),
      alert({ rule_diff_id: D_ETHOX, phase: "in_force", effect_type: "withdrawn_authorisation", effective_from: null }),
    ];
    const cards = buildCards(input(rows));
    expect(inbox(cards, "coming").cards.map((c) => c.diffId)).toEqual([D_FR]);
    expect(inbox(cards, "in_force").cards.map((c) => c.diffId)).toEqual([D_ETHOX]);
    const one = inbox(cards, "all", D_ETHOX);
    expect(one.cards).toHaveLength(1);
    expect(one.total).toBe(2);
    expect(one.unread).toBe(2);
    expect(one.unreadIds).toHaveLength(2);
    expect(inbox(cards, "all", "dddddddd-0000-4000-8000-00000000ffff").diff).toBeNull();
    expect(parseFilter("coming")).toBe("coming");
    expect(parseFilter(["in_force"])).toBe("in_force");
    expect(parseFilter("draft")).toBe("all");
  });

  it("writes dates and ages as the design does, and composes its sentence only from the stored type and dates", () => {
    expect(age("2026-11-11T09:00:00Z", TODAY)).toBe("2 DAYS AGO");
    expect(age("2026-11-06T09:00:00Z", TODAY)).toBe("1 WEEK AGO");
    expect(age("2026-10-23T09:00:00Z", TODAY)).toBe("3 WEEKS AGO");
    expect(age("2026-11-13T01:00:00Z", TODAY)).toBe("TODAY");
    expect(effectiveLabel({ phase: "coming", effectiveFrom: "2027-01-01" }, TODAY)).toEqual({ text: "IN FORCE 1 JAN 2027", tone: "severity" });
    expect(effectiveLabel({ phase: "in_force", effectiveFrom: "2026-11-12" }, TODAY).text).toBe("APPLIES NOW");
    expect(effectiveLabel({ phase: "in_force", effectiveFrom: "2026-09-01" }, TODAY)).toEqual({ text: "APPLIED 1 SEP 2026", tone: "neutral" });
    expect(cardSentence({ phase: "coming", effectType: "prescribed_wording", effectiveFrom: "2027-01-01", sellThroughUntil: null }, TODAY)).toBe(
      "A changed prescribed wording applies from 1 January 2027, so there is time. The latest check of each recipe named here used this rule.",
    );
    expect(
      cardSentence({ phase: "coming", effectType: "withdrawn_authorisation", effectiveFrom: "2027-04-01", sellThroughUntil: "2027-10-01" }, TODAY),
    ).toContain("placing on the market ends 1 April 2027, with sell-through to 1 October 2027.");
  });
});

describe("horizon model (T-902, J04, S-MIS-002)", () => {
  const rows = [
    alert({ rule_diff_id: D_ETHOX, effect_type: "withdrawn_authorisation", effective_from: "2027-04-01", sell_through_until: "2027-10-01", product_id: P1 }),
    alert({ rule_diff_id: D_ETHOX, effect_type: "withdrawn_authorisation", effective_from: "2027-04-01", sell_through_until: "2027-10-01", product_id: P2 }),
    alert({}),
  ];
  const items = [
    { id: "h1", title: "EU · analytical constituent tolerance bands under revision", stage: "draft", expected_date: null, effective_from: null, celex: null },
    { id: "h2", title: "US · label modernisation on a committee agenda", stage: "proposal", expected_date: "2028-01-15", effective_from: null, celex: null },
    { id: "h3", title: "Already in force", stage: "in_force", expected_date: null, effective_from: "2026-01-01", celex: null },
  ];

  it("[J04.main] lists everything coming in date order, with the recipes against each change and a sell-through row", () => {
    const h = buildHorizon(WS, buildCards(input(rows)), items, TODAY);
    expect(h.entries.map((e) => e.date)).toEqual(["1 JAN 2027", "1 APR 2027", "1 OCT 2027", "JAN 2028", "NO DATE"]);
    const ethox = h.entries[1];
    expect(ethox.impact).toEqual({ count: 2, label: "recipes to reformulate" });
    expect(ethox.tone).toBe("blocked");
    expect(ethox.href).toBe(`/w/${WS}/alerts?diff=${D_ETHOX}`);
    expect(h.entries[0].title).toBe("France · Prescribed wording for complete feed changes in France");
    expect(h.entries[0].href).toBe(`/w/${WS}/products/${P1}/nodes/EU-FR`);
    expect(h.entries[2].title).toContain("sell-through of existing stock ends");
  });

  it("[J04.main] a draft or proposal carries no countdown and no recipes until it is linked (BE-37, #73 gap 1)", () => {
    const h = buildHorizon(WS, [], items, TODAY);
    expect(h.entries.map((e) => [e.stage, e.date, e.impact])).toEqual([
      ["PROPOSAL", "JAN 2028", null],
      ["DRAFT", "NO DATE", null],
    ]);
    expect(h.deadline).toBeNull();
    expect(h.deadlines).toBe(0);
  });

  it("[J04.main] leads with the nearest withdrawn authorisation and the days left to reformulate", () => {
    const h = buildHorizon(WS, buildCards(input(rows)), [], TODAY);
    expect(h.deadlines).toBe(1);
    expect(h.deadline).toMatchObject({ until: "2027-04-01", days: 139, label: "DAYS TO REFORMULATE" });
    const after = buildHorizon(WS, buildCards(input(rows, { today: "2027-05-01" })), [], "2027-05-01");
    expect(after.deadline).toMatchObject({ until: "2027-10-01", label: "DAYS OF SELL-THROUGH LEFT" });
  });
});
