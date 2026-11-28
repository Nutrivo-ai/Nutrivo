// T-1113 (on T-506): the board as the product matrix (S-MTX-001 to 011, D-33; F01) and the open findings across it
// (F04). A workspace's products are seeded as the check worker leaves them (product_nodes states, a check job, its
// checks and findings), through the service role, and a viewer reads the board under RLS. The local stack releases
// only 0000.00-empty, so no market can be Label clear (the verdict guard stores a clear label as Not assessed); Label
// clear beside an Unknown registration is rendered in src/components/board/Board.test.tsx. The states the board shows
// here come from action findings and registration states, which is what the matrix must never merge or hide.
import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { serveDesign } from "../visual/design-server";
import { expectLikeBaseline, type Region } from "./support/baseline";
import { admin, haveStack, person, signIn, workspace, type Person } from "./support/people";
import { axe, maxDiffPixelRatio, watch } from "./support/public";
import { loadWorkspace } from "../load/support/seed";

const RULESET = "0000.00-empty";

/** The row a service-role write or read returned, or the reason it failed. */
async function must<R = { id: string }>(what: string, p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<R> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  if (data == null) throw new Error(`${what}: no row`);
  return data as R;
}

type Seeded = { salmon: string; feline: string; old: string; actionId: string; gapFindingId: string; staleFindingId: string; gapId: string };

/**
 * Three products: Salmon in Austria, Germany and Sweden (the plan's EU) and Texas (outside the plan) with a checked
 * job; Feline in Germany, never checked; Old discontinued.
 */
async function seed(ws: string): Promise<Seeded> {
  const app = admin().schema("app");
  const product = async (name: string, species: string, stage = "active") => {
    const fam = await must("family", app.from("families").insert({ workspace_id: ws, name }).select("id").single());
    const p = await must(
      "product",
      app
        .from("products")
        .insert({
          workspace_id: ws,
          family_id: fam.id,
          name,
          stage,
          species,
          life_stage: "adult",
          format: "dry",
          discontinued_at: stage === "discontinued" ? new Date().toISOString() : null,
        })
        .select("id")
        .single(),
    );
    return p.id as string;
  };
  const salmon = await product("Salmon & Rice Adult Dry 12 kg", "dog");
  const feline = await product("Feline Urinary Care Dry 2 kg", "cat");
  const old = await product("Discontinued Lamb Dry 4 kg", "dog", "discontinued");
  await must(
    "markets",
    app.from("product_nodes").insert([
      ...["EU-AT", "EU-DE", "EU-SE", "US-TX"].map((node_id) => ({ product_id: salmon, node_id, workspace_id: ws })),
      { product_id: feline, node_id: "EU-DE", workspace_id: ws },
      { product_id: old, node_id: "EU-DE", workspace_id: ws },
    ]).select("node_id"),
  );

  const job = async (product: string) =>
    (
      await must(
        "job",
        app
          .from("jobs")
          .insert({ workspace_id: ws, kind: "check", status: "succeeded", idempotency_key: `e2e-board:${randomUUID()}`, payload: { product_id: product } })
          .select("id")
          .single(),
      )
    ).id as string;
  const check = async (product: string, jobId: string, node: string, label: string) =>
    (
      await must(
        "check",
        app
          .from("checks")
          .insert({ workspace_id: ws, job_id: jobId, product_id: product, node_id: node, ruleset_version: RULESET, label_state: label, language: "de" })
          .select("id")
          .single(),
      )
    ).id as string;
  const finding = async (row: Record<string, unknown>) =>
    (await must("finding", app.from("check_findings").insert(row as never).select("id").single())).id as string;

  const gap = await must<{ gap_id: string; reason_code: string }>(
    "gap",
    admin().schema("ref").from("coverage_gaps").select("gap_id, reason_code").eq("node_id", "EU-AT").order("gap_id").limit(1).single(),
  );

  // An older job on EU-DE, superseded by the latest: its finding must not appear.
  const older = await job(salmon);
  const olderCheck = await check(salmon, older, "EU-DE", "not_assessed");
  const staleFindingId = await finding({
    workspace_id: ws, check_id: olderCheck, product_id: salmon, node_id: "EU-DE", state: "not_assessed",
    provenance: "not_assessed", reason_code: "data_missing", rule_key: "e2e.board.older", message: "From an older check job",
  });

  const latest = await job(salmon);
  const de = await check(salmon, latest, "EU-DE", "action");
  const at = await check(salmon, latest, "EU-AT", "not_assessed");
  await check(salmon, latest, "EU-SE", "not_assessed");
  const actionId = await finding({
    workspace_id: ws, check_id: de, product_id: salmon, node_id: "EU-DE", state: "action", provenance: "deterministic_rule",
    rule_key: "e2e.board.netqty", citation: "E2E citation, net quantity", message: "Net quantity is printed too small",
    recommended_action: "Set the net quantity at the required height.",
  });
  const gapFindingId = await finding({
    workspace_id: ws, check_id: at, product_id: salmon, node_id: "EU-AT", state: "not_assessed", provenance: "not_assessed",
    reason_code: gap.reason_code, gap_id: gap.gap_id, message: "Not encoded for Austria",
  });

  // As the check worker leaves the markets: Germany two open findings and registered; Austria withheld, registration
  // unknown; Sweden withheld with an expired registration (Blocked); Texas not registered, outside the plan.
  const set = (node: string, values: Record<string, unknown>) =>
    must(`market ${node}`, app.from("product_nodes").update(values as never).eq("product_id", salmon).eq("node_id", node).select("node_id"));
  await set("EU-DE", { label_state: "action", open_actions: 2, registration_state: "registered", ruleset_version: RULESET, last_check_job_id: latest });
  await set("EU-AT", { label_state: "not_assessed", registration_state: "unknown", ruleset_version: RULESET, last_check_job_id: latest });
  await set("EU-SE", { label_state: "not_assessed", registration_state: "expired", ruleset_version: RULESET, last_check_job_id: latest });
  await set("US-TX", { registration_state: "not_registered" });
  // The discontinued product has an action that must stay off the board and out of the findings.
  await must("old market", app.from("product_nodes").update({ label_state: "action", open_actions: 1 }).eq("product_id", old).select("node_id"));

  return { salmon, feline, old, actionId, gapFindingId, staleFindingId, gapId: gap.gap_id };
}

