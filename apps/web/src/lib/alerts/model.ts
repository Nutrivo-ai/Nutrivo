// T-902 · J04 Horizon and alerts inbox: the pure model behind S-MIS-001, S-MOB-006 and S-MIS-002. Every figure comes
// from stored rows. app.alerts (T-901) holds one row per rule diff × product × market × phase, written from contract 5
// (the latest check applied or withheld the diff's rule); the screens group them per diff. Nothing here writes or
// paraphrases regulatory text: a card's title is the rule's stored title, its citation the accepted version's stored
// article_ref, and its sentence is composed from the stored effect type and dates.

export type Phase = "coming" | "in_force";
export type EffectType = "new_obligation" | "tightened_threshold" | "withdrawn_authorisation" | "prescribed_wording";
/** The verdict glyph a card carries (design: a withdrawn authorisation is drawn Blocked, every other change Action). */
export type Severity = "blocked" | "action";
export type Filter = "all" | "in_force" | "coming";

export type AlertRow = {
  id: string;
  rule_diff_id: string;
  product_id: string;
  node_id: string;
  phase: string;
  effect_type: string;
  effective_from: string | null;
  sell_through_until: string | null;
  created_at: string;
};
export type DiffRow = { id: string; rule_key: string; to_version: number | null };
export type RuleRow = { rule_key: string; title: string };
export type CitationRow = { rule_key: string; version: number; article_ref: string };
export type ProductRow = { id: string; name: string; stage: string };
export type JurisdictionRow = { id: string; name: string; parent_id: string | null };

export type Recipe = { productId: string; name: string; /** The finding (the verdict in a market the plan holds), or null. */ href: string | null };
export type Market = { nodeId: string; name: string; regionId: string; inPlan: boolean };

export type AlertCard = {
  diffId: string;
  ruleKey: string;
  title: string;
  citation: string | null;
  phase: Phase;
  severity: Severity;
  effectType: EffectType;
  effectiveFrom: string | null;
  sellThroughUntil: string | null;
  /** The newest alert row behind the card's current phase: when it reached this person. */
  at: string;
  unread: boolean;
  /** The current-phase rows (one per product × market), which "Mark all read" records. */
  alertIds: string[];
  unreadIds: string[];
  markets: Market[];
  recipes: Recipe[];
  /** Names of the regions the card's markets sit in that the workspace's plan does not hold (J04.must.1). */
  outsidePlan: string[];
};

export const MARK_READ_BATCH = 500; // app.mark_alerts_read takes at most 500 ids (docs/04)

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return [y, m, d];
}

/** "1 January 2027". */
export function longDate(iso: string): string {
  const [y, m, d] = parts(iso);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "1 JAN 2027", as the design writes a date in mono caps. */
export function monoDate(iso: string): string {
  const [y, m, d] = parts(iso);
  return `${d} ${MONTHS[m - 1].slice(0, 3).toUpperCase()} ${y}`;
}

/** "JAN 2028": a month only, for an expected date that is not yet law. */
export function monoMonth(iso: string): string {
  const [y, m] = parts(iso);
  return `${MONTHS[m - 1].slice(0, 3).toUpperCase()} ${y}`;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD, UTC). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}

/** "2 DAYS AGO", "1 WEEK AGO", as the design's inbox writes an alert's age. */
export function age(at: string, today: string): string {
  const days = Math.max(0, daysBetween(at, today));
  if (days === 0) return "TODAY";
  if (days === 1) return "YESTERDAY";
  if (days < 7) return `${days} DAYS AGO`;
  if (days < 35) {
    const weeks = Math.floor(days / 7);
    return `${weeks} ${weeks === 1 ? "WEEK" : "WEEKS"} AGO`;
  }
  return monoDate(at);
}

/** The mobile list's day kicker: Today, Yesterday, or the date. */
export function dayLabel(at: string, today: string): string {
  const days = daysBetween(at, today);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return longDate(at);
}

export function parseFilter(raw: string | string[] | undefined): Filter {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "in_force" || v === "coming" ? v : "all";
}

const EFFECTS: EffectType[] = ["new_obligation", "tightened_threshold", "withdrawn_authorisation", "prescribed_wording"];
function effectOf(raw: string): EffectType {
  return (EFFECTS as string[]).includes(raw) ? (raw as EffectType) : "new_obligation";
}

/** The card's right-hand date: when it applies, in the card's tone or in neutral once it is history. */
export function effectiveLabel(card: Pick<AlertCard, "phase" | "effectiveFrom">, today: string): { text: string; tone: "severity" | "neutral" } {
  if (card.phase === "coming") return { text: card.effectiveFrom ? `IN FORCE ${monoDate(card.effectiveFrom)}` : "COMING", tone: "severity" };
  if (!card.effectiveFrom || daysBetween(card.effectiveFrom, today) <= 7) return { text: "APPLIES NOW", tone: "severity" };
  return { text: `APPLIED ${monoDate(card.effectiveFrom)}`, tone: "neutral" };
}

