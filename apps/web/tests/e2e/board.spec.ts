// T-506: the portfolio board (F01) and the open findings across it (F04). A workspace's products are seeded as the
// check worker leaves them (product_nodes states, a check job, its checks and findings), through the service role, and
// a viewer reads the board under RLS. The local stack releases only 0000.00-empty, so no market can be Clear (the
// verdict guard stores a clear label as Not assessed); the states the board shows come from action findings and
// registration states, which is what the roll-up must not hide.
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { expectLikeBaseline, type Region } from "./support/baseline";
import { admin, haveStack, person, signIn, workspace, type Person } from "./support/people";
import { axe, maxDiffPixelRatio, watch } from "./support/public";

const RULESET = "0000.00-empty";

/** The row a service-role write or read returned, or the reason it failed. */
async function must<R = { id: string }>(what: string, p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<R> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  if (data == null) throw new Error(`${what}: no row`);
  return data as R;
}

type Seeded = { salmon: string; feline: string; old: string; actionId: string; gapFindingId: string; staleFindingId: string; gapId: string };

/** Three products: Salmon in four markets with a checked job, Feline never checked, Old discontinued. */
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
      ...["EU-AT", "EU-DE", "US-FED", "US-TX"].map((node_id) => ({ product_id: salmon, node_id, workspace_id: ws })),
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
  const actionId = await finding({
    workspace_id: ws, check_id: de, product_id: salmon, node_id: "EU-DE", state: "action", provenance: "deterministic_rule",
    rule_key: "e2e.board.netqty", citation: "E2E citation, net quantity", message: "Net quantity is printed too small",
    recommended_action: "Set the net quantity at the required height.",
  });
  const gapFindingId = await finding({
    workspace_id: ws, check_id: at, product_id: salmon, node_id: "EU-AT", state: "not_assessed", provenance: "not_assessed",
    reason_code: gap.reason_code, gap_id: gap.gap_id, message: "Not encoded for Austria",
  });

  // As the check worker leaves the markets: EU-DE action with two open actions, EU-AT withheld, US-TX not registered
  // (the Texas case), US-FED registered with nothing assessed.
  const set = (node: string, values: Record<string, unknown>) =>
    must(`market ${node}`, app.from("product_nodes").update(values as never).eq("product_id", salmon).eq("node_id", node).select("node_id"));
  await set("EU-DE", { label_state: "action", open_actions: 2, ruleset_version: RULESET, last_check_job_id: latest });
  await set("EU-AT", { label_state: "not_assessed", ruleset_version: RULESET, last_check_job_id: latest });
  await set("US-TX", { registration_state: "not_registered" });
  await set("US-FED", { registration_state: "registered" });
  // The discontinued product has an action that must stay off the board and out of the findings.
  await must("old market", app.from("product_nodes").update({ label_state: "action", open_actions: 1 }).eq("product_id", old).select("node_id"));

  return { salmon, feline, old, actionId, gapFindingId, staleFindingId, gapId: gap.gap_id };
}

const grid = (page: Page) => page.locator('[data-region="grid"]');
const filters = (page: Page) => page.getByRole("navigation", { name: "Board filters" });
const cell = (page: Page, product: string, node: string) => grid(page).locator(`tr[data-product="${product}"] td[data-node="${node}"]`);

// S-NV2-006 at 1600 px: the legend under the board (its four glyphs and names), which this task draws as the design
// does. The stat tiles, columns and rows hold the design's own figures, so they are not compared. The legend's line
// box starts at y 701.36 in the design (its 9 px glyphs at 705, centred on a 16.3 px line).
const S_NV2_006: Record<string, Region> = {
  legend: { x: 242, y: 701, width: 386, height: 16, fractionY: 0.75 },
};

