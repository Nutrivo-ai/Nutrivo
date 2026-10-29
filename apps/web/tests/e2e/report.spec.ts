// T-404: the label report (D07, S-NV2-003). A product's artwork is seeded as the extract job would write it (two printed
// panels, the German one with the design's text where it was printed), an editor runs the check through
// app.request_check, the worker evaluates it against the released ruleset (T-403), and a viewer reads the results:
// one set per market × printed language panel, every Not assessed linked to its coverage gap. Runs on the full local
// stack (scripts/ci/e2e.sh). The local stack releases only 0000.00-empty, so every result is honestly Not assessed.
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { expectLikeBaseline, type Region } from "./support/baseline";
import { admin, haveStack, person, signIn, workspace, type Person } from "./support/people";
import { axe, maxDiffPixelRatio, watch } from "./support/public";

const CHECK_MS = 90_000;
const MARKETS = ["EU-AT", "EU-BE", "EU-DE", "EU-FR"];

// The German panel of Salmon & Rice as printed (the demo seed's, supabase/tests/app/fixtures/demo_halden.psql).
const GERMAN: [string, number[]][] = [
  ["Alleinfuttermittel für ausgewachsene Hunde", [8, 14, 97, 22]],
  ["Für Haut und Fell", [8, 36, 60, 44]],
  ["Zusammensetzung: Lachs (26 %), Reis, Geflügelfett, Rübentrockenschnitzel, Leinsamen, Hefe", [8, 60, 97, 74]],
  ["Analytische Bestandteile", [8, 80, 62, 85]],
  ["Rohprotein 26,0 % · Rohfett 15,0 % · Rohfaser 2,4 % · Rohasche 7,1 %", [8, 86, 97, 92]],
  ["Ernährungsphysiologische Zusatzstoffe: Vitamin A 18 000 IE, Zink (Chelat) 180 mg", [8, 98, 97, 108]],
  ["Fütterungsempfehlung nach Körpergewicht. Frisches Wasser bereitstellen.", [8, 120, 97, 130]],
  ["12 kg ℮ · L2608-114 · MHD 11/2027", [8, 250, 70, 256]],
  ["Nutrivo GmbH, Musterstraße 4, 20095 Hamburg · Zul.-Nr. αDE0114", [8, 262, 97, 268]],
];

/** A product with its markets and a succeeded extraction of a two-panel artwork, as the service role writes them. */
async function seedProduct(workspaceId: string, name: string, markets: string[]) {
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
  if (markets.length) {
    const nodes = await service.from("product_nodes").insert(markets.map((node_id) => ({ product_id: productId, node_id, workspace_id: workspaceId })));
    if (nodes.error) throw nodes.error;
  }
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
  const base = { workspace_id: workspaceId, product_id: productId, artwork_version_id: av.data.id, extraction_run_id: run.data.id };
  const panels = await service
    .from("artwork_panels")
    .insert([
      { ...base, page: 1, panel_index: 0, bbox_mm: [0, 0, 105, 297], language: "de", language_confidence: 0.99, status: "extracted" },
      { ...base, page: 1, panel_index: 1, bbox_mm: [105, 0, 210, 297], language: "fr", language_confidence: 0.99, status: "extracted" },
    ])
    .select("id, language");
  if (panels.error) throw panels.error;
  const de = panels.data.find((p) => p.language === "de")!.id;
  const text = await service.from("text_objects").insert(
    GERMAN.map(([t, bbox], i) => ({
      workspace_id: workspaceId,
      product_id: productId,
      panel_id: de,
      text: t,
      bbox_mm: bbox,
      font_name: "Inter",
      font_size_pt: 9,
      x_height_mm: 1.6,
      cap_height_mm: 2.2,
      is_ocr: false,
      confidence: 1,
      reading_order: i + 1,
    })),
  );
  if (text.error) throw text.error;
  return productId;
}

/** Runs the check as `editor` through app.request_check and waits for the worker to finish it. */
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
  return jobId as string;
}

async function databaseSets(productId: string) {
  const service = admin().schema("app");
  const nodes = await service.from("product_nodes").select("last_check_job_id").eq("product_id", productId);
  if (nodes.error) throw nodes.error;
  const jobs = [...new Set(nodes.data.map((n) => n.last_check_job_id).filter((j): j is string => !!j))];
  const checks = await service.from("checks").select("id, node_id, language").eq("product_id", productId).in("job_id", jobs);
  if (checks.error) throw checks.error;
  const findings = await service.from("check_findings").select("id, check_id, state, gap_id").in("check_id", checks.data.map((c) => c.id));
  if (findings.error) throw findings.error;
  return { checks: checks.data, findings: findings.data };
}

const report = (page: Page) => page.locator('[data-screen="S-NV2-003"]');
const tabs = (page: Page) => page.getByRole("group", { name: "Language" }).getByRole("button");
const findingsPanel = (page: Page) => page.locator('[data-region="findings"]');

