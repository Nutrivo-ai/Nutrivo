// T-507: the Mobile design's reading views at 390 px (product/Nutrivo Mobile.dc.html). S-MOB-003 The verdict reads one
// product in one market under RLS: a check runs through app.request_check against the local stack's released ruleset
// (0000.00-empty, so every label result is honestly Not assessed with its gap), and a market whose registration is
// recorded as not registered reads Blocked whatever its label says (BE-14). S-MOB-004 Capture is guidance only: no
// endpoint takes or compares a pack photo yet (#57 question 1). Runs on the full local stack (scripts/ci/e2e.sh).
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { expectLikeBaseline, type Region } from "./support/baseline";
import { admin, haveStack, person, signIn, workspace, type Person } from "./support/people";
import { axe, maxDiffPixelRatio, watch } from "./support/public";

const CHECK_MS = 90_000;

/** A product with markets, and a succeeded extraction of a one-panel German artwork, as the service role writes them. */
async function seedProduct(workspaceId: string, name: string, markets: { node_id: string; registration_state?: string }[], artwork = true) {
  const service = admin().schema("app");
  const fam = await service.from("families").insert({ workspace_id: workspaceId, name }).select("id").single();
  if (fam.error) throw fam.error;
  const prod = await service
    .from("products")
    .insert({ workspace_id: workspaceId, family_id: fam.data.id, name, stage: "in_development" })
    .select("id")
    .single();
  if (prod.error) throw prod.error;
  const productId = prod.data.id;
  const nodes = await service.from("product_nodes").insert(markets.map((m) => ({ registration_state: "unknown", ...m, product_id: productId, workspace_id: workspaceId })));
  if (nodes.error) throw nodes.error;
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
  return { productId, sha };
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

// The route streams behind w/[workspace]/loading.tsx: wait for the screen's own region to be visible before reading it.
const verdict = (page: Page) => page.locator('main[data-screen="S-NV2-007"] [data-region="verdict"]').filter({ visible: true });
const capture = (page: Page) => page.locator('main[data-screen="S-MOB-004"] [data-region="capture"]').filter({ visible: true });

// S-MOB-003 and S-MOB-004 at 390 px, compared where the parts do not depend on width or on the design's own data.
// The design draws its phones about 284 px wide (spec/screens.yaml Q2, open), so the regions are the state label and
// the block kickers, each compared from its own top-left corner; titles, bodies and buttons name the design's recipe
// and markets or fill the width, so they are left to Q2 and the demo data (#57 question 2).
const S_MOB_003: Record<string, Region> = {
  stateLabel: { x: 47, y: 88, width: 70, height: 13, fractionY: 0.390625 },
  todoKicker: { x: 24, y: 243, width: 130, height: 11, fractionY: 0.90625 },
  sourceKicker: { x: 24, y: 405, width: 150, height: 11, fractionY: 0.015625 },
};
const S_MOB_004: Record<string, Region> = {
  purposeKicker: { x: 24, y: 197, width: 130, height: 11, fractionY: 0.609375 },
  title: { x: 24, y: 106, width: 200, height: 18, fractionY: 0.71875 },
};

test.describe("mobile reading views at 390 px", () => {
  test.skip(!haveStack(), "needs the local Supabase stack and the worker: run through scripts/ci/e2e.sh (make e2e)");
  test.describe.configure({ mode: "serial" });
  test.use({ viewport: { width: 390, height: 844 } });

  let editor: Person, viewer: Person, outsider: Person;
  let ws: string, productId: string, sha: string, unchecked: string;

  test.beforeAll(async () => {
    test.setTimeout(CHECK_MS + 60_000);
    [editor, viewer, outsider] = await Promise.all([person("t507-editor"), person("t507-viewer"), person("t507-outsider")]);
    ws = await workspace(editor, "Halden Mobile Test");
    await Promise.all([workspace(viewer, "Viewer's own"), workspace(outsider, "Outsider's own")]);
    const service = admin();
    const { data: v, error } = await service.schema("app").from("people").select("id").eq("user_id", viewer.userId).single();
    if (error) throw error;
    const grant = await service.schema("app").from("memberships").insert({ workspace_id: ws, person_id: v.id, role: "viewer" });
    if (grant.error) throw grant.error;
    ({ productId, sha } = (await seedProduct(ws, "Salmon & Rice Adult Dry", [
      { node_id: "EU-DE" },
      { node_id: "US-TX", registration_state: "not_registered" },
    ])) as { productId: string; sha: string });
    unchecked = (await seedProduct(ws, "Senior Joint Support Wet", [{ node_id: "EU-FR" }], false)) as string;
    await runCheck(editor, productId);
  });

  test("[T-507] S-MOB-003 the verdict: not registered reads Blocked, with the next step and where it came from", async ({ page, context, baseURL }) => {
    await signIn(context, viewer, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/products/${productId}/nodes/US-TX`);
    const v = verdict(page);
    await expect(v).toHaveAttribute("data-state", "blocked");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Salmon & Rice Adult Dry");
    await expect(v.locator('[data-glyph="blocked"]')).toBeVisible();
    await expect(v.getByText("Blocked", { exact: true })).toBeVisible();
    await expect(v.getByRole("heading", { level: 2 })).toHaveText("Cannot be sold in Texas");
    await expect(v).toContainText("The product is not registered in Texas.");
    await expect(v.getByRole("link", { name: "Open the registration pack" })).toHaveAttribute(
      "href",
      `/w/${ws}/products/${productId}/nodes/US-TX/registration`,
    );
    await expect(v.locator('[data-region="source"]')).toContainText("not registered. Not a model judgement.");
    // Pinned to its ruleset and artwork (CLAUDE.md non-negotiable 5).
    await expect(v.locator("[data-pinned]")).toContainText("ruleset 0000.00-empty · current");
    await expect(v.locator("[data-pinned]")).toContainText(`artwork ${sha.slice(0, 12)}`);
    // Every touch target is at least 44 px high, and the page never scrolls sideways.
    for (const link of await v.getByRole("link").all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await axe(page);
    expect(errors).toEqual([]);

    await expectLikeBaseline(page, v.locator('[data-region="state"] span:not([aria-hidden])').first(), "S-MOB-003", S_MOB_003.stateLabel, maxDiffPixelRatio);
    await page.reload();
    await expectLikeBaseline(page, verdict(page).locator('[data-region="todo"] p').first(), "S-MOB-003", S_MOB_003.todoKicker, maxDiffPixelRatio);
    await page.reload();
    await expectLikeBaseline(page, verdict(page).locator('[data-region="source"] p').first(), "S-MOB-003", S_MOB_003.sourceKicker, maxDiffPixelRatio);
  });

  test("[T-507] S-MOB-003 Not assessed names its coverage gap, never Clear", async ({ page, context, baseURL }) => {
    await signIn(context, viewer, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/products/${productId}/nodes/EU-DE`);
    const v = verdict(page);
    await expect(v).toHaveAttribute("data-state", "not_assessed");
    await expect(v.getByRole("heading", { level: 2 })).toHaveText("Not assessed in Germany");
    await expect(v).not.toContainText("Clear");
    await expect(v.locator('[data-glyph="clear"]')).toHaveCount(0);
    const withheld = await admin()
      .schema("app")
      .from("check_findings")
      .select("gap_id")
      .eq("product_id", productId)
      .eq("node_id", "EU-DE")
      .eq("state", "not_assessed");
    if (withheld.error) throw withheld.error;
    const gaps = new Set(withheld.data.map((f) => f.gap_id));
    expect(gaps.size).toBeGreaterThan(0);
    const gap = v.locator('[data-region="source"] [data-gap-id]');
    expect(gaps.has(await gap.getAttribute("data-gap-id"))).toBe(true);
    const href = (await gap.getByRole("link").getAttribute("href"))!;
    expect(href).toMatch(new RegExp(`^/w/${ws}/library/coverage/EU-DE#`));
    await expect(v.getByRole("link", { name: "See what is not covered" })).toHaveAttribute("href", href);
    await axe(page);
    expect(errors).toEqual([]);
  });

  test("[T-507] S-MOB-003 a region never hides a failing market inside it (BE-15)", async ({ page, context, baseURL }) => {
    await signIn(context, viewer, baseURL!);
    await page.goto(`/w/${ws}/products/${productId}/nodes/US`);
    const v = verdict(page);
    await expect(v).toHaveAttribute("data-state", "blocked");
    await expect(v).toContainText("United States shows it because Texas does");
    await v.getByRole("link", { name: "Open Texas" }).click();
    await expect(page).toHaveURL(new RegExp(`/products/${productId}/nodes/US-TX$`));
  });

  test("[T-507] S-MOB-003 states: no check yet, not a market of the product, not in the workspace, no access", async ({ page, context, baseURL }) => {
    await signIn(context, viewer, baseURL!);
    await page.goto(`/w/${ws}/products/${unchecked}/nodes/EU-FR`);
    await expect(verdict(page)).toHaveAttribute("data-state", "not_assessed");
    await expect(verdict(page)).toContainText("No check has run on this product in France yet");
    await expect(verdict(page).getByRole("link", { name: "Upload & scope" })).toHaveAttribute("href", `/w/${ws}/products/${unchecked}/check`);
    await axe(page);

    await page.goto(`/w/${ws}/products/${unchecked}/nodes/EU-DE`);
    await expect(page.getByText("This product is not sold in this market")).toBeVisible();
    await page.goto(`/w/${ws}/products/${unchecked}/nodes/not-a-node`);
    await expect(page.getByText("This product is not sold in this market")).toBeVisible();
    await page.goto(`/w/${ws}/products/${randomUUID()}/nodes/EU-DE`);
    await expect(page.getByText("This product is not in this workspace")).toBeVisible();
    await axe(page);

    // Someone outside the workspace reads nothing: RLS returns no row, and the shell says so.
    await context.clearCookies();
    await signIn(context, outsider, baseURL!);
    await page.goto(`/w/${ws}/products/${productId}/nodes/US-TX`);
    await expect(page.getByText("Cannot be sold in Texas")).toHaveCount(0);
    await expect(page.locator('[data-region="verdict"]')).toHaveCount(0);
  });

  test("[T-507] S-MOB-003 no dead controls: every link in the verdict goes somewhere", async ({ page, context, baseURL }) => {
    await signIn(context, viewer, baseURL!);
    for (const node of ["US-TX", "EU-DE", "US"]) {
      const errors = watch(page);
      await page.goto(`/w/${ws}/products/${productId}/nodes/${node}`);
      const links = verdict(page).locator("a").filter({ visible: true });
      await expect(links.first()).toBeVisible();
      const hrefs = await links.evaluateAll((els) => els.map((a) => a.getAttribute("href")));
      for (const href of new Set(hrefs)) {
        expect(href, "every link stays on the site").toMatch(/^\//);
        const response = await page.request.get(href!.split("#")[0], { maxRedirects: 0 });
        expect(response.status(), href!).toBeLessThan(400);
      }
      // The verdict's only actions are links; it has no button of its own.
      await expect(verdict(page).locator("button")).toHaveCount(0);
      expect(errors).toEqual([]);
    }
  });

  test("[T-507] S-MOB-004 capture: guidance only, no control that writes, axe and the design", async ({ page, context, baseURL }) => {
    await signIn(context, viewer, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/capture`);
    const c = capture(page);
    await expect(c.getByRole("heading", { level: 2 })).toHaveText("Photograph the panel");
    await expect(c).toContainText("it never produces a verdict");
    await expect(c).toContainText("Capture opens when photo comparison is built");
    // No endpoint takes a pack photo yet, so there is nothing to press (#57 question 1).
    await expect(page.locator("main button, main input, main a")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await axe(page);
    expect(errors).toEqual([]);

    await expectLikeBaseline(page, c.locator('[data-region="purpose"] p').first(), "S-MOB-004", S_MOB_004.purposeKicker, maxDiffPixelRatio);
    await page.reload();
    await expectLikeBaseline(page, capture(page).getByRole("heading", { level: 2 }), "S-MOB-004", S_MOB_004.title, maxDiffPixelRatio);
  });
});