test.describe("portfolio board and findings", () => {
  test.skip(!haveStack(), "needs the local Supabase stack: run through scripts/ci/e2e.sh (make e2e)");
  test.describe.configure({ mode: "serial" });

  let owner: Person, viewer: Person;
  let ws: string;
  let s: Seeded;

  test.beforeAll(async () => {
    [owner, viewer] = await Promise.all([person("t506-owner"), person("t506-viewer")]);
    ws = await workspace(owner, "Halden Board Test");
    await workspace(viewer, "Viewer's own");
    const service = admin().schema("app");
    const v = await must("viewer", service.from("people").select("id").eq("user_id", viewer.userId).single());
    await must("membership", service.from("memberships").insert({ workspace_id: ws, person_id: v.id, role: "viewer" }).select("id"));
    s = await seed(ws);
  });

  test("[F01.main] Portfolio board: the main path works end to end", async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await signIn(context, viewer, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/board`);

    // Two products on four markets; the discontinued one is not on the board (F01 step 3).
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("2 products × 4 jurisdiction nodes");
    await expect(page.locator(`[data-ruleset="${RULESET}"]`)).toBeVisible();
    await expect(grid(page).locator("tbody tr")).toHaveCount(2);
    await expect(grid(page).locator(`tr[data-product="${s.old}"]`)).toHaveCount(0);
    await expect(grid(page).locator("tbody tr").first()).toContainText("Feline Urinary Care Dry 2 kg");

    // Grouped market columns, each region led by its roll-up (F01 steps 1 and 2).
    await expect(grid(page).locator("thead th[data-column]")).toHaveText([/^EU\b/, /^EU · AT/, /^EU · DE/, /^US\b/, /^US · FED/, /^US · TX/]);
    await expect(grid(page).locator('thead th[data-kind="region"]')).toHaveCount(2);

    // Each cell is the database's state for that product × market; the count is the open actions.
    await expect(cell(page, s.salmon, "EU-DE")).toHaveAttribute("data-cell-state", "action");
    await expect(cell(page, s.salmon, "EU-DE")).toContainText("2");
    await expect(cell(page, s.salmon, "EU-AT")).toHaveAttribute("data-cell-state", "not_assessed");
    await expect(cell(page, s.salmon, "US-TX")).toHaveAttribute("data-cell-state", "blocked"); // the Texas case
    await expect(cell(page, s.salmon, "US-FED")).toHaveAttribute("data-cell-state", "not_assessed");
    // Feline is sold only in Germany, never checked: Not assessed there, no answer elsewhere, nothing Clear.
    await expect(cell(page, s.feline, "EU-DE")).toHaveAttribute("data-cell-state", "not_assessed");
    await expect(cell(page, s.feline, "US-TX")).toHaveAttribute("data-cell-state", "");
    await expect(grid(page).locator('[data-cell-state="clear"]')).toHaveCount(0);

    // What each row was judged against.
    await expect(grid(page).locator(`tr[data-product="${s.salmon}"] [data-freshness]`)).toHaveAttribute("data-freshness", "current");
    await expect(grid(page).locator(`tr[data-product="${s.salmon}"] [data-freshness]`)).toContainText(RULESET);
    await expect(grid(page).locator(`tr[data-product="${s.feline}"] [data-freshness]`)).toContainText("never run");

    // The stat tiles: three market answers withheld (EU-AT, US-FED, Feline EU-DE); nothing stale on one release.
    await expect(page.locator('[data-stat="unproven"]')).toContainText("3");
    await expect(page.locator('[data-stat="stale"]')).toContainText("0");

    await axe(page);
    await expectLikeBaseline(page, page.locator('[data-region="legend"] > span').first(), "S-NV2-006", S_NV2_006.legend, maxDiffPixelRatio);

    // Filters (F01 step 3): by state and by species, in the URL.
    await filters(page).getByRole("link", { name: "Action needed" }).click();
    await expect(page).toHaveURL(/state=action/);
    await expect(grid(page).locator("tbody tr")).toHaveCount(1);
    await expect(grid(page).locator(`tr[data-product="${s.salmon}"]`)).toBeVisible();
    await filters(page).getByRole("link", { name: "cat", exact: true }).click();
    await expect(page).toHaveURL(/species=cat/);
    await expect(page.locator('[data-region="no-match"]')).toBeVisible();
    await filters(page).getByRole("link", { name: "All markets" }).click();
    await expect(grid(page).locator("tbody tr")).toHaveCount(2);

    // A cell opens that product in that market; the product name opens the product.
    await cell(page, s.salmon, "US-TX").getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/w/${ws}/products/${s.salmon}/nodes/US-TX$`));
    expect(errors).toEqual([]);
  });

  test("[F01.must.1] A parent is never better than its worst child, computed in the database (BE-15).", async ({ page, context, baseURL }) => {
    await signIn(context, viewer, baseURL!);
    await page.goto(`/w/${ws}/board`);
    // Every region cell shows exactly what app.rollup_state answers for that product × region, read as the viewer.
    for (const [product, region] of [[s.salmon, "EU"], [s.salmon, "US"], [s.feline, "EU"]] as const) {
      const { data, error } = await viewer.db.schema("app").rpc("rollup_state", { p_product: product, p_node: region });
      expect(error).toBeNull();
      await expect(cell(page, product, region)).toHaveAttribute("data-cell-state", data!);
    }
    // US: Texas is Blocked and the federal node Not assessed, so the region reads Blocked, never better.
    await expect(cell(page, s.salmon, "US")).toHaveAttribute("data-cell-state", "blocked");
    // EU: Germany has an action and Austria is withheld, so the region reads Action needed.
    await expect(cell(page, s.salmon, "EU")).toHaveAttribute("data-cell-state", "action");
    await expect(cell(page, s.salmon, "EU")).toContainText("2");
    await expect(cell(page, s.feline, "EU")).toHaveAttribute("data-cell-state", "not_assessed");
    // A region a product is not sold in has no answer at all.
    await expect(cell(page, s.feline, "US")).toHaveAttribute("data-cell-state", "");
    // The region cell opens the region's verdict, which names the child that sets it.
    await cell(page, s.salmon, "US").getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/products/${s.salmon}/nodes/US$`));
  });

  test("[F04.main] Portfolio findings: the main path works end to end", async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await signIn(context, viewer, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/board`);
    await filters(page).getByRole("link", { name: "Open findings" }).click();
    await expect(page).toHaveURL(/view=findings/);
    const list = page.locator('[data-region="findings"]');
    await expect(list.getByRole("heading", { level: 2 })).toHaveText("Open findings across the portfolio");

    // The open findings of each market's latest check, actions first. The older job's finding and the discontinued
    // product are not there.
    await expect(list.locator("[data-finding]")).toHaveCount(2);
    await expect(list.locator("[data-finding]").first()).toHaveAttribute("data-finding", s.actionId);
    await expect(list.locator(`[data-finding="${s.staleFindingId}"]`)).toHaveCount(0);
    await expect(list.locator(`[data-product="${s.old}"]`)).toHaveCount(0);

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
    await filters(page).getByRole("link", { name: "Action needed" }).click();
    await expect(page).toHaveURL(/view=findings/);
    await expect(list.locator("[data-finding]")).toHaveCount(1);
    await filters(page).getByRole("link", { name: "Not assessed" }).click();
    await expect(list.locator("[data-finding]")).toHaveCount(1);
    await expect(list.locator(`[data-finding="${s.gapFindingId}"]`)).toBeVisible();
    await filters(page).getByRole("link", { name: "cat", exact: true }).click();
    await expect(list.locator("[data-finding]")).toHaveCount(0);
    await expect(page.getByText("No open finding matches these filters")).toBeVisible();

    // A finding opens its product × market.
    await page.goto(`/w/${ws}/board?view=findings`);
    await list.locator(`[data-finding="${s.actionId}"] a`).first().click();
    await expect(page).toHaveURL(new RegExp(`/products/${s.salmon}/nodes/EU-DE$`));
    expect(errors).toEqual([]);
  });

  test("an empty workspace shows how to put a product on the board", async ({ page, context, baseURL }) => {
    await signIn(context, owner, baseURL!);
    const empty = await workspace(owner, "Empty Board Test");
    await page.goto(`/w/${empty}/board`);
    await expect(page.getByText("No products on the board yet")).toBeVisible();
    await expect(page.locator('[data-region="board"]').getByRole("link", { name: "Add a product" })).toHaveAttribute("href", `/w/${empty}/products/new`);
    await axe(page);
  });

  test("no dead controls: every link on the board and the findings view goes somewhere, and there is no button", async ({ page, context, baseURL }) => {
    test.setTimeout(120_000);
    await signIn(context, viewer, baseURL!);
    // The screen's own controls (the shell's are crawled in shell.spec.ts; its sign-out would end this session).
    for (const url of [`/w/${ws}/board`, `/w/${ws}/board?view=findings`, `/w/${ws}/board?state=action&species=dog`]) {
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
      // Filters, views and cells are all links; the board has no button of its own.
      await expect(board.locator("button")).toHaveCount(0);
      expect(errors).toEqual([]);
    }
  });
});
