// T-407: the Slush demo path end to end (docs/demo.md, docs/11 M4): sign in → upload artwork → extraction → label
// report → report PDF → public verification. One serial journey on the full local stack (scripts/ci/e2e.sh: the worker,
// the built web app, Storage, the `verify` Edge Function, MODELS_MODE=replay so model calls read recorded responses).
//
// The demo stays honest: the local stack releases only the empty baseline ruleset 0000.00-empty, so every market and
// every finding reads Not assessed with its coverage gap, and nothing anywhere reads Clear (CLAUDE.md 3).
//
// Two steps have no control in the web on main yet; the journey drives them the way their own tests do and names the
// gap (plan on #49):
//   - the product and its markets: written as the service role, as upload.spec does (T-401, #164);
//   - the report PDF: the `report` job enqueued directly, acting as the editor, as T-405 decided on #47 (the producer
//     app.request_report and the download button are not written yet).
//
// DEMO_SLOWMO=<ms> slows every browser action, for a driven stage demo run headed (docs/demo.md).
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { REPO_ROOT } from "../visual/screens";
import { RENDER_ARGS } from "../visual/render";
import { admin, haveStack, person, signIn, workspace, type Person } from "./support/people";
import { axe, watch } from "./support/public";

const STEP_MS = 90_000; // each worker step's budget, as upload.spec and report.spec use
const EMPTY_RULESET = "0000.00-empty";
// clean_3lang prints English, Swedish and German panels (fixtures/synth/generate.py). Sweden reads the Swedish panel and
// Germany the German one, as in docs/11 M4's done-when.
const MARKETS = ["EU-DE", "EU-SE"];
const PRODUCT = "Salmon & Rice Adult 12 kg";

// Only when asked: launchOptions here replaces the configuration's whole object, so it repeats its render arguments.
if (process.env.DEMO_SLOWMO) test.use({ launchOptions: { args: RENDER_ARGS, slowMo: Number(process.env.DEMO_SLOWMO) } });

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

/**
 * Runs SQL on the local database as postgres: psql on DATABASE_URL (scripts/ci/e2e.sh exports it), or inside the
 * stack's container, as supabase/seed/demo/load.sh does. Test setup only; the app never reaches the database this way.
 */
