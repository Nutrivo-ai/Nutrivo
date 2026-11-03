// T-505: re-check a new artwork version (D08) and view coverage for a product (D09). A product's first artwork is
// seeded as the extract job writes it; the editor runs the check from Upload & scope ("Run the check", which calls
// app.request_check), uploads a revision through the screen (signed upload, register_artwork, the worker's real
// extraction) on a free workspace whose three labels are all used, and checks it again. A viewer then reads the
// product's coverage from the report, down to a node and its gaps. Runs on the full local stack (scripts/ci/e2e.sh);
// the local stack releases only 0000.00-empty, so every market is Not encoded and every result Not assessed.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { REPO_ROOT } from "../visual/screens";
import { expectLikeBaseline, type Region } from "./support/baseline";
import { admin, haveStack, person, signIn, workspace, type Person } from "./support/people";
import { axe, maxDiffPixelRatio, watch } from "./support/public";

const STEP_MS = 90_000;
const MARKETS = ["EU-AT", "EU-DE"];
const EMPTY = "0000.00-empty";

function synthetic(name: string) {
  const file = path.join(REPO_ROOT, "fixtures/synth/out", `${name}.pdf`);
  if (!fs.existsSync(file)) {
    // The synthetic labels are generated, never committed (fixtures/synth/README.md).
    execFileSync("uv", ["run", "python", "../fixtures/synth/generate.py", "--out", "../fixtures/synth/out"], {
      cwd: path.join(REPO_ROOT, "worker"),
      stdio: "inherit",
    });
  }
  return file;
}

