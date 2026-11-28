// T-1109: S-MOB-002 One recipe, its markets (`/w/[workspace]/products/[product]`), the product page the board links
// to. A product sold in Germany, France, US federal and Texas has a one-panel German artwork extracted as the extract
// job writes it; an editor runs the check through app.request_check and the worker evaluates it against the local
// stack's released ruleset (0000.00-empty, so every label result is honestly Not assessed with its gap). Texas is then
// recorded as not registered, so it reads Blocked and so does the US roll-up (BE-15). Run at 390 px (the design's
// phone) and at 1600 px. Runs on the full local stack (scripts/ci/e2e.sh).
//
// States: loaded, empty (no markets), never checked, not found and no permission (RLS returns no row) are here;
// loading is the workspace loading.tsx and error the workspace error boundary, both covered in shell.spec.ts.
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { expectLikeBaseline, type Region } from "./support/baseline";
import { allResultSets, fixReport } from "./support/fix";
import { admin, haveStack, person, signIn, workspace, type Person } from "./support/people";
import { axe, maxDiffPixelRatio, watch } from "./support/public";

const CHECK_MS = 90_000;
const MARKETS = ["EU-DE", "EU-FR", "US-FED", "US-TX"];

/** A product with markets, and optionally a succeeded extraction of a one-panel German artwork, as the service role writes them. */
async function seedProduct(workspaceId: string, name: string, markets: string[], artwork: boolean) {
  const service = admin().schema("app");
  const fam = await service.from("families").insert({ workspace_id: workspaceId, name }).select("id").single();
  if (fam.error) throw fam.error;
  const prod = await service
    .from("products")
    .insert({ workspace_id: workspaceId, family_id: fam.data.id, name, stage: "active", species: "dog", life_stage: "adult", format: "complete dry" })
    .select("id")
    .single();
  if (prod.error) throw prod.error;
  const productId = prod.data.id;
  if (markets.length) {
    const nodes = await service
      .from("product_nodes")
      .insert(markets.map((node_id) => ({ node_id, registration_state: "unknown", product_id: productId, workspace_id: workspaceId })));
    if (nodes.error) throw nodes.error;
  }
  if (!artwork) return productId;
  const sha = randomUUID().replace(/-/g, "").padEnd(64, "0");
  const av = await service
    .from("artwork_versions")
    .insert({
      workspace_id: workspaceId,
      product_id: productId,
      version: 1,
      file_sha256: sha,
      storage_path: `${workspaceId}/${productId}/${sha}.pdf`,
      file_name: "SR-ADULT-12KG-v7.pdf",
      mime_type: "application/pdf",
      page_count: 1,
      is_new_artwork: true,
    })
    .select("id")
    .single();
  if (av.error) throw av.error;
  const run = await service
    .from("extraction_runs")
    .insert({
      workspace_id: workspaceId,
      product_id: productId,
      artwork_version_id: av.data.id,
      engine: "pdfium",
      engine_version: "e2e",
      idempotency_key: `e2e:${av.data.id}`,
      status: "succeeded",
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (run.error) throw run.error;
  const panel = await service
    .from("artwork_panels")
    .insert({
      workspace_id: workspaceId,
      product_id: productId,
      artwork_version_id: av.data.id,
      extraction_run_id: run.data.id,
      page: 1,
      panel_index: 0,
      bbox_mm: [0, 0, 105, 297],
      language: "de",
      language_confidence: 0.99,
      status: "extracted",
    })
    .select("id")
    .single();
  if (panel.error) throw panel.error;
  const text = await service.from("text_objects").insert({
    workspace_id: workspaceId,
    product_id: productId,
    panel_id: panel.data.id,
    text: "Alleinfuttermittel für ausgewachsene Hunde",
    bbox_mm: [8, 14, 97, 22],
    font_name: "Inter",
    font_size_pt: 9,
    x_height_mm: 1.6,
    cap_height_mm: 2.2,
    is_ocr: false,
    confidence: 1,
    reading_order: 1,
  });
  if (text.error) throw text.error;
  return productId;
}

async function runCheck(editor: Person, productId: string) {
  const { data: jobId, error } = await editor.db.schema("app").rpc("request_check", { p_product: productId });
  if (error) throw error;
  await expect
    .poll(
      async () => {
        const job = await admin().schema("app").from("jobs").select("status").eq("id", jobId).single();
        if (job.error) throw job.error;
        return job.data.status;
      },
      { timeout: CHECK_MS, intervals: [500, 1000, 2000] },
    )
    .toBe("succeeded");
}

/** The checks of each market's latest check job, and their findings, as the database holds them. */
async function latestChecks(productId: string) {
  const service = admin().schema("app");
  const nodes = await service.from("product_nodes").select("node_id, last_check_job_id").eq("product_id", productId);
  if (nodes.error) throw nodes.error;
  const jobs = [...new Set(nodes.data.map((n) => n.last_check_job_id).filter((j): j is string => !!j))];
  const checks = await service.from("checks").select("id, node_id").eq("product_id", productId).in("job_id", jobs);
  if (checks.error) throw checks.error;
  const findings = await service.from("check_findings").select("node_id, state, gap_id").in("check_id", checks.data.map((c) => c.id));
  if (findings.error) throw findings.error;
  return { checks: checks.data, findings: findings.data };
}

// The route streams behind w/[workspace]/loading.tsx: wait for the screen's own region before reading it.
const markets = (page: Page) => page.locator('main[data-screen="S-MOB-002"] [data-region="markets"]').filter({ visible: true });
const row = (page: Page, node: string) => markets(page).locator(`li[data-node="${node}"]`);

// S-MOB-002 at 390 px, compared where the part depends neither on width nor on the design's own recipe: the Checked
// kicker, from its own top-left corner. The recipe kicker names a flavour that is stored nowhere, the title counts the
// design's markets, and the rows fill the width (spec/screens.yaml Q2: the design's phone is about 284 px wide).
const S_MOB_002: Record<string, Region> = {
  checkedKicker: { x: 24, y: 280, width: 70, height: 11, fractionY: 0.78125 },
};

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1600, height: 1000 },
]) {
  test.describe(`S-MOB-002 one recipe, its markets at ${viewport.width} px`, () => {
    test.skip(!haveStack(), "needs the local Supabase stack and the worker: run through scripts/ci/e2e.sh (make e2e)");
    test.describe.configure({ mode: "serial" });
    test.use({ viewport });
    const w = viewport.width;

    let editor: Person, viewer: Person, outsider: Person;
    let ws: string, productId: string, unchecked: string, bare: string;

    test.beforeAll(async () => {
      test.setTimeout(CHECK_MS + 60_000);
      [editor, viewer, outsider] = await Promise.all([person(`t1109-editor-${w}`), person(`t1109-viewer-${w}`), person(`t1109-outsider-${w}`)]);
      ws = await workspace(editor, "Halden Markets Test");
      // Its products are sold in the US, so the plan holds the US (private.check_markets; J04.must.1).
      const plan = await admin().schema("app").from("workspaces").update({ entitled_regions: ["EU", "US"] }).eq("id", ws).select("id");
      if (plan.error) throw plan.error;
      await Promise.all([workspace(viewer, "Viewer's own"), workspace(outsider, "Outsider's own")]);
      const { data: v, error } = await admin().schema("app").from("people").select("id").eq("user_id", viewer.userId).single();
      if (error) throw error;
      const grant = await admin().schema("app").from("memberships").insert({ workspace_id: ws, person_id: v.id, role: "viewer" });
      if (grant.error) throw grant.error;
      productId = await seedProduct(ws, "Salmon & Rice Adult Dry", MARKETS, true);
      unchecked = await seedProduct(ws, "Senior Joint Support Wet", ["EU-FR"], false);
      bare = await seedProduct(ws, "Puppy Turkey Wet", [], false);
      await runCheck(editor, productId);
      // A check re-derives registration_state (D06), and not_registered needs an accepted, sourced obligation, which none
      // is until #54 Q4: the state this screen reads is set after the check, as the fixture it is (mobile.spec.ts).
      const texas = await admin()
        .schema("app")
        .from("product_nodes")
        .update({ registration_state: "not_registered" })
        .eq("product_id", productId)
        .eq("node_id", "US-TX");
      if (texas.error) throw texas.error;
    });

    test(`[F01.main] [T-1109] ${w} px: the board opens the recipe, its markets by region, each opening its verdict`, async ({ page, context, baseURL }) => {
      await signIn(context, viewer, baseURL!);
      const errors = watch(page);
      await page.goto(`/w/${ws}/board`);
      await page.locator(`a[href="/w/${ws}/products/${productId}"]`).filter({ visible: true }).first().click();
      await expect(page).toHaveURL(new RegExp(`/w/${ws}/products/${productId}$`));
      const m = markets(page);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Salmon & Rice Adult Dry");
      await expect(m.locator('[data-region="recipe"] p').first()).toHaveText("Adult dog · complete dry");
      await expect(m.getByRole("heading", { level: 2 })).toHaveText("Four markets");
      // Each region first, as the database rolls it up, then its markets, in order.
      expect(await m.locator("li[data-node]").evaluateAll((els) => els.map((e) => e.getAttribute("data-node")))).toEqual([
        "EU",
        "EU-DE",
        "EU-FR",
        "US",
        "US-FED",
        "US-TX",
      ]);
      await expect(row(page, "US-TX")).toHaveAttribute("data-state", "blocked");
      await expect(row(page, "US-TX")).toContainText("US · Texas");
      await expect(row(page, "US-TX")).toContainText("Blocked");
      await expect(row(page, "US-FED")).toContainText("US · federal");
      // Every state shows its glyph, never colour alone.
      for (const li of await m.locator("li[data-node]").all()) {
        await expect(li.locator(`[data-glyph="${await li.getAttribute("data-state")}"]`)).toBeVisible();
      }
      // Pinned to its ruleset (CLAUDE.md non-negotiable 5).
      await expect(m.locator("[data-checked]")).toHaveAttribute("data-checked", "checked");
      await expect(m.locator("[data-checked]")).toContainText("against ruleset 0000.00-empty. Current.");
      // Every touch target is at least 44 px high, and the page never scrolls sideways.
      for (const link of await m.getByRole("link").all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
      await axe(page);

      await row(page, "US-TX").getByRole("link").click();
      await expect(page).toHaveURL(new RegExp(`/products/${productId}/nodes/US-TX$`));
      await expect(page.locator('[data-region="verdict"]').filter({ visible: true })).toHaveAttribute("data-state", "blocked");
      expect(errors).toEqual([]);

      if (w === 390) {
        await page.goto(`/w/${ws}/products/${productId}`);
        await expectLikeBaseline(page, markets(page).locator('[data-region="checked"] p').first(), "S-MOB-002", S_MOB_002.checkedKicker, maxDiffPixelRatio);
      }
    });

    test(`[F01.must.1] [T-1109] ${w} px: a region is never better than its worst market, as the database rolls it up`, async ({ page, context, baseURL }) => {
      await signIn(context, viewer, baseURL!);
      await page.goto(`/w/${ws}/products/${productId}`);
      // Every region row shows exactly what app.rollup_state answers for this product × region, read as the viewer.
      for (const region of ["EU", "US"]) {
        const { data, error } = await viewer.db.schema("app").rpc("rollup_state", { p_product: productId, p_node: region });
        expect(error).toBeNull();
        await expect(row(page, region)).toHaveAttribute("data-state", data!);
      }
      // Texas is Blocked and US federal is not, so the US reads Blocked, never better.
      await expect(row(page, "US-FED")).not.toHaveAttribute("data-state", "blocked");
      await expect(row(page, "US")).toHaveAttribute("data-state", "blocked");
      // The region opens its verdict, which names the market that sets it.
      await row(page, "US").getByRole("link").click();
      await expect(page).toHaveURL(new RegExp(`/products/${productId}/nodes/US$`));
      await expect(page.locator('[data-region="verdict"]').filter({ visible: true })).toContainText("United States shows it because Texas does");
    });

    test(`[D07.main] [T-1109] ${w} px: from the recipe to its label report`, async ({ page, context, baseURL }) => {
      await signIn(context, viewer, baseURL!);
      const errors = watch(page);
      await page.goto(`/w/${ws}/products/${productId}`);
      await markets(page).getByRole("link", { name: "Every finding, on the label report" }).click();
      await expect(page).toHaveURL(new RegExp(`/products/${productId}/report$`));
      await expect(fixReport(page)).toBeVisible();
      await expect(page.locator('[data-region="findings"] [data-finding-state="not_assessed"]').first()).toBeVisible();
      expect(errors).toEqual([]);
    });

    test(`[D07.must.1] [T-1109] ${w} px: the recipe's report has one result set per market × language panel`, async ({ page, context, baseURL }) => {
      const db = await latestChecks(productId);
      // One printed German panel in four markets: four checks, so four result sets.
      expect(db.checks).toHaveLength(MARKETS.length);
      await signIn(context, viewer, baseURL!);
      await page.goto(`/w/${ws}/products/${productId}`);
      await markets(page).getByRole("link", { name: "Every finding, on the label report" }).click();
      // Fix mode (T-1114): each market shows one panel per check of its latest job, each its own result set.
      await expect(fixReport(page)).toBeVisible();
      const sets = await allResultSets(page);
      expect(sets.map((s) => s.checkId).sort()).toEqual(db.checks.map((c) => c.id).sort());
    });

    test(`[D07.must.2] [T-1109] ${w} px: every Not assessed market opens a verdict that links to its gap`, async ({ page, context, baseURL }) => {
      const db = await latestChecks(productId);
      await signIn(context, viewer, baseURL!);
      await page.goto(`/w/${ws}/products/${productId}`);
      await expect(markets(page)).toBeVisible();
      const withheld = await markets(page).locator('li[data-kind="market"][data-state="not_assessed"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-node")!));
      expect(withheld.length, "Germany, France and US federal are withheld on the empty ruleset").toBe(3);
      for (const node of withheld) {
        await page.goto(`/w/${ws}/products/${productId}`);
        await row(page, node).getByRole("link").click();
        await expect(page).toHaveURL(new RegExp(`/products/${productId}/nodes/${node}$`));
        const gap = page.locator('[data-region="verdict"] [data-region="source"] [data-gap-id]').filter({ visible: true });
        const gapIds = new Set(db.findings.filter((f) => f.node_id === node && f.state === "not_assessed").map((f) => f.gap_id));
        expect(gapIds.has(await gap.getAttribute("data-gap-id"))).toBe(true);
        expect(await gap.getByRole("link").getAttribute("href")).toMatch(new RegExp(`^/w/${ws}/library/coverage/${node}#`));
      }
    });

    test(`[T-1109] ${w} px: states: never checked, no markets, not in the workspace, no access`, async ({ page, context, baseURL }) => {
      await signIn(context, viewer, baseURL!);
      const errors = watch(page);
      await page.goto(`/w/${ws}/products/${unchecked}`);
      await expect(markets(page).getByRole("heading", { level: 2 })).toHaveText("One market");
      await expect(row(page, "EU-FR")).toHaveAttribute("data-state", "not_assessed");
      await expect(markets(page)).not.toContainText("Clear");
      await expect(markets(page).locator("[data-checked]")).toHaveText("No check has run on this product yet, so no market has a verdict.");
      await expect(markets(page).getByRole("link", { name: "Upload & scope" })).toHaveAttribute("href", `/w/${ws}/products/${unchecked}/check`);
      await axe(page);

      await page.goto(`/w/${ws}/products/${bare}`);
      await expect(page.getByText("This product is not sold in any market yet")).toBeVisible();
      await expect(page.getByRole("link", { name: "Upload & scope" })).toHaveAttribute("href", `/w/${ws}/products/${bare}/check`);
      await axe(page);

      await page.goto(`/w/${ws}/products/${randomUUID()}`);
      await expect(page.getByText("This product is not in this workspace")).toBeVisible();
      await page.goto(`/w/${ws}/products/not-a-product`);
      await expect(page.getByText("This product is not in this workspace")).toBeVisible();
      await axe(page);
      expect(errors).toEqual([]);

      // Someone outside the workspace reads nothing: RLS returns no row, and nothing of the product is shown.
      await context.clearCookies();
      await signIn(context, outsider, baseURL!);
      await page.goto(`/w/${ws}/products/${productId}`);
      await expect(page.getByText("Salmon & Rice Adult Dry")).toHaveCount(0);
      await expect(page.locator('[data-region="markets"]')).toHaveCount(0);
    });

    test(`[T-1109] ${w} px: no dead controls: every link on the page goes somewhere, and it has no button`, async ({ page, context, baseURL }) => {
      await signIn(context, viewer, baseURL!);
      for (const id of [productId, unchecked]) {
        const errors = watch(page);
        await page.goto(`/w/${ws}/products/${id}`);
        const links = markets(page).locator("a").filter({ visible: true });
        await expect(links.first()).toBeVisible();
        const hrefs = await links.evaluateAll((els) => els.map((a) => a.getAttribute("href")));
        for (const href of new Set(hrefs)) {
          expect(href, "every link stays on the site").toMatch(/^\//);
          const response = await page.request.get(href!.split("#")[0], { maxRedirects: 0 });
          expect(response.status(), href!).toBeLessThan(400);
        }
        await expect(markets(page).locator("button")).toHaveCount(0);
        expect(errors).toEqual([]);
      }
    });
  });
}