// The route streams behind w/[workspace]/loading.tsx: wait for the screen's own regions before reading them.
const grid = (page: Page) => page.locator('[data-region="grid"]');
const row = (page: Page, product: string) => grid(page).locator(`[role="row"][data-product="${product}"]`);
const cell = (page: Page, product: string, node: string) => row(page, product).locator(`[role="gridcell"][data-node="${node}"]`);
const states = (page: Page) => page.getByRole("group", { name: "State" });
const views = (page: Page) => page.getByRole("navigation", { name: "Board views" });

/**
 * Where an element of the S-MTX-001 frame sits in its baseline: measured in the design file itself, served and drawn
 * as tests/visual/baselines.spec.ts drew the baseline (1600 × 1000, fonts ready), so the coordinates are the
 * baseline's own and the pixels compared are the baseline's.
 */
async function designRegion(browser: Browser, selector: string): Promise<Region> {
  const server = await serveDesign();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  try {
    await page.goto(`${server.url}/${encodeURI("product/Nutrivo Board.dc.html")}`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(400);
    const r = await page.locator(selector).first().evaluate((el) => {
      const b = el.getBoundingClientRect();
      return { x: b.left + window.scrollX, y: b.top + window.scrollY, width: b.width, height: b.height };
    });
    return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height), fractionY: r.y - Math.floor(r.y) };
  } finally {
    await page.close();
    server.close();
  }
}