function sql(query: string) {
  const local = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  const viaPsql = spawnSync("psql", [process.env.DATABASE_URL || local, "-v", "ON_ERROR_STOP=1", "-Atq", "-c", query], { encoding: "utf8" });
  const run = viaPsql.error
    ? spawnSync("docker", ["exec", "-i", "supabase_db_nutrivo", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-Atq", "-c", query], { encoding: "utf8" })
    : viaPsql;
  if (run.error || run.status !== 0) throw new Error(`sql failed: ${run.error?.message ?? run.stderr}`);
  return run.stdout.trim();
}

/** Waits for a job to reach `succeeded` and returns its progress. */
async function finished(jobId: string) {
  let progress: Record<string, unknown> = {};
  await expect
    .poll(
      async () => {
        const job = await admin().schema("app").from("jobs").select("status, progress").eq("id", jobId).single();
        if (job.error) throw job.error;
        progress = (job.data.progress ?? {}) as Record<string, unknown>;
        return job.data.status;
      },
      { timeout: STEP_MS, intervals: [500, 1000, 2000] },
    )
    .toBe("succeeded");
  return progress;
}

/**
 * The product the demo checks, in its markets. Written as the service role because main has no web path that creates a
 * product or sets its markets yet (T-401, #164); the app itself never writes products this way.
 */
async function demoProduct(workspaceId: string) {
  const service = admin().schema("app");
  const fam = await service.from("families").insert({ workspace_id: workspaceId, name: "Adult dry" }).select("id").single();
  if (fam.error) throw fam.error;
  const prod = await service
    .from("products")
    .insert({ workspace_id: workspaceId, family_id: fam.data.id, name: PRODUCT, stage: "in_development" })
    .select("id")
    .single();
  if (prod.error) throw prod.error;
  const nodes = await service.from("product_nodes").insert(MARKETS.map((node_id) => ({ product_id: prod.data.id, node_id, workspace_id: workspaceId })));
  if (nodes.error) throw nodes.error;
  return prod.data.id as string;
}

/** No rule, no verdict: what the database holds for the product after its check (CLAUDE.md 3, 5, 8). */
async function expectNothingClear(productId: string, jobId: string) {
  const service = admin().schema("app");
  const checks = await service.from("checks").select("id, label_state, ruleset_version, artwork_sha, applied_rule_keys").eq("job_id", jobId);
  if (checks.error) throw checks.error;
  expect(checks.data.length).toBeGreaterThanOrEqual(MARKETS.length);
  for (const c of checks.data) {
    expect(c.label_state).toBe("not_assessed");
    expect(c.ruleset_version).toBe(EMPTY_RULESET);
    expect(c.artwork_sha).toMatch(/^[0-9a-f]{64}$/);
    expect(c.applied_rule_keys).toEqual([]);
  }
  const findings = await service.from("check_findings").select("state, provenance, gap_id, rule_key").in("check_id", checks.data.map((c) => c.id));
  if (findings.error) throw findings.error;
  expect(findings.data.length).toBeGreaterThan(0);
  for (const f of findings.data) {
    expect(f.state).toBe("not_assessed");
    expect(f.provenance).toBe("not_assessed");
    expect(f.gap_id ?? f.rule_key, "every finding carries a gap_id or a rule_key").toBeTruthy();
  }
  const nodes = await service.from("product_nodes").select("node_id, label_state, registration_state, display_state").eq("product_id", productId);
  if (nodes.error) throw nodes.error;
  expect(nodes.data).toHaveLength(MARKETS.length);
  for (const n of nodes.data) {
    expect(n).toMatchObject({ label_state: "not_assessed", registration_state: "unknown", display_state: "not_assessed" });
  }
  return checks.data;
}

const card = (page: Page) => page.locator("[data-artwork-card]").filter({ visible: true });
const tabs = (page: Page) => page.getByRole("group", { name: "Language" }).getByRole("button");
const findingsPanel = (page: Page) => page.locator('[data-region="findings"]');

test.describe("@demo @local-only the demo path", () => {
  test.skip(!haveStack(), "needs the local Supabase stack and the worker: run through scripts/ci/e2e.sh (make e2e)");

  let editor: Person;
  let ws: string;

  test.beforeAll(async () => {
    editor = await person("t407-editor");
    ws = await workspace(editor, "Halden Pet Nutrition");
  });

  test("demo path: sign in, upload, extraction, label report, report PDF, public verification; nothing reads Clear", async ({
    page,
    context,
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(3 * STEP_MS + 120_000);
    const productId = await demoProduct(ws);

    // 1 · Sign in and open the product's Upload & scope.
    await signIn(context, editor, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/products/${productId}/check`);
    await expect(page.getByRole("heading", { level: 1, name: PRODUCT })).toBeVisible();
    await expect(page.getByText("Not uploaded")).toBeVisible();

    // 2 · Upload the artwork; the worker extracts it, per printed panel.
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Choose a file" }).click();
    await (await chooser).setFiles({
      name: "salmon-rice-12kg-v7.pdf",
      mimeType: "application/pdf",
      buffer: fs.readFileSync(synthetic("clean_3lang")),
    });
    await expect(card(page)).toHaveAttribute("data-artwork-card", "succeeded", { timeout: STEP_MS });
    await expect(card(page)).toContainText("Complete");
    await page.getByRole("link", { name: "What ran, per panel →" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Extraction" })).toBeVisible();
    await expect(page.locator('tr[data-panel][data-panel-status="extracted"]')).toHaveCount(3);
    await axe(page);

    // 3 · Run the check, from Upload & scope's closing bar (T-505), which calls app.request_check.
    await page.getByRole("link", { name: "← Back to upload & scope" }).click();
    await page.locator("[data-run-check]").getByRole("button", { name: "Run the check" }).click();
    await expect(page.locator("[data-run-check] [data-check-done]")).toBeVisible({ timeout: STEP_MS });
    const job = await admin().schema("app").from("product_nodes").select("last_check_job_id").eq("product_id", productId).limit(1).single();
    if (job.error) throw job.error;
    const checkJob = job.data.last_check_job_id as string;
    await finished(checkJob);
    const checks = await expectNothingClear(productId, checkJob);

    // 4 · The label report: one result set per market × printed panel, every market Not assessed, every Not assessed
    // linked to its gap, pinned to the empty ruleset.
    await page.goto(`/w/${ws}/products/${productId}/report`);
    await expect(page.locator('[data-screen="S-NV2-003"] [data-region="report"]')).toBeVisible();
    const tiles = page.locator('[data-region="markets"] [data-node]');
    await expect(tiles).toHaveCount(MARKETS.length);
    await expect(tiles.locator('[data-glyph="not_assessed"]')).toHaveCount(MARKETS.length);
    await expect(tiles.filter({ hasText: "Clear" })).toHaveCount(0);
    await expect(page.getByText(`RULESET ${EMPTY_RULESET} · current`)).toBeVisible();
    await expect(tabs(page)).toHaveCount(checks.length);
    for (let i = 0; i < checks.length; i++) {
      await tabs(page).nth(i).click();
      const rows = findingsPanel(page).locator("[data-finding-state]");
      await expect(rows.first()).toBeVisible();
      await expect(findingsPanel(page).locator('[data-finding-state="action"]')).toHaveCount(0);
      await expect(findingsPanel(page).locator('[data-finding-state="not_assessed"]')).toHaveCount(await rows.count());
      await expect(findingsPanel(page).locator("[data-gap-id] a").first()).toHaveAttribute("href", new RegExp(`^/w/${ws}/library/coverage/`));
    }
    await axe(page);

    // 5 · The report PDF for the German panel's check. Gap: app.request_report and the download button are not written
    // yet (#47), so the job is enqueued as the editor would enqueue it, with private.enqueue and the editor's identity.
    const german = await admin().schema("app").from("checks").select("id").eq("job_id", checkJob).eq("node_id", "EU-DE").eq("language", "de").single();
    if (german.error) throw german.error;
    const claims = JSON.stringify({ sub: editor.userId, role: "authenticated" });
    const reportJob = sql(
      `begin; select set_config('request.jwt.claims', '${claims}', true); ` +
        `select private.enqueue('report', '${ws}', 'report:${german.data.id}:${randomUUID()}', ` +
        `jsonb_build_object('check_id', '${german.data.id}')); commit;`,
    )
      .split("\n")
      .find((line) => /^[0-9a-f-]{36}$/.test(line))!;
    expect(reportJob, "private.enqueue returns the job id").toBeTruthy();
    const progress = await finished(reportJob);
    expect(progress).toMatchObject({ outcome: "generated", bucket: "reports" });
    const ref = progress.ref as string;
    expect(ref).toMatch(/^[A-Z2-7]{26}$/);

    const row = await admin().schema("app").from("reports").select("ref, ruleset_version, artwork_sha, has_not_assessed, pdf_sha256, pdf_path").eq("ref", ref).single();
    if (row.error) throw row.error;
    expect(row.data).toMatchObject({ ruleset_version: EMPTY_RULESET, has_not_assessed: true });

    // The editor reads the PDF under Storage's own policies, as the download button will.
    const pdf = await editor.db.storage.from("reports").download(progress.path as string);
    if (pdf.error) throw pdf.error;
    const bytes = Buffer.from(await pdf.data.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(row.data.pdf_sha256);
    const file = testInfo.outputPath(`${ref}.pdf`);
    fs.writeFileSync(file, bytes);
    await testInfo.attach("report.pdf", { path: file, contentType: "application/pdf" });
    const face = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
    const flat = face.replace(/\s+/g, "");
    expect(flat).toContain(ref);
    expect(flat).toContain(EMPTY_RULESET);
    expect(flat).toContain(row.data.artwork_sha!);
    expect(face).toMatch(/What was not assessed/i);
    const prose = face.replace(/\s+/g, " ");
    expect(prose).toMatch(/could not be assessed on this artwork\. They are not a pass\./);
    expect(prose).toContain("an unknown registration is never read as clear");

    // 6 · Anyone holding the reference, with no account and no session, verifies it.
    const visitor = await browser.newContext({ baseURL });
    const anon = await visitor.newPage();
    const publicErrors = watch(anon);
    await anon.goto(`/verify/${ref}`);
    const result = anon.getByTestId("verify-result");
    await expect(result).toHaveAttribute("data-status", "current");
    await expect(result.getByRole("heading")).toHaveText("This report was issued by Nutrivo and has not been superseded.");
    const facts = Object.fromEntries(
      await result.locator("dl > div").evaluateAll((rows) => rows.map((r) => [r.querySelector("dt")!.textContent, r.querySelector("dd")!.textContent])),
    );
    expect(facts).toMatchObject({
      Reference: ref,
      "Ruleset version": EMPTY_RULESET,
      "Items not assessed": "Yes — the report lists them by name",
    });
    const publicText = await anon.locator("body").innerText();
    for (const secret of ["Halden Pet Nutrition", PRODUCT, row.data.artwork_sha!]) expect(publicText).not.toContain(secret);
    await axe(anon);
    await visitor.close();

    expect(errors).toEqual([]);
    expect(publicErrors).toEqual([]);
  });
});