const WHAT: Record<EffectType, string> = {
  new_obligation: "A new obligation",
  tightened_threshold: "A tightened threshold",
  withdrawn_authorisation: "A withdrawn authorisation",
  prescribed_wording: "A changed prescribed wording",
};

/**
 * The card's sentence, composed only from the stored effect type and dates, plus why it names these recipes (their
 * latest check applied or withheld the rule: contract 5). It never says what the law requires.
 */
export function cardSentence(card: Pick<AlertCard, "phase" | "effectType" | "effectiveFrom" | "sellThroughUntil">, today: string): string {
  const out: string[] = [];
  const when = card.effectiveFrom ? longDate(card.effectiveFrom) : null;
  if (card.effectType === "withdrawn_authorisation") {
    out.push(
      when
        ? `${WHAT.withdrawn_authorisation}: placing on the market ${card.phase === "coming" ? "ends" : "ended"} ${when}${
            card.sellThroughUntil ? `, with sell-through to ${longDate(card.sellThroughUntil)}` : ""
          }.`
        : `${WHAT.withdrawn_authorisation}, in force now${card.sellThroughUntil ? `, with sell-through to ${longDate(card.sellThroughUntil)}` : ""}.`,
    );
    out.push("It is resolved by reformulating, not on the label.");
  } else if (card.phase === "coming") {
    out.push(when ? `${WHAT[card.effectType]} applies from ${when}${daysBetween(today, card.effectiveFrom!) > 30 ? ", so there is time" : ""}.` : `${WHAT[card.effectType]} is coming.`);
  } else {
    out.push(when ? `${WHAT[card.effectType]} has applied since ${when}.` : `${WHAT[card.effectType]} applies now.`);
  }
  out.push("The latest check of each recipe named here used this rule.");
  return out.join(" ");
}

export type InboxInput = {
  workspaceId: string;
  today: string;
  entitledRegions: string[];
  alerts: AlertRow[];
  readIds: Set<string>;
  diffs: DiffRow[];
  rules: RuleRow[];
  citations: CitationRow[];
  products: ProductRow[];
  jurisdictions: JurisdictionRow[];
};

export function verdictHref(workspaceId: string, productId: string, nodeId: string) {
  return `/w/${workspaceId}/products/${productId}/nodes/${encodeURIComponent(nodeId)}`;
}

/**
 * One card per rule diff, newest first. Each product × market contributes its current row: the in_force row once the
 * daily sweep has written it, else the coming row. So a card comes back unread when its change comes into force, and
 * the person reads it again (read state is per person and per row, BE-39). A discontinued recipe is not named; a diff
 * left with no recipe has no card (an alert names recipes or it is not sent).
 */
