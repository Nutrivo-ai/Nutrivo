// T-1111 · S-NV2-024 Check in progress at /w/[workspace]/products/[product]/checks/[check] (D04), on the full local
// stack. [check] is the app.jobs id of the product's check job (issue 353, option b): Run the check on Upload & scope goes
// here, and the page follows the job over Realtime from queued, through running with its elapsed time, to done,
// withheld or failed, then on to the report. There are no rule counts, stages or running tallies (no such data).
//
// The main path runs the real check through the worker; the local stack releases only 0000.00-empty, so it ends
// withheld (every result Not assessed, never Clear). The other states use check job rows the service role writes and
// changes: they are never put on the queue, so the worker never takes them, and Realtime carries each change to the
// page under the jobs read policy (read_scoped). Loading is the shared ShellLoading and a read error goes to the
// workspace error boundary, both tested with the shell; done-with-verdicts, failed, stalled and unreadable are also
// rendered in CheckInProgress.test.tsx. The neutral note and the page title are compared with the baseline; axe runs
// on every state; the crawl follows every link and finds a button only where one is expected.
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { expectLikeBaseline, type Region } from "./support/baseline";
import { admin, haveStack, person, signIn, workspace, type Person } from "./support/people";
import { axe, maxDiffPixelRatio, watch } from "./support/public";

const STEP_MS = 90_000;
const MARKETS = ["EU-AT", "EU-DE"];
const EMPTY = "0000.00-empty";

// Regions of the S-NV2-024 baseline at 1600 px. The note "In progress is neutral" is drawn the same for any check; the
// design's other parts (rule counts, stages, running tallies) have no data under today's contract (issue 353, option b).
const S_NV2_024: Record<string, Region> = {
  title: { x: 242, y: 29, width: 190, height: 25, fractionY: 0.5 },
  neutral: { x: 870, y: 367, width: 320, height: 115, fractionY: 0.625 },
};

type Seeded = { productId: string; artworkId: string };

/** A product with one extracted German panel, as the extract job writes it. */
async function seedProduct(ws: string, name: string, markets: string[]): Promise<Seeded> {
  const service = admin().schema("app");
  const fam = await service.from("families").insert({ workspace_id: ws, name }).select("id").single();
  if (fam.error) throw fam.error;
  const prod = await service.from("products").insert({ workspace_id: ws, family_id: fam.data.id, name, stage: "in_development" }).select("id").single();
  if (prod.error) throw prod.error;
  const productId = prod.data.id as string;
  const nodes = await service.from("product_nodes").insert(markets.map((node_id) => ({ product_id: productId, node_id, workspace_id: ws })));
  if (nodes.error) throw nodes.error;
  const sha = randomUUID().replace(/-/g, "").padEnd(64, "0");
  const av = await service
    .from("artwork_versions")
    .insert({ workspace_id: ws, product_id: productId, version: 1, file_sha256: sha, storage_path: `${ws}/${productId}/${sha}.pdf`, file_name: "label.pdf", mime_type: "application/pdf", page_count: 1, is_new_artwork: true })
    .select("id")
    .single();
  if (av.error) throw av.error;
  const now = new Date().toISOString();
  const run = await service
    .from("extraction_runs")
    .insert({ workspace_id: ws, product_id: productId, artwork_version_id: av.data.id, engine: "pdfium", engine_version: "e2e", idempotency_key: `e2e:${av.data.id}`, status: "succeeded", started_at: now, finished_at: now })
    .select("id")
    .single();
  if (run.error) throw run.error;
  const panel = await service
    .from("artwork_panels")
    .insert({ workspace_id: ws, product_id: productId, artwork_version_id: av.data.id, extraction_run_id: run.data.id, page: 1, panel_index: 0, bbox_mm: [0, 0, 105, 297], language: "de", language_confidence: 0.99, status: "extracted" })
    .select("id")
    .single();
  if (panel.error) throw panel.error;
  const text = await service.from("text_objects").insert({
    workspace_id: ws, product_id: productId, panel_id: panel.data.id, text: "Alleinfuttermittel für ausgewachsene Hunde",
    bbox_mm: [8, 14, 97, 22], font_name: "Inter", font_size_pt: 9, x_height_mm: 1.6, cap_height_mm: 2.2, is_ocr: false, confidence: 1, reading_order: 1,
  });
  if (text.error) throw text.error;
  return { productId, artworkId: av.data.id as string };
}