// S-NV2-003 at 1600 px, compared where T-404 has the data. Left out until their tasks or decisions land (#46 question
// 3): every verdict-coloured region (market tiles, finding rows, pin colours), the ruleset chip, the switcher's tabs
// (one per market × panel of the seeded product), the artwork's own drawing (#46 question 2), the Compliance Worker
// panel (LATER, #24), "What you must register" (D08) and Issue Certificate of Check.
const S_NV2_003: Record<string, Region> = {
  // The switcher row's first line: "ARTWORK · DE PANEL" and "LANGUAGE" (the tabs wrap below it, as in the design).
  artworkLabel: { x: 242, y: 188, width: 528, height: 22, fractionY: 0.546875 },
  // The findings column's heading and its rule, without the count at its right.
  findingsHeading: { x: 790, y: 188, width: 240, height: 26, fractionY: 0.546875 },
};

test.describe("label report", () => {
  test.skip(!haveStack(), "needs the local Supabase stack and the worker: run through scripts/ci/e2e.sh (make e2e)");
  test.describe.configure({ mode: "serial" });

  let editor: Person, viewer: Person;
  let ws: string, productId: string;

  test.beforeAll(async () => {
    test.setTimeout(CHECK_MS + 60_000);
    [editor, viewer] = await Promise.all([person("t404-editor"), person("t404-viewer")]);
    ws = await workspace(editor, "Halden Report Test");
    await workspace(viewer, "Viewer's own"); // app.people rows are made by the RPCs; this one makes the viewer's
    const service = admin();
    const { data: v, error } = await service.schema("app").from("people").select("id").eq("user_id", viewer.userId).single();
    if (error) throw error;
    const grant = await service.schema("app").from("memberships").insert({ workspace_id: ws, person_id: v.id, role: "viewer" });
    if (grant.error) throw grant.error;
    productId = await seedProduct(ws, "Salmon & Rice Adult Dry", MARKETS);
    await runCheck(editor, productId);
  });

  test("[D07.main] View the results: the main path works end to end", async ({ page, context, baseURL }) => {
    await signIn(context, viewer, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/products/${productId}/report`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Salmon & Rice Adult Dry · 4 jurisdiction nodes, 2 languages");
    await expect(report(page)).toBeVisible();

    // A tile per market, each with its state's glyph and name; nothing is Clear against an empty ruleset.
    const tiles = page.locator('[data-region="markets"] [data-node]');
    await expect(tiles).toHaveCount(MARKETS.length);
    await expect(tiles.filter({ hasText: "Clear" })).toHaveCount(0);
    await expect(tiles.locator('[data-glyph="not_assessed"]')).toHaveCount(MARKETS.length);

    // The German panel's text is drawn where it was printed, and the check is pinned to its ruleset and artwork.
    await expect(tabs(page).first()).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Artwork · AT-DE panel")).toBeVisible();
    await expect(page.locator("[data-text-object]")).toHaveCount(GERMAN.length);
    await expect(page.locator("[data-text-object]").first()).toContainText("Alleinfuttermittel");
    await expect(page.locator("[data-pinned]")).toContainText("Ruleset 0000.00-empty");
    await expect(page.getByText("RULESET 0000.00-empty · current")).toBeVisible();

    // Germany's German panel: its tab is the language alone, and its market tile is marked current.
    await tabs(page).filter({ hasText: /^DE$/ }).click();
    await expect(page.getByText("Artwork · DE panel")).toBeVisible();
    await expect(page.locator('[data-node="EU-DE"]')).toHaveAttribute("aria-current", "true");
    await expect(page.locator('[data-node="EU-DE"]')).toHaveAttribute("href", `/w/${ws}/products/${productId}/nodes/EU-DE`);
    await expect(findingsPanel(page).locator('[data-finding-state="not_assessed"]').first()).toBeVisible();
    await expect(findingsPanel(page).locator('[data-finding-state="action"]')).toHaveCount(0);

    // The French panel has no text objects seeded: an empty drawing, never an invented one.
    await tabs(page).filter({ hasText: /^DE-FR$/ }).click();
    await expect(page.getByText("Artwork · DE-FR panel")).toBeVisible();
    await expect(page.locator("[data-text-object]")).toHaveCount(0);
    await expect(page.getByText(/no text extracted/i)).toBeVisible();

    await axe(page);
    expect(errors).toEqual([]);

    // The design baseline, where this task has the data (#46 question 3).
    await tabs(page).filter({ hasText: /^DE$/ }).click();
    await expectLikeBaseline(page, report(page).locator('[data-region="switcher"]'), "S-NV2-003", S_NV2_003.artworkLabel, maxDiffPixelRatio);
    await expectLikeBaseline(page, findingsPanel(page), "S-NV2-003", S_NV2_003.findingsHeading, maxDiffPixelRatio);
  });

  test("[D07.must.1] One result set per language panel: each tab shows exactly its own check's findings", async ({ page, context, baseURL }) => {
    const db = await databaseSets(productId);
    // Two printed panels in four markets: eight checks, so eight sets.
    expect(db.checks).toHaveLength(MARKETS.length * 2);
    await signIn(context, viewer, baseURL!);
    await page.goto(`/w/${ws}/products/${productId}/report`);
    await expect(tabs(page)).toHaveCount(db.checks.length);
    const seen = new Set<string>();
    for (let i = 0; i < db.checks.length; i++) {
      const tab = tabs(page).nth(i);
      await tab.click();
      await expect(tab).toHaveAttribute("aria-pressed", "true");
      const checkId = await tab.getAttribute("data-check-id");
      expect(seen.has(checkId!)).toBe(false);
      seen.add(checkId!);
      const check = db.checks.find((c) => c.id === checkId)!;
      expect(check, `tab ${i} names a check of the latest job`).toBeTruthy();
      await expect(findingsPanel(page)).toHaveAttribute("data-check-id", checkId!);
      const own = db.findings.filter((f) => f.check_id === checkId && f.state !== "info");
      await expect(findingsPanel(page).locator("[data-finding-state]")).toHaveCount(own.length);
      await expect(findingsPanel(page).getByText(`${own.length} finding${own.length === 1 ? "" : "s"}`)).toBeVisible();
    }
    expect(seen.size).toBe(db.checks.length);
  });

  test("[D07.must.2] Every Not assessed links to its gap", async ({ page, context, baseURL }) => {
    const db = await databaseSets(productId);
    await signIn(context, viewer, baseURL!);
    await page.goto(`/w/${ws}/products/${productId}/report`);
    await expect(tabs(page)).toHaveCount(db.checks.length);
    const gaps = await admin().schema("ref").from("coverage_gaps").select("gap_id, node_id");
    if (gaps.error) throw gaps.error;
    const nodeOf = new Map(gaps.data.map((g) => [g.gap_id, g.node_id]));
    let linked = 0;
    for (let i = 0; i < (await tabs(page).count()); i++) {
      const tab = tabs(page).nth(i);
      await tab.click();
      const checkId = (await tab.getAttribute("data-check-id"))!;
      const withheld = db.findings.filter((f) => f.check_id === checkId && f.state === "not_assessed");
      const rows = findingsPanel(page).locator('[data-finding-state="not_assessed"]');
      await expect(rows).toHaveCount(withheld.length);
      for (const f of withheld) {
        expect(f.gap_id, "the engine gives every coverage withhold its gap").toBeTruthy();
        const link = findingsPanel(page).locator(`[data-gap-id="${f.gap_id}"] a`);
        await expect(link).toHaveAttribute("href", `/w/${ws}/library/coverage/${nodeOf.get(f.gap_id!)}#${f.gap_id}`);
        linked++;
      }
    }
    expect(linked).toBe(db.findings.filter((f) => f.state === "not_assessed").length);
    expect(linked).toBeGreaterThan(0);

    // The link opens the coverage node that names the gap.
    const first = findingsPanel(page).locator("[data-gap-id] a").first();
    const href = (await first.getAttribute("href"))!;
    await first.click();
    await expect(page).toHaveURL(new RegExp(`${href.split("#")[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  });

  test("the report's states: no check yet, a product not in the workspace, and no dead controls", async ({ page, context, baseURL }) => {
    const unchecked = await seedProduct(ws, "Senior Joint Support Wet", ["EU-DE"]);
    await signIn(context, viewer, baseURL!);
    await page.goto(`/w/${ws}/products/${unchecked}/report`);
    await expect(page.getByText("No check has run on this product yet")).toBeVisible();
    await expect(page.getByRole("link", { name: "Upload & scope" })).toHaveAttribute("href", `/w/${ws}/products/${unchecked}/check`);
    await axe(page);

    await page.goto(`/w/${ws}/products/${randomUUID()}/report`);
    await expect(page.getByText(/This product is not in/)).toBeVisible();

    // No dead controls (docs/20 §4) in the report itself; the shell's own controls are crawled by its tests.
    const url = `/w/${ws}/products/${productId}/report`;
    const errors = watch(page);
    await page.goto(url);
    await expect(report(page)).toBeVisible();
    const hrefs = await page.locator("main a").filter({ visible: true }).evaluateAll((links) => links.map((a) => a.getAttribute("href")));
    expect(hrefs.length).toBeGreaterThan(MARKETS.length);
    for (const href of new Set(hrefs)) {
      expect(href, "every link in the report stays on the site").toMatch(/^\//);
      const response = await page.request.get(href!.split("#")[0], { maxRedirects: 0 });
      expect(response.status(), href!).toBeLessThan(400);
    }
    const buttons = page.locator("main button").filter({ visible: true });
    const count = await buttons.count();
    expect(count).toBe(MARKETS.length * 2);
    for (const i of [...Array(count).keys()].reverse()) {
      const button = buttons.nth(i);
      const before = await findingsPanel(page).getAttribute("data-check-id");
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
      if (i !== count - 1) expect(await findingsPanel(page).getAttribute("data-check-id")).not.toBe(before);
    }
    expect(errors).toEqual([]);
  });
});