export function buildCards(input: InboxInput): AlertCard[] {
  const diffs = new Map(input.diffs.map((d) => [d.id, d]));
  const rules = new Map(input.rules.map((r) => [r.rule_key, r]));
  const products = new Map(input.products.map((p) => [p.id, p]));
  const places = new Map(input.jurisdictions.map((j) => [j.id, j]));
  const entitled = new Set(input.entitledRegions);

  const current = new Map<string, AlertRow>(); // diff|product|node → the row for its latest phase
  for (const a of input.alerts) {
    const p = products.get(a.product_id);
    if (!p || p.stage === "discontinued") continue;
    const key = `${a.rule_diff_id}|${a.product_id}|${a.node_id}`;
    const held = current.get(key);
    if (!held || (held.phase === "coming" && a.phase === "in_force")) current.set(key, a);
  }

  const byDiff = new Map<string, AlertRow[]>();
  for (const a of current.values()) byDiff.set(a.rule_diff_id, [...(byDiff.get(a.rule_diff_id) ?? []), a]);

  const cards: AlertCard[] = [];
  for (const [diffId, all] of byDiff) {
    // Once the sweep has written a diff's in_force rows, a product × market it skipped is no longer named by contract
    // 5 (re-checked without the rule): its coming row is history, and the card leaves it out.
    const phase: Phase = all.some((r) => r.phase === "in_force") ? "in_force" : "coming";
    const rows = all.filter((r) => r.phase === phase);
    const diff = diffs.get(diffId);
    const ruleKey = diff?.rule_key ?? "";
    const rule = rules.get(ruleKey);
    const forRule = input.citations.filter((c) => c.rule_key === ruleKey).sort((a, b) => b.version - a.version);
    const citation = (forRule.find((c) => c.version === diff?.to_version) ?? forRule[0])?.article_ref ?? null;

    const markets = new Map<string, Market>();
    for (const r of rows) {
      if (markets.has(r.node_id)) continue;
      const j = places.get(r.node_id);
      const regionId = j?.parent_id ?? r.node_id;
      markets.set(r.node_id, { nodeId: r.node_id, name: j?.name ?? r.node_id, regionId, inPlan: entitled.has(regionId) });
    }
    const recipes = new Map<string, Recipe>();
    for (const r of [...rows].sort((a, b) => (a.node_id < b.node_id ? -1 : 1))) {
      const name = products.get(r.product_id)!.name;
      const held = recipes.get(r.product_id);
      const href = markets.get(r.node_id)!.inPlan ? verdictHref(input.workspaceId, r.product_id, r.node_id) : null;
      if (!held) recipes.set(r.product_id, { productId: r.product_id, name, href });
      else if (!held.href && href) held.href = href;
    }
    const outsidePlan = [...new Set([...markets.values()].filter((m) => !m.inPlan).map((m) => m.regionId))].map(
      (id) => places.get(id)?.name ?? id,
    );

    const first = rows[0];
    const effectType = effectOf(first.effect_type);
    const unreadIds = rows.filter((r) => !input.readIds.has(r.id)).map((r) => r.id);
    cards.push({
      diffId,
      ruleKey,
      title: rule?.title ?? ruleKey,
      citation,
      phase,
      severity: effectType === "withdrawn_authorisation" ? "blocked" : "action",
      effectType,
      effectiveFrom: first.effective_from,
      sellThroughUntil: first.sell_through_until,
      at: rows.map((r) => r.created_at).sort().at(-1)!,
      unread: unreadIds.length > 0,
      alertIds: rows.map((r) => r.id),
      unreadIds,
      markets: [...markets.values()].sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1)),
      recipes: [...recipes.values()].sort((a, b) => a.name.localeCompare(b.name)),
      outsidePlan,
    });
  }
  return cards.sort((a, b) => (a.at === b.at ? (a.diffId < b.diffId ? -1 : 1) : a.at < b.at ? 1 : -1));
}

export type Inbox = {
  cards: AlertCard[];
  /** Every card, before the filter: the counts and Mark all read cover all of them. */
  total: number;
  unread: number;
  unreadIds: string[];
  filter: Filter;
  /** A diff named in the URL (Horizon's "Open the recipes"), or null. */
  diff: string | null;
};

export function inbox(cards: AlertCard[], filter: Filter, diff: string | null = null): Inbox {
  const shown = cards.filter((c) => (filter === "all" || c.phase === filter) && (!diff || c.diffId === diff));
  return {
    cards: shown,
    total: cards.length,
    unread: cards.filter((c) => c.unread).length,
    unreadIds: cards.flatMap((c) => c.unreadIds),
    filter,
    diff: diff && cards.some((c) => c.diffId === diff) ? diff : null,
  };
}

export function inboxHref(workspaceId: string, filter: Filter): string {
  return filter === "all" ? `/w/${workspaceId}/alerts` : `/w/${workspaceId}/alerts?show=${filter}`;
}

/** Where a person goes from a card: the first recipe whose finding they can open. */
export function firstFinding(cards: AlertCard[]): string | null {
  for (const c of cards) for (const r of c.recipes) if (r.href) return r.href;
  return null;
}

// ─── Horizon (S-MIS-002) ─────────────────────────────────────────────────────────────────────────────────────────

export type HorizonItemRow = {
  id: string;
  title: string;
  stage: string;
  expected_date: string | null;
  effective_from: string | null;
  celex: string | null;
};

export type HorizonEntry = {
  key: string;
  /** "1 JAN 2027", "JAN 2028" (expected, not law) or "NO DATE". */
  date: string;
  sortDate: string | null;
  stage: string;
  title: string;
  body: string;
  cite: string | null;
  /** The recipes against it; null when nothing links the item to recipes (#73 gap 1). */
  impact: { count: number; label: string } | null;
  tone: Severity | "draft";
  href: string | null;
};

export type Deadline = {
  card: AlertCard;
  /** The date the countdown runs to: placing on the market ends, or, once that has passed, sell-through ends. */
  until: string;
  days: number;
  label: string;
  recipesHref: string;
};

export type Horizon = { entries: HorizonEntry[]; deadline: Deadline | null; deadlines: number };