/** A check job row as app.request_check writes it, never queued: the service role moves it through its states. */
async function seedJob(ws: string, s: Seeded, nodes: string[], row: { status?: string; progress?: Record<string, string | number>; last_error?: string; attempts?: number; agoSeconds?: number } = {}) {
  const { data, error } = await admin()
    .schema("app")
    .from("jobs")
    .insert({
      workspace_id: ws,
      kind: "check",
      idempotency_key: `e2e-t1111:${randomUUID()}`,
      product_id: s.productId,
      node_ids: nodes,
      payload: { product_id: s.productId, artwork_version_id: s.artworkId, ruleset_version: EMPTY, node_ids: nodes },
      status: row.status ?? "queued",
      progress: row.progress ?? {},
      last_error: row.last_error ?? null,
      attempts: row.attempts ?? 0,
      created_at: new Date(Date.now() - (row.agoSeconds ?? 0) * 1000).toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

async function setJob(id: string, change: { status: string; progress?: Record<string, string | number>; last_error?: string }) {
  const { error } = await admin().schema("app").from("jobs").update(change).eq("id", id);
  if (error) throw error;
}

const region = (page: Page) => page.locator('[data-region="check-progress"]');

test.describe("S-NV2-024 Check in progress", () => {
  test.skip(!haveStack(), "needs the local Supabase stack and the worker: run through scripts/ci/e2e.sh (make e2e)");
  test.describe.configure({ mode: "serial" });
  test.use({ viewport: { width: 1600, height: 1000 } });

  let editor: Person, scoped: Person;
  let ws: string, seeded: Seeded;
  const url = (job: string) => `/w/${ws}/products/${seeded.productId}/checks/${job}`;

  test.beforeAll(async () => {
    [editor, scoped] = await Promise.all([person("t1111-editor"), person("t1111-scoped")]);
    ws = await workspace(editor, "Halden Check Progress");
    await workspace(scoped, "Scoped editor's own"); // makes the scoped editor's app.people row
    const service = admin().schema("app");
    const p = await service.from("people").select("id").eq("user_id", scoped.userId).single();
    if (p.error) throw p.error;
    const grant = await service.from("memberships").insert({ workspace_id: ws, person_id: p.data.id, role: "editor", scope_node_ids: ["EU-DE"] });
    if (grant.error) throw grant.error;
    seeded = await seedProduct(ws, "Salmon & Rice Adult 12 kg", MARKETS);
  });

  test("[D04.main] Run a check: the main path works end to end, from Run the check to the report", async ({ page, context, baseURL }) => {
    test.setTimeout(STEP_MS + 60_000);
    await signIn(context, editor, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/products/${seeded.productId}/check`);
    await page.locator("[data-run-check]").getByRole("button", { name: "Run the check" }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${ws}/products/${seeded.productId}/checks/[0-9a-f-]{36}$`));
    const jobId = page.url().split("/").pop()!;
    // The job is the one app.request_check queued for this product.
    const job = await admin().schema("app").from("jobs").select("kind, product_id, node_ids, payload").eq("id", jobId).single();
    if (job.error) throw job.error;
    expect({ kind: job.data.kind, product_id: job.data.product_id, node_ids: job.data.node_ids }).toEqual({ kind: "check", product_id: seeded.productId, node_ids: MARKETS });
    // The request id Run the check sent travels with the job, where this page reads it for its Sentry events (docs/17).
    expect((job.data.payload as { request_id?: unknown }).request_id).toEqual(expect.any(String));
    await expect(page.getByRole("heading", { level: 2, name: "Salmon & Rice Adult 12 kg · 2 nodes · 1 language" })).toBeVisible();
    // The worker finishes it; on the empty ruleset every result is withheld (D04.must.1), and the page says so.
    await expect(region(page)).toHaveAttribute("data-progress", "withheld", { timeout: STEP_MS });
    await expect(page.locator("[data-check-terminal]")).toContainText("Nothing is Clear.");
    await expect(page.locator('[data-results] [data-count="clear"]')).toContainText("0");
    await expect(page.locator('[data-results] [data-count="clear"]')).toContainText("Label clear", { ignoreCase: true });
    await expect(page.locator("[data-ruleset]")).toContainText(`RULESET ${EMPTY}`);
    await axe(page);
    await page.getByRole("link", { name: "Open the report" }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${ws}/products/${seeded.productId}/report$`));
    expect(errors).toEqual([]);
  });

  test("[T-1111] queued, then running over Realtime, with the elapsed time and no invented counts, like the baseline", async ({ page, context, baseURL }) => {
    const job = await seedJob(ws, seeded, MARKETS, { agoSeconds: 41 });
    await signIn(context, editor, baseURL!);
    const errors = watch(page);
    await page.goto(url(job));
    await expect(region(page)).toHaveAttribute("data-progress", "queued");
    await expect(page.locator("[data-check-running]")).toContainText(/Queued · \d+ seconds elapsed/i);
    await axe(page);

    await setJob(job, { status: "running" });
    await expect(region(page)).toHaveAttribute("data-progress", "running", { timeout: 15_000 });
    await expect(page.locator("[data-check-running] p").first()).toHaveText(/^Running · \d+ seconds elapsed$/);
    await expect(page.locator("header").first()).toContainText("Check your label · running", { ignoreCase: true });
    await expect(region(page)).not.toContainText(/rules applied|Stage by stage|so far/i);
    await expect(page.locator("[data-results]")).toHaveCount(0);
    await expectLikeBaseline(page, page.getByRole("heading", { level: 1, name: "Check in progress" }), "S-NV2-024", S_NV2_024.title, maxDiffPixelRatio);
    await expectLikeBaseline(page, page.locator("[data-neutral-note]"), "S-NV2-024", S_NV2_024.neutral, maxDiffPixelRatio);
    await axe(page);
    expect(errors).toEqual([]);
  });

  test("[T-1111] done, watched over Realtime: the job's counts with their glyphs, then on to the report", async ({ page, context, baseURL }) => {
    const job = await seedJob(ws, seeded, MARKETS, { status: "running" });
    await signIn(context, editor, baseURL!);
    await page.goto(url(job));
    await expect(region(page)).toHaveAttribute("data-progress", "running");
    await setJob(job, { status: "succeeded", progress: { outcome: "checked", checks: 2, clear: 1, action: 1, not_assessed: 0 } });
    await expect(page.locator('[data-check-terminal="done"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-results] [data-count="action"]')).toContainText("1");
    await expect(page.locator('[data-results] [data-count="action"] [data-glyph="action"]')).toHaveCount(1);
    await expect(page.locator('[data-results] [data-glyph="blocked"]')).toHaveCount(0);
    await axe(page);
    await expect(page).toHaveURL(new RegExp(`/w/${ws}/products/${seeded.productId}/report$`), { timeout: 10_000 });
  });

  test("[D04.fail.1] failed for no released ruleset: said plainly, with the way back, and it stays", async ({ page, context, baseURL }) => {
    const job = await seedJob(ws, seeded, MARKETS, { status: "failed", last_error: "NoReleasedRuleset: P0003", attempts: 3 });
    await signIn(context, editor, baseURL!);
    await page.goto(url(job));
    await expect(region(page)).toHaveAttribute("data-progress", "failed");
    await expect(region(page)).toContainText("The check did not finish");
    await expect(region(page)).toContainText("not released");
    await expect(page.getByRole("link", { name: "Back to upload & scope" })).toHaveAttribute("href", `/w/${ws}/products/${seeded.productId}/check`);
    await expect(page.getByRole("link", { name: "Open the report" })).toHaveCount(0);
    await axe(page);
  });

  test("[T-1111] no-permission: a job about a market outside the person's scope, or of another product, shows nothing", async ({ page, context, baseURL }) => {
    const austria = await seedJob(ws, seeded, ["EU-AT"], { status: "running" });
    await signIn(context, scoped, baseURL!);
    await page.goto(url(austria));
    await expect(page.getByText("This check is not one you can open")).toBeVisible();
    await expect(region(page)).toHaveCount(0);
    await expect(page.getByText("Salmon & Rice Adult 12 kg")).toHaveCount(0);
    await axe(page);
    // A job id under another product, and something that is not an id, read the same.
    const other = await seedProduct(ws, "Kitten Salmon 400 g", MARKETS);
    await page.goto(`/w/${ws}/products/${other.productId}/checks/${austria}`);
    await expect(page.getByText("This check is not one you can open")).toBeVisible();
    await page.goto(`/w/${ws}/products/${seeded.productId}/checks/not-a-job`);
    await expect(page.getByText("This check is not one you can open")).toBeVisible();
  });

  test("[T-1111] no dead controls: every link on each state resolves, and only Check again is a button", async ({ page, context, baseURL }) => {
    await signIn(context, editor, baseURL!);
    const errors = watch(page);
    const states = [
      await seedJob(ws, seeded, MARKETS, { status: "running" }),
      await seedJob(ws, seeded, MARKETS, { status: "succeeded", progress: { outcome: "checked", checks: 2, not_assessed: 2 } }),
      await seedJob(ws, seeded, MARKETS, { status: "failed", last_error: "boom" }),
    ];
    for (const job of states) {
      await page.goto(url(job));
      await expect(region(page)).toBeVisible();
      const hrefs = await region(page)
        .locator("a")
        .filter({ visible: true })
        .evaluateAll((links) => links.map((a) => a.getAttribute("href")));
      for (const href of new Set(hrefs)) {
        expect(href, `${href} stays on the site`).toMatch(/^\//);
        const response = await page.request.get(href!, { maxRedirects: 0 });
        expect(response.status(), href!).toBeLessThan(400);
      }
      await expect(region(page).locator("button")).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
});