/** A product with its markets and a succeeded extraction of a one-panel German artwork, as the service role writes it. */
async function seedProduct(workspaceId: string, name: string, markets: string[], withArtwork = true) {
  const service = admin().schema("app");
  const fam = await service.from("families").insert({ workspace_id: workspaceId, name }).select("id").single();
  if (fam.error) throw fam.error;
  const prod = await service
    .from("products")
    .insert({ workspace_id: workspaceId, family_id: fam.data.id, name, stage: "in_development" })
    .select("id")
    .single();
  if (prod.error) throw prod.error;
  const productId = prod.data.id as string;
  if (markets.length) {
    const nodes = await service.from("product_nodes").insert(markets.map((node_id) => ({ product_id: productId, node_id, workspace_id: workspaceId })));
    if (nodes.error) throw nodes.error;
  }
  if (!withArtwork) return productId;
  const sha = randomUUID().replace(/-/g, "").padEnd(64, "0");
  const av = await service
    .from("artwork_versions")
    .insert({
      workspace_id: workspaceId,
      product_id: productId,
      version: 1,
      file_sha256: sha,
      storage_path: `${workspaceId}/${productId}/${sha}.pdf`,
      file_name: "salmon-rice-12kg-v6.pdf",
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

async function checksOf(productId: string) {
  const service = admin().schema("app");
  const checks = await service
    .from("checks")
    .select("id, job_id, node_id, panel_id, language, label_state, ruleset_version, artwork_version_id, artwork_sha, at")
    .eq("product_id", productId)
    .order("id");
  if (checks.error) throw checks.error;
  const findings = await service
    .from("check_findings")
    .select("id, check_id, state, provenance, rule_key, gap_id, reason_code, message")
    .in("check_id", checks.data.map((c) => c.id))
    .order("id");
  if (findings.error) throw findings.error;
  return { checks: checks.data, findings: findings.data };
}

async function versionsOf(productId: string) {
  const v = await admin().schema("app").from("artwork_versions").select("id, version, file_sha256, is_new_artwork").eq("product_id", productId).order("version");
  if (v.error) throw v.error;
  return v.data;
}

async function allowanceOf(ws: string) {
  const a = await admin().schema("app").from("allowances").select("labels_used, labels_allowed").eq("workspace_id", ws).single();
  if (a.error) throw a.error;
  return a.data;
}

const short = (sha: string) => `${sha.slice(0, 4)}…${sha.slice(-4)}`;
const bar = (page: Page) => page.locator("[data-run-check]");

/** Runs the check from the bar and waits for the job to finish on screen. */
async function runFromBar(page: Page) {
  await expect(bar(page).getByRole("button", { name: "Run the check" })).toBeEnabled();
  await bar(page).getByRole("button", { name: "Run the check" }).click();
  await expect(bar(page).locator("[data-check-done]")).toBeVisible({ timeout: STEP_MS });
  await expect(bar(page).getByRole("link", { name: "Open the report" })).toBeVisible();
}

// Design baselines at 1600 px, where this task has the data (#55). S-NV2-002: the bar's button. The button's left edge
// falls at x 1031.8 in both, so the region starts at the whole pixel before it.
const S_NV2_002: Record<string, Region> = {
  button: { x: 1031, y: 760, width: 159, height: 52, fractionY: 0.5 },
};

test.describe("re-check a revision, and coverage per product", () => {
  test.skip(!haveStack(), "needs the local Supabase stack and the worker: run through scripts/ci/e2e.sh (make e2e)");
  test.describe.configure({ mode: "serial" });

  let editor: Person, viewer: Person;
  let ws: string, productId: string;
  let first: Awaited<ReturnType<typeof checksOf>>;
  let allowanceBefore: { labels_used: number; labels_allowed: number };

  test.beforeAll(async () => {
    [editor, viewer] = await Promise.all([person("t505-editor"), person("t505-viewer")]);
    ws = await workspace(editor, "Halden Recheck Test");
    await workspace(viewer, "Viewer's own"); // app.people rows are made by the RPCs; this one makes the viewer's
    const service = admin();
    const { data: v, error } = await service.schema("app").from("people").select("id").eq("user_id", viewer.userId).single();
    if (error) throw error;
    const grant = await service.schema("app").from("memberships").insert({ workspace_id: ws, person_id: v.id, role: "viewer" });
    if (grant.error) throw grant.error;
    productId = await seedProduct(ws, "Salmon & Rice Adult Dry", MARKETS);
    // The free plan with every one of its new labels used: a new artwork would be refused (P0032), a revision is not.
    const used = await service.schema("app").from("allowances").update({ labels_used: 3 }).eq("workspace_id", ws).select("labels_used");
    if (used.error) throw used.error;
    expect(used.data).toHaveLength(1);
    allowanceBefore = await allowanceOf(ws);
    expect(allowanceBefore.labels_used).toBeGreaterThanOrEqual(allowanceBefore.labels_allowed);
  });

  test("[D08.main] Re-check a new artwork version: the main path works end to end", async ({ page, context, baseURL }) => {
    test.setTimeout(STEP_MS * 3 + 60_000);
    await signIn(context, editor, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/products/${productId}/check`);
    await expect(bar(page).getByRole("heading", { level: 2 })).toHaveText("1 product × 2 jurisdiction nodes × 1 language, answered in one pass");
    await expect(bar(page)).toContainText("Re-check as often as you like. Checks are never metered.");
    await axe(page);

    // The first check, of version 1.
    await runFromBar(page);
    first = await checksOf(productId);
    expect(first.checks).toHaveLength(MARKETS.length);
    const [v1] = await versionsOf(productId);
    expect(new Set(first.checks.map((c) => c.artwork_sha))).toEqual(new Set([v1.file_sha256]));

    // A revision, uploaded through the screen and extracted by the worker.
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Upload a new version" }).click();
    await (await chooser).setFiles({ name: "salmon-rice-12kg-v7.pdf", mimeType: "application/pdf", buffer: fs.readFileSync(synthetic("clean_3lang")) });
    const card = page.locator("[data-artwork-card]").filter({ visible: true });
    await expect(card).toHaveAttribute("data-artwork-card", "succeeded", { timeout: STEP_MS });
    await expect(card).toContainText("salmon-rice-12kg-v7.pdf");
    await expect(page.getByText(/All free label artworks are used/)).toHaveCount(0);

    // Check it: the bar now counts the revision's three printed languages, and the check runs again.
    await page.reload();
    await expect(bar(page).getByRole("heading", { level: 2 })).toHaveText("1 product × 2 jurisdiction nodes × 3 languages, answered in one pass");
    await runFromBar(page);
    await bar(page).getByRole("link", { name: "Open the report" }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${ws}/products/${productId}/report$`));

    // The report reads the revision's check: one set per market × printed panel, pinned to the new artwork.
    const [, v2] = await versionsOf(productId);
    expect(v2.version).toBe(2);
    await expect(page.locator("[data-pinned]")).toContainText(`artwork ${short(v2.file_sha256)}`);
    await expect(page.getByRole("group", { name: "Language" }).getByRole("button")).toHaveCount(MARKETS.length * 3);
    await expect(page.locator('[data-region="markets"] [data-node]').filter({ hasText: "Clear" })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("[D08.must.1] Revisions are free (BE-32).", async () => {
    const [v1, v2] = await versionsOf(productId);
    expect(v1.is_new_artwork).toBe(true);
    expect(v2.is_new_artwork).toBe(false);
    // The revision registered on a free workspace with no label left, and used nothing.
    expect(await allowanceOf(ws)).toEqual(allowanceBefore);
    const consumed = await admin().schema("app").from("allowance_consumptions").select("artwork_version_id").eq("artwork_version_id", v2.id);
    if (consumed.error) throw consumed.error;
    expect(consumed.data).toEqual([]);
    // Both checks ran: checks are never metered.
    const jobs = new Set((await checksOf(productId)).checks.map((c) => c.job_id));
    expect(jobs.size).toBe(2);
  });

  test("[D08.must.2] History is never rewritten (BE-05).", async () => {
    const now = await checksOf(productId);
    const firstIds = new Set(first.checks.map((c) => c.id));
    // Every row of the first check is still there, exactly as it was written, pinned to the first artwork.
    expect(now.checks.filter((c) => firstIds.has(c.id))).toEqual(first.checks);
    expect(now.findings.filter((f) => firstIds.has(f.check_id))).toEqual(first.findings);
    // The re-check added its own rows beside them, pinned to the revision.
    const [, v2] = await versionsOf(productId);
    const added = now.checks.filter((c) => !firstIds.has(c.id));
    expect(added).toHaveLength(MARKETS.length * 3);
    expect(new Set(added.map((c) => c.artwork_sha))).toEqual(new Set([v2.file_sha256]));
    expect(new Set(added.map((c) => c.artwork_version_id))).toEqual(new Set([v2.id]));
    // And the database refuses to change the old ones, even for the service role: no update grant (42501), and the
    // insert-only trigger behind it (P0005, BE-05).
    const update = await admin().schema("app").from("checks").update({ label_state: "clear" }).eq("id", first.checks[0].id);
    expect(["42501", "P0005"]).toContain(update.error?.code);
    const remove = await admin().schema("app").from("check_findings").delete().eq("check_id", first.checks[0].id);
    expect(["42501", "P0005"]).toContain(remove.error?.code);
    const after = await checksOf(productId);
    expect(after.checks.filter((c) => firstIds.has(c.id))).toEqual(first.checks);
    expect(after.findings.filter((f) => firstIds.has(f.check_id))).toEqual(first.findings);
  });

  test("[D09.main] View coverage for a product: the main path works end to end", async ({ page, context, baseURL }) => {
    await signIn(context, viewer, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/products/${productId}/report`);
    await page.getByRole("link", { name: `RULESET ${EMPTY} · current` }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${ws}/library/coverage\\?product=${productId}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("What is encoded for Salmon & Rice Adult Dry");

    // A row per market, at the ruleset its last check was pinned to, with all six domains and the gaps by id.
    const rows = page.locator('[data-region="coverage"] tr[data-node]');
    await expect(rows).toHaveCount(MARKETS.length);
    for (const node of MARKETS) {
      const row = page.locator(`[data-region="coverage"] tr[data-node="${node}"]`);
      await expect(row).toContainText(`Ruleset ${EMPTY} · pinned`);
      await expect(row.locator("td[data-domain]")).toHaveCount(6);
      await expect(row.locator('td[data-state="complete"]')).toHaveCount(0);
      await expect(row.locator("[data-gap-id]").first()).toBeVisible();
    }
    await axe(page);

    // A market opens its node: state, facts, the six domains and the named gaps, each anchored by its id.
    await page.locator('[data-region="coverage"] tr[data-node="EU-DE"]').getByRole("link", { name: "Germany" }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${ws}/library/coverage/EU-DE$`));
    const node = page.locator('main[data-screen="S-NV2-021"] [data-region="node"]');
    await expect(node.getByRole("heading", { level: 2 }).first()).toHaveText(/^Germany: no domains encoded, \w+ named as (a gap|gaps)\.$/);
    await expect(node.locator('[data-fact="Ruleset binding"]')).toHaveText(EMPTY);
    await expect(node.locator('[data-fact="Domains encoded"]')).toHaveText("0 of 6");
    await expect(node.locator('[data-region="domains"] [data-domain]')).toHaveCount(6);
    const gaps = await admin().schema("ref").from("coverage_gaps").select("gap_id, description").eq("node_id", "EU-DE");
    if (gaps.error) throw gaps.error;
    for (const g of gaps.data) await expect(node.locator(`[id="${g.gap_id}"]`)).toContainText(g.description);
    await axe(page);

    // A Not assessed finding's gap link lands on its gap (D07.must.2's link, now to a built screen).
    await page.goto(`/w/${ws}/products/${productId}/report`);
    const link = page.locator('[data-region="findings"] [data-gap-id] a').first();
    const gapId = (await link.getAttribute("href"))!.split("#")[1];
    await link.click();
    await expect(page.locator(`[id="${decodeURIComponent(gapId)}"]`)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("[D09.must.1] The same table as the public page (BE-10).", async ({ page, context, baseURL }) => {
    // What the public page reads: public.coverage_snapshot(), as anyone.
    const anon = await admin().rpc("coverage_snapshot");
    if (anon.error) throw anon.error;
    const snapshot = anon.data as unknown as { ruleset_version: string; nodes: { node_id: string; domain: string; state: string; rules_encoded: number; gap_id: string | null }[] };
    expect(snapshot.ruleset_version).toBe(EMPTY);

    await signIn(context, viewer, baseURL!);
    await page.goto(`/w/${ws}/library/coverage?product=${productId}`);
    await expect(page.locator('[data-region="coverage"] tr[data-node]')).toHaveCount(MARKETS.length);
    for (const node of MARKETS) {
      const expected = Object.fromEntries(snapshot.nodes.filter((n) => n.node_id === node).map((n) => [n.domain, n]));
      const cells = page.locator(`tr[data-node="${node}"] td[data-domain]`);
      const inApp = await cells.evaluateAll((tds) =>
        tds.map((td) => ({ domain: td.getAttribute("data-domain"), state: td.getAttribute("data-state"), rules: Number(td.querySelector("[data-rules]")?.getAttribute("data-rules")) })),
      );
      for (const c of inApp) {
        const s = expected[c.domain!];
        expect(c, `${node} ${c.domain}`).toEqual({ domain: c.domain, state: s?.state ?? "not_encoded", rules: s?.rules_encoded ?? 0 });
      }
      const appGaps = await page.locator(`tr[data-node="${node}"] [data-gap-id]`).evaluateAll((as) => as.map((a) => a.getAttribute("data-gap-id")));
      expect(appGaps.sort()).toEqual(snapshot.nodes.filter((n) => n.node_id === node && n.gap_id).map((n) => n.gap_id).sort());

      // And the public page draws the same node the same way: per domain, the same count and the same gap.
      const pub = await context.newPage();
      await pub.goto(`/coverage?region=EU&node=${node}#node`);
      const publicRows = await pub.locator('[data-testid="node"] [data-domain]').evaluateAll((rows) =>
        rows.map((r) => ({ domain: r.getAttribute("data-domain"), cells: [...r.querySelectorAll('[role="cell"]')].map((c) => c.textContent?.trim()) })),
      );
      expect(publicRows).toHaveLength(6);
      for (const r of publicRows) {
        const own = inApp.find((c) => c.domain === r.domain)!;
        expect(Number(r.cells[1]), `${node} ${r.domain} rules`).toBe(own.rules);
        const gap = snapshot.nodes.find((n) => n.node_id === node && n.domain === r.domain)?.gap_id;
        if (gap) expect(r.cells[2]).toBe(gap);
      }
      await pub.close();
    }
  });

  test("Run the check: blocked until there is an artwork and a market, and a viewer cannot open it", async ({ page, context, baseURL }) => {
    // A fresh free workspace: in the one above every label is used, so a product without artwork is a fourth label,
    // and Upload & scope shows the plan card instead of the bar (S-PLN-005, T-401).
    const fresh = await workspace(editor, "Halden Fresh Labels");
    const noArtwork = await seedProduct(fresh, "Puppy Chicken 2 kg", ["EU-DE"], false);
    const noMarkets = await seedProduct(fresh, "Senior Lamb 4 kg", []);
    await signIn(context, editor, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${fresh}/products/${noArtwork}/check`);
    await expect(bar(page).getByRole("button", { name: "Run the check" })).toBeDisabled();
    await expect(bar(page).locator("[data-run-blocked]")).toHaveText(/Upload the artwork first/);
    await axe(page);
    await page.goto(`/w/${fresh}/products/${noMarkets}/check`);
    await expect(bar(page).getByRole("button", { name: "Run the check" })).toBeDisabled();
    await expect(bar(page).locator("[data-run-blocked]")).toHaveText(/Choose at least one market/);
    expect(errors).toEqual([]);

    await signIn(context, viewer, baseURL!);
    await page.goto(`/w/${ws}/products/${productId}/check`);
    await expect(page.getByText(/Your role cannot open/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Run the check" })).toHaveCount(0);
  });

  test("coverage states: every node, a product with no markets, an unknown product and an unknown node", async ({ page, context, baseURL }) => {
    const noMarkets = await seedProduct(ws, "Kitten Salmon 400 g", [], false);
    await signIn(context, viewer, baseURL!);
    const errors = watch(page);

    await page.goto(`/w/${ws}/library/coverage`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("What is encoded, and what is not");
    const anon = await admin().rpc("coverage_snapshot");
    if (anon.error) throw anon.error;
    const nodes = new Set((anon.data as unknown as { nodes: { node_id: string }[] }).nodes.map((n) => n.node_id));
    await expect(page.locator('[data-region="coverage"] tr[data-node]')).toHaveCount(nodes.size);
    await expect(page.locator('[data-region="coverage"] td[data-state="complete"]')).toHaveCount(0);
    await axe(page);

    await page.goto(`/w/${ws}/library/coverage?product=${noMarkets}`);
    await expect(page.getByText("This product is not sold in any market yet")).toBeVisible();
    await expect(page.getByRole("link", { name: "Upload & scope" })).toHaveAttribute("href", `/w/${ws}/products/${noMarkets}/check`);
    await axe(page);

    await page.goto(`/w/${ws}/library/coverage?product=${randomUUID()}`);
    await expect(page.getByText("This product is not in this workspace")).toBeVisible();

    await page.goto(`/w/${ws}/library/coverage/EU-ZZ`);
    await expect(page.getByText("There is no such coverage node")).toBeVisible();
    await page.goto(`/w/${ws}/library/coverage/EU-DE?ruleset=9999.99-none`);
    await expect(page.getByText("There is no such coverage node")).toBeVisible();
    await axe(page);
    expect(errors).toEqual([]);
  });

  test("no dead controls on the coverage screens", async ({ page, context, baseURL }) => {
    await signIn(context, viewer, baseURL!);
    for (const url of [`/w/${ws}/library/coverage?product=${productId}`, `/w/${ws}/library/coverage/EU-DE`]) {
      const errors = watch(page);
      await page.goto(url);
      // The route streams behind w/[workspace]/loading.tsx: wait for the screen's own content before crawling it.
      const screen = page.locator("main[data-screen]").filter({ has: page.locator('[data-region="coverage"], [data-region="node"]') });
      await expect(screen.locator('[data-region="coverage"] tr[data-node], [data-region="domains"] [data-domain]').filter({ visible: true }).first()).toBeVisible();
      const hrefs = await screen.locator("a").filter({ visible: true }).evaluateAll((links) => links.map((a) => a.getAttribute("href")));
      expect(hrefs.length).toBeGreaterThan(0);
      for (const href of new Set(hrefs)) {
        expect(href, "every link stays on the site").toMatch(/^\//);
        const response = await page.request.get(href!.split("#")[0], { maxRedirects: 0 });
        expect(response.status(), href!).toBeLessThan(400);
      }
      await expect(screen.locator("button").filter({ visible: true })).toHaveCount(0);
      expect(errors).toEqual([]);
    }
  });

  test("S-NV2-002, S-NV2-013 and S-NV2-021 match their design baselines at 1600 px where T-505 has the data (#55)", async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: 1600, height: 1832 });
    await signIn(context, editor, baseURL!);
    await page.goto(`/w/${ws}/products/${productId}/check`);
    await expect(bar(page).getByRole("button", { name: "Run the check" })).toBeEnabled();
    await expectLikeBaseline(page, bar(page).getByRole("button", { name: "Run the check" }), "S-NV2-002", S_NV2_002.button, maxDiffPixelRatio);

    await page.goto(`/w/${ws}/library/coverage`);
    const intro = page.locator('[data-region="intro"]');
    await expect(intro).toBeVisible();
    // The first sentence of the introduction, as the design sets it (the rest of the line is the design's own copy).
    await expectLikeBaseline(page, intro, "S-NV2-013", { x: 242, y: 91, width: 470, height: 20, fractionY: 0 }, maxDiffPixelRatio);

    await page.goto(`/w/${ws}/library/coverage/EU-DE`);
    const heading = page.getByRole("heading", { level: 2, name: "Rules encoded, by domain" });
    await expect(heading).toBeVisible();
    // "Rules encoded, by domain", without the ruleset beside it (the seeded release is not the design's).
    await expectLikeBaseline(page, heading, "S-NV2-021", { x: 594, y: 369, width: 196, height: 22, fractionY: 0 }, maxDiffPixelRatio);
  });
});