const STAGE_LABEL: Record<string, string> = {
  proposal: "PROPOSAL",
  draft: "DRAFT",
  consultation: "CONSULTATION",
  adopted: "ADOPTED",
  published: "PUBLISHED",
  in_force: "IN FORCE",
};
const ENACTED = new Set(["adopted", "published", "in_force"]);

function placeOf(card: AlertCard): string {
  if (card.markets.length === 1) return card.markets[0].name;
  return "";
}

function recipesHref(workspaceId: string, card: AlertCard): string {
  const open = card.recipes.filter((r) => r.href);
  if (card.recipes.length === 1 && open.length === 1) return open[0].href!;
  return `/w/${workspaceId}/alerts?diff=${card.diffId}`;
}

/**
 * Everything coming, in date order: each coming change from the inbox (its effective date) and each sell-through end
 * still ahead, with the recipes against them; then the horizon items not yet in force. A draft, proposal or
 * consultation carries no countdown and no effective date (BE-37); an expected month is shown as a month.
 */
export function buildHorizon(workspaceId: string, cards: AlertCard[], items: HorizonItemRow[], today: string): Horizon {
  const entries: HorizonEntry[] = [];
  for (const c of cards) {
    const place = placeOf(c);
    const title = place ? `${place} · ${c.title}` : c.title;
    const n = c.recipes.length;
    if (c.phase === "coming" && c.effectiveFrom && c.effectiveFrom > today) {
      entries.push({
        key: `${c.diffId}:from`,
        date: monoDate(c.effectiveFrom),
        sortDate: c.effectiveFrom,
        stage: "ADOPTED",
        title,
        body: cardSentence(c, today),
        cite: c.citation,
        impact: { count: n, label: c.severity === "blocked" ? (n === 1 ? "recipe to reformulate" : "recipes to reformulate") : n === 1 ? "recipe affected" : "recipes affected" },
        tone: c.severity,
        href: recipesHref(workspaceId, c),
      });
    }
    if (c.sellThroughUntil && c.sellThroughUntil > today) {
      entries.push({
        key: `${c.diffId}:sell-through`,
        date: monoDate(c.sellThroughUntil),
        sortDate: c.sellThroughUntil,
        stage: "ADOPTED",
        title: `${title} · sell-through of existing stock ends`,
        body: `Existing stock may be sold until ${longDate(c.sellThroughUntil)}.`,
        cite: c.citation,
        impact: { count: n, label: n === 1 ? "recipe's stock to sell through" : "recipes' stock to sell through" },
        tone: "blocked",
        href: recipesHref(workspaceId, c),
      });
    }
  }
  for (const h of items) {
    const enacted = ENACTED.has(h.stage);
    if (h.stage === "in_force" || (h.effective_from && h.effective_from <= today)) continue;
    const date = enacted && h.effective_from ? monoDate(h.effective_from) : h.expected_date ? monoMonth(h.expected_date) : "NO DATE";
    entries.push({
      key: `horizon:${h.id}`,
      date,
      sortDate: enacted && h.effective_from ? h.effective_from : h.expected_date,
      stage: STAGE_LABEL[h.stage] ?? h.stage.toUpperCase(),
      title: h.title,
      body: enacted ? "Enacted, not yet in force." : "Not law yet. It carries no countdown, because a proposal that fails would make one a lie.",
      cite: h.celex,
      impact: null,
      tone: enacted ? "action" : "draft",
      href: null,
    });
  }
  entries.sort((a, b) => {
    if (a.sortDate === b.sortDate) return a.key < b.key ? -1 : 1;
    if (a.sortDate === null) return 1;
    if (b.sortDate === null) return -1;
    return a.sortDate < b.sortDate ? -1 : 1;
  });

  const withdrawn = cards
    .filter((c) => c.effectType === "withdrawn_authorisation")
    .map((c) => {
      const until = c.effectiveFrom && c.effectiveFrom > today ? c.effectiveFrom : c.sellThroughUntil && c.sellThroughUntil > today ? c.sellThroughUntil : null;
      return until ? { c, until } : null;
    })
    .filter((x): x is { c: AlertCard; until: string } => x !== null)
    .sort((a, b) => (a.until < b.until ? -1 : 1));
  const next = withdrawn[0];
  return {
    entries,
    deadlines: withdrawn.length,
    deadline: next
      ? {
          card: next.c,
          until: next.until,
          days: daysBetween(today, next.until),
          label: next.until === next.c.effectiveFrom ? "DAYS TO REFORMULATE" : "DAYS OF SELL-THROUGH LEFT",
          recipesHref: recipesHref(workspaceId, next.c),
        }
      : null,
  };
}

export function count(n: number, one: string, many: string): string {
  const words = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  return `${n <= 10 ? words[n] : n} ${n === 1 ? one : many}`;
}