test.describe("the board as the product matrix, and the findings across it", () => {
  test.skip(!haveStack(), "needs the local Supabase stack: run through scripts/ci/e2e.sh (make e2e)");
  test.describe.configure({ mode: "serial" });

  let owner: Person, viewer: Person;
  let ws: string;
  let s: Seeded;

  test.beforeAll(async () => {
    [owner, viewer] = await Promise.all([person("t1113-owner"), person("t1113-viewer")]);
    ws = await workspace(owner, "Halden Board Test");
    // The plan holds the EU only, so Salmon's Texas market is a column outside the plan (S-MTX-004).
    {
      const plan = await admin().schema("app").from("workspaces").update({ entitled_regions: ["EU"] }).eq("id", ws).select("id");
      if (plan.error) throw plan.error;
    }
    await workspace(viewer, "Viewer's own");
    const service = admin().schema("app");
    const v = await must("viewer", service.from("people").select("id").eq("user_id", viewer.userId).single());
    await must("membership", service.from("memberships").insert({ workspace_id: ws, person_id: v.id, role: "viewer" }).select("id"));
    s = await seed(ws);
  });

  test("[F01.main] Portfolio board: the main path works end to end", async ({ page, context, baseURL, browser }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await signIn(context, viewer, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/board`);
    await expect(grid(page)).toBeVisible();

    // Two products on four markets; the discontinued one is not on the board (F01 step 3).
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Products and markets");
    await expect(page.locator('[data-region="subline"]')).toHaveText("Halden Board Test · 2 products · 4 markets");
    await expect(grid(page).locator('[role="row"][data-product]')).toHaveCount(2);
    await expect(row(page, s.old)).toHaveCount(0);
    await expect(grid(page).locator('[role="row"][data-product]').first()).toContainText("Feline Urinary Care Dry 2 kg");

    // A column per market, no region roll-up column; the market outside the plan last, with Upgrade.
    expect(await grid(page).locator("[role=columnheader][data-column]").evaluateAll((els) => els.map((e) => e.getAttribute("data-column")))).toEqual([
      "EU-AT",
      "EU-DE",
      "EU-SE",
      "US-TX",
    ]);
    const texas = grid(page).locator('[role=columnheader][data-column="US-TX"]');
    await expect(texas).toContainText("Not in your plan");
    await expect(texas.getByRole("link", { name: "Upgrade" })).toHaveAttribute("href", `/w/${ws}/billing/plans`);
    await expect(grid(page).locator('[role=columnheader][data-column="EU-DE"]')).toContainText("0 of 1 products label clear");

    // Each cell: the label line and the registration line, never merged.
    await expect(cell(page, s.salmon, "EU-DE")).toHaveAttribute("data-cell", "action");
    await expect(cell(page, s.salmon, "EU-DE")).toContainText("Action needed · 2 open");
    await expect(cell(page, s.salmon, "EU-DE")).toContainText("Registered");
    await expect(cell(page, s.salmon, "EU-AT")).toHaveAttribute("data-cell", "not_assessed");
    await expect(cell(page, s.salmon, "EU-AT")).toContainText("Unknown");
    // Sweden: the Blocked chip names the expired registration in place of the registration line; the label line stays.
    await expect(cell(page, s.salmon, "EU-SE")).toHaveAttribute("data-blocked", "expired");
    await expect(cell(page, s.salmon, "EU-SE")).toContainText("Not assessed");
    await expect(cell(page, s.salmon, "EU-SE")).toContainText("Blocked · registration expired");
    await expect(cell(page, s.salmon, "US-TX")).toHaveAttribute("data-cell", "locked");
    await expect(cell(page, s.salmon, "US-TX")).toHaveAttribute("aria-disabled", "true");
    await expect(cell(page, s.salmon, "US-TX").locator("a")).toHaveCount(0);
    // Feline: never checked in Germany, not sold anywhere else.
    await expect(cell(page, s.feline, "EU-DE")).toHaveAttribute("data-cell", "never");
    await expect(cell(page, s.feline, "EU-DE")).toContainText("Not checked yet");
    await expect(cell(page, s.feline, "EU-AT")).toHaveAttribute("data-cell", "none");
    await expect(cell(page, s.feline, "EU-AT")).toContainText("Not a market for this product");
    // Unknown never reads clear: no market is Label clear here, and nothing reads a bare "Clear".
    await expect(grid(page).locator('[data-cell="clear"]')).toHaveCount(0);
    await expect(grid(page).getByText("Clear", { exact: true })).toHaveCount(0);

    // Row summaries count markets; no score.
    await expect(row(page, s.salmon).locator("[data-row-summary]")).toHaveText("1 market with open items · 1 blocked");
    await expect(row(page, s.feline).locator("[data-row-summary]")).toHaveText("Not checked yet");
    // A viewer may not create products, so neither control is drawn.
    await expect(page.locator('[data-region="board"]').getByRole("link", { name: "Add a product" })).toHaveCount(0);
    await expect(page.locator('[data-region="board"]').getByRole("link", { name: "Upload a label" })).toHaveCount(0);

    await axe(page);
    // S-MTX-001's legend, against the baseline: its Label clear chip (glyph, name, tint) is drawn as the design draws it.
    const legend = await designRegion(browser, '[aria-label="Legend"] > span:nth-child(2)');
    await expectLikeBaseline(page, page.locator('[data-region="legend"] > span').nth(1), "S-MTX-001", legend, maxDiffPixelRatio);

    // Filters in the URL (F01 step 3): state, then market; "Showing n of N · Clear filters".
    await states(page).getByRole("link", { name: "Action needed" }).click();
    await expect(page).toHaveURL(/state=action/);
    await expect(grid(page).locator('[role="row"][data-product]')).toHaveCount(1);
    await expect(row(page, s.salmon)).toBeVisible();
    await expect(page.locator('[data-region="showing"]')).toHaveText("Showing 1 of 2 products · Clear filters");
    await page.locator('[data-region="showing"]').getByRole("link", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${ws}/board$`));
    await expect(grid(page).locator('[role="row"][data-product]')).toHaveCount(2);
    await page.getByLabel("Market").selectOption("EU-DE");
    await expect(page).toHaveURL(/market=EU-DE/);
    await expect(grid(page).locator("[role=columnheader][data-column]")).toHaveCount(1);
    // A market outside the plan is not offered.
    await expect(page.getByLabel("Market").locator('option[value="US-TX"]')).toHaveCount(0);

    // A cell opens that product in that market; never queues a check.
    await cell(page, s.salmon, "EU-DE").getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/w/${ws}/products/${s.salmon}/nodes/EU-DE$`));
    expect(errors).toEqual([]);
  });

  test("[F01.must.1] A parent is never better than its worst child, computed in the database (BE-15).", async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await signIn(context, viewer, baseURL!);
    await page.goto(`/w/${ws}/board`);
    await expect(grid(page)).toBeVisible();
    // The matrix rolls nothing up: no column is a region.
    const columns = await grid(page).locator("[role=columnheader][data-column]").evaluateAll((els) => els.map((e) => e.getAttribute("data-column")!));
    expect(columns.filter((c) => !c.includes("-"))).toEqual([]);
    // A row opens the product page (S-MOB-002), where each region reads exactly what app.rollup_state answers, read as
    // the viewer: Sweden is Blocked, so the EU reads Blocked, never better.
    await row(page, s.salmon).getByRole("rowheader").getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/w/${ws}/products/${s.salmon}$`));
    const eu = page.locator('main[data-screen="S-MOB-002"] [data-region="markets"]').filter({ visible: true }).locator('li[data-node="EU"]');
    const { data, error } = await viewer.db.schema("app").rpc("rollup_state", { p_product: s.salmon, p_node: "EU" });
    expect(error).toBeNull();
    expect(data).toBe("blocked");
    await expect(eu).toHaveAttribute("data-state", data!);
  });

  test("[F04.main] Portfolio findings: the main path works end to end", async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await signIn(context, viewer, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/board`);
    await views(page).getByRole("link", { name: "Open findings" }).click();
    await expect(page).toHaveURL(/view=findings/);
    const list = page.locator('[data-region="findings"]');
    await expect(list.getByRole("heading", { level: 2 })).toHaveText("Open findings across the portfolio");

    // The open findings of each market's latest check, actions first. The older job's finding and the discontinued
    // product are not there; Texas is outside the plan, and the view says so.
    await expect(list.locator("[data-finding]")).toHaveCount(2);
    await expect(list.locator("[data-finding]").first()).toHaveAttribute("data-finding", s.actionId);
    await expect(list.locator(`[data-finding="${s.staleFindingId}"]`)).toHaveCount(0);
    await expect(list.locator(`[data-product="${s.old}"]`)).toHaveCount(0);
    await expect(list.locator("[data-outside-plan]")).toContainText("United States");

    // Each with its provenance, and its rule or its coverage gap.
    const action = list.locator(`[data-finding="${s.actionId}"]`);
    await expect(action).toContainText("Salmon & Rice Adult Dry 12 kg · EU · DE · DE panel"); // per language panel (non-negotiable 4)
    await expect(action).toContainText("Net quantity is printed too small");
    await expect(action.locator('[data-rule-key="e2e.board.netqty"]')).toHaveText("E2E citation, net quantity");
    await expect(action).toContainText("Deterministic rule");
    await expect(action.locator('[data-finding-state="action"]')).toBeVisible();
    const withheld = list.locator(`[data-finding="${s.gapFindingId}"]`);
    await expect(withheld.locator('[data-finding-state="not_assessed"]')).toBeVisible();
    await expect(withheld.locator(`[data-gap-id="${s.gapId}"]`)).toBeVisible();
    await expect(list.locator("[data-findings-total]")).toHaveAttribute("data-findings-total", "2");
    await axe(page);

    // Filterable, like the board.
    await states(page).getByRole("link", { name: "Action needed" }).click();
    await expect(page).toHaveURL(/view=findings/);
    await expect(list.locator("[data-finding]")).toHaveCount(1);
    await states(page).getByRole("link", { name: "Not assessed" }).click();
    await expect(list.locator("[data-finding]")).toHaveCount(1);
    await expect(list.locator(`[data-finding="${s.gapFindingId}"]`)).toBeVisible();
    await page.goto(`/w/${ws}/board?view=findings&market=EU-DE`);
    await expect(list.locator("[data-finding]")).toHaveCount(1);
    await expect(list.locator(`[data-finding="${s.actionId}"]`)).toBeVisible();
    await page.goto(`/w/${ws}/board?view=findings&state=blocked`);
    await expect(page.getByText("No open finding matches these filters")).toBeVisible();

    // A finding opens its product × market.
    await page.goto(`/w/${ws}/board?view=findings`);
    await list.locator(`[data-finding="${s.actionId}"] a`).first().click();
    await expect(page).toHaveURL(new RegExp(`/products/${s.salmon}/nodes/EU-DE$`));
    expect(errors).toEqual([]);
  });

  test("[T-1113] keyboard: one tab stop in the grid, arrows skip inert and disabled cells, Home and End, Enter opens", async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await signIn(context, viewer, baseURL!);
    await page.goto(`/w/${ws}/board`);
    await expect(grid(page)).toBeVisible();
    const stop = grid(page).locator('[data-nav][tabindex="0"]');
    await expect(stop).toHaveCount(1);
    // Rows in name order: Feline first, whose only market is Germany.
    const focusedCell = () => page.evaluate(() => document.activeElement?.closest("[role=gridcell],[role=rowheader]")?.getAttribute("data-node") ?? "rowheader");
    const focusedRow = () => page.evaluate(() => document.activeElement?.closest("[role=row]")?.getAttribute("data-product"));
    await stop.focus();
    expect([await focusedRow(), await focusedCell()]).toEqual([s.feline, "EU-DE"]);
    // Right: Feline is sold nowhere else, so focus stays.
    await page.keyboard.press("ArrowRight");
    expect(await focusedCell()).toBe("EU-DE");
    await page.keyboard.press("ArrowDown");
    expect([await focusedRow(), await focusedCell()]).toEqual([s.salmon, "EU-DE"]);
    await page.keyboard.press("ArrowRight");
    expect(await focusedCell()).toBe("EU-SE");
    // Texas is outside the plan: disabled, so Right stops at Sweden.
    await page.keyboard.press("ArrowRight");
    expect(await focusedCell()).toBe("EU-SE");
    await page.keyboard.press("Home");
    expect(await focusedCell()).toBe("rowheader");
    await page.keyboard.press("End");
    expect(await focusedCell()).toBe("EU-SE");
    // Up from Sweden: Feline is not sold there, nor above it, so focus stays.
    await page.keyboard.press("ArrowUp");
    expect([await focusedRow(), await focusedCell()]).toEqual([s.salmon, "EU-SE"]);
    // Still one tab stop, the cell with focus; its ring is visible.
    await expect(stop).toHaveCount(1);
    expect(await page.evaluate(() => document.activeElement?.getAttribute("tabindex"))).toBe("0");
    expect(await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle)).not.toBe("none");
    // Enter opens: Sweden is Not assessed, so its coverage gaps.
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/w/${ws}/library/coverage/EU-SE$`));
  });

  test("[S-MTX-006] compact density: 40 px rows on one line, comfortable the default, in the URL", async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await signIn(context, viewer, baseURL!);
    await page.goto(`/w/${ws}/board`);
    await expect(grid(page)).toHaveAttribute("data-density", "comfortable");
    const height = async () => (await row(page, s.salmon).boundingBox())!.height;
    expect(await height()).toBeGreaterThanOrEqual(72);
    await page.getByRole("group", { name: "Density" }).getByRole("link", { name: "Compact" }).click();
    await expect(page).toHaveURL(/density=compact/);
    await expect(grid(page)).toHaveAttribute("data-density", "compact");
    expect(await height()).toBeLessThan(48);
    await expect(cell(page, s.salmon, "EU-SE")).toContainText("Blocked");
    await expect(cell(page, s.salmon, "EU-AT").locator("[data-reg-line]")).toHaveCount(0);
    await axe(page);
  });

  test("[S-MTX-002] on a phone, one product per card, each market opening what its desktop cell opens", async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(context, viewer, baseURL!);
    await page.goto(`/w/${ws}/board`);
    const card = page.locator(`[data-region="cards"] section[data-product="${s.salmon}"]`);
    await expect(card).toBeVisible();
    await expect(grid(page)).toBeHidden();
    await expect(card.getByRole("heading", { level: 2 })).toHaveText("Salmon & Rice Adult Dry 12 kg");
    await expect(card.locator("li[data-node]")).toHaveCount(4);
    await expect(card.locator('li[data-node="EU-SE"]')).toContainText("Blocked · registration expired");
    await expect(card.locator('li[data-node="US-TX"]')).toContainText("Not in your plan");
    await axe(page);
    await card.locator('li[data-node="EU-DE"] a').click();
    await expect(page).toHaveURL(new RegExp(`/w/${ws}/products/${s.salmon}/nodes/EU-DE$`));
  });

  test("[S-MTX-008] an empty workspace shows how to put a product on the board, to someone who may", async ({ page, context, baseURL }) => {
    await signIn(context, owner, baseURL!);
    const empty = await workspace(owner, "Empty Board Test");
    await page.goto(`/w/${empty}/board`);
    const region = page.locator('[data-region="empty"]');
    await expect(region.getByRole("heading", { level: 2 })).toHaveText("Add a product to see it against every market");
    await expect(region.getByRole("link", { name: "Add a product" })).toHaveAttribute("href", `/w/${empty}/products/new`);
    await expect(region.getByRole("link", { name: "Upload a label" })).toHaveAttribute("href", `/w/${empty}/products/new#start-from-label`);
    await axe(page);
  });

  test("[S-MTX-007] 50 products by 30 markets: the header row and the product column stay in view", async ({ page, context, baseURL }) => {
    test.setTimeout(180_000);
    const who = await person("t1113-scale");
    const big = await workspace(who, "Halden Scale Test");
    const service = admin();
    const markets = (
      await must<{ id: string; parent_id: string }[]>(
        "markets",
        service.schema("ref").from("jurisdictions").select("id, parent_id").not("parent_id", "is", null).order("id").limit(30),
      )
    ).map((j) => j);
    expect(markets).toHaveLength(30);
    const regions = [...new Set(markets.map((m) => m.parent_id))];
    {
      const plan = await service.schema("app").from("workspaces").update({ entitled_regions: regions }).eq("id", big).select("id");
      if (plan.error) throw plan.error;
    }
    const app = service.schema("app");
    const fam = await must("family", app.from("families").insert({ workspace_id: big, name: "Scale" }).select("id").single());
    const products = await must<{ id: string }[]>(
      "products",
      app
        .from("products")
        .insert(Array.from({ length: 50 }, (_, i) => ({ workspace_id: big, family_id: fam.id, name: `Scale recipe ${String(i + 1).padStart(2, "0")}`, stage: "active", species: "dog" })))
        .select("id"),
    );
    await must(
      "nodes",
      app.from("product_nodes").insert(products.flatMap((p) => markets.map((m) => ({ workspace_id: big, product_id: p.id, node_id: m.id })))).select("node_id"),
    );

    await page.setViewportSize({ width: 1600, height: 1000 });
    await signIn(context, who, baseURL!);
    await page.goto(`/w/${big}/board`);
    await expect(grid(page).locator('[role="row"][data-product]')).toHaveCount(50);
    await expect(grid(page).locator("[role=columnheader][data-column]")).toHaveCount(30);
    await expect(page.getByRole("navigation", { name: "Board pages" })).toHaveCount(0);
    const scroller = page.locator('[data-region="matrix"]');
    await scroller.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      el.scrollLeft = el.scrollWidth;
    });
    const box = (await scroller.boundingBox())!;
    const head = (await grid(page).locator('[role="row"]').first().boundingBox())!;
    const product = (await grid(page).locator('[role="row"][data-product]').last().getByRole("rowheader").boundingBox())!;
    expect(Math.abs(head.y - (box.y + 1)), "the header row stays at the top of the scroller").toBeLessThanOrEqual(1);
    expect(Math.abs(product.x - (box.x + 1)), "the product column stays at the left of the scroller").toBeLessThanOrEqual(1);
    await expect(grid(page).locator('[role="row"][data-product]').last()).toContainText("Scale recipe 50");
    await axe(page);
  });

  test("a board of more than 50 products pages its rows, and a filter starts again at the first page (issue 311)", async ({ page, context, baseURL }) => {
    test.setTimeout(180_000);
    const big = await loadWorkspace(55); // names Load recipe 001…055
    await signIn(context, big.owner, baseURL!);
    const errors = watch(page);
    const rows = grid(page).locator('[role="row"][data-product]');
    const pager = page.getByRole("navigation", { name: "Board pages" });

    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(`/w/${big.ws}/board`);
    await expect(page.locator('[data-region="subline"]')).toContainText("55 products");
    await expect(rows).toHaveCount(50);
    await expect(pager).toContainText("ROWS 1–50 OF 55");
    await expect(pager).toContainText("PAGE 1 OF 2");
    await expect(pager.getByRole("link", { name: "PREVIOUS 50" })).toHaveCount(0);
    await axe(page);

    await pager.getByRole("link", { name: "NEXT 5" }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${big.ws}/board\\?page=2$`));
    await expect(rows).toHaveCount(5);
    await expect(rows.first()).toContainText("Load recipe 051");
    await expect(pager).toContainText("ROWS 51–55 OF 55");

    // A density link leaves page 2 too.
    await page.getByRole("group", { name: "Density" }).getByRole("link", { name: "Compact" }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${big.ws}/board\\?density=compact$`));
    await expect(rows).toHaveCount(50);

    // A page past the end shows the last page, never an empty grid.
    await page.goto(`/w/${big.ws}/board?page=9`);
    await expect(rows).toHaveCount(5);
    expect(errors).toEqual([]);
  });

  test("[T-1113] no dead controls: every link on the board and the findings view goes somewhere, and there is no button", async ({ page, context, baseURL }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await signIn(context, viewer, baseURL!);
    // The screen's own controls (the shell's are crawled in shell.spec.ts; its sign-out would end this session).
    for (const url of [`/w/${ws}/board`, `/w/${ws}/board?view=findings`, `/w/${ws}/board?state=action&market=EU-DE&density=compact`]) {
      const errors = watch(page);
      await page.goto(url);
      const board = page.locator('[data-region="board"]');
      const links = board.locator("a").filter({ visible: true });
      await expect(links.first()).toBeVisible();
      const hrefs = await links.evaluateAll((els) => els.map((a) => a.getAttribute("href")));
      for (const href of new Set(hrefs)) {
        expect(href, `every link on ${url} stays on the site`).toMatch(/^\//);
        const response = await page.request.get(href!.split("#")[0], { maxRedirects: 0 });
        expect(response.status(), `${href} on ${url}`).toBeLessThan(400);
      }
      // Filters, views, density and cells are links, the market a select; the board has no button of its own.
      await expect(board.locator("button")).toHaveCount(0);
      expect(errors).toEqual([]);
    }
  });
});
