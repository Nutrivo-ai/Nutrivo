// T-303: upload an artwork and extract it (D01), from the product's Upload & scope screen (S-NV2-002, C02), through
// the worker, to what ran per panel (S-NV2-025). Runs on the full local stack (scripts/ci/e2e.sh): Storage, the
// database, the worker's extract handler and the built web app.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { parse } from "yaml";
import { REPO_ROOT } from "../visual/screens";
import { expectLikeBaseline } from "./support/baseline";
import { admin, haveStack, person, signIn, workspace, type Person } from "./support/people";

const SYNTH = path.join(REPO_ROOT, "fixtures/synth/out");
const EXTRACTION_MS = 90_000;
const maxDiff = (parse(fs.readFileSync(path.join(REPO_ROOT, "spec/nfr.yaml"), "utf8")) as { quality: { visual_max_diff_pixel_ratio: number } })
  .quality.visual_max_diff_pixel_ratio;
// S-NV2-002 at 1600 px: the "1 · What you have" Artwork card, complete, is the box at x 242, y 116, 294 × 131.
const ARTWORK_CARD = { x: 242, y: 116, width: 294, height: 131, fractionY: 0 };

function fixture(name: string) {
  const file = path.join(SYNTH, `${name}.pdf`);
  if (!fs.existsSync(file)) {
    // The synthetic labels are generated, never committed (fixtures/synth/README.md).
    execFileSync("uv", ["run", "python", "../fixtures/synth/generate.py", "--out", "../fixtures/synth/out"], {
      cwd: path.join(REPO_ROOT, "worker"),
      stdio: "inherit",
    });
  }
  return file;
}

function watch(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
  return errors;
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

/**
 * A product to upload into. No RPC creates a product yet (C02 step 2 needs one; asked on #41), so the test makes it as
 * the service role; the app itself never writes products.
 */
async function product(workspaceId: string, name: string) {
  const service = admin();
  const fam = await service.schema("app").from("families").insert({ workspace_id: workspaceId, name }).select("id").single();
  if (fam.error) throw fam.error;
  const prod = await service
    .schema("app")
    .from("products")
    .insert({ workspace_id: workspaceId, family_id: fam.data.id, name, stage: "in_development" })
    .select("id")
    .single();
  if (prod.error) throw prod.error;
  return prod.data.id as string;
}

test.describe("upload and extract", () => {
  test.skip(!haveStack(), "needs the local Supabase stack and the worker: run through scripts/ci/e2e.sh (make e2e)");
  test.describe.configure({ mode: "serial" });

  let editor: Person, viewer: Person;
  let ws: string;

  test.beforeAll(async () => {
    [editor, viewer] = await Promise.all([person("t303-editor"), person("t303-viewer")]);
    ws = await workspace(editor, "Halden Upload Test");
    await workspace(viewer, "Viewer's own"); // app.people rows are made by the RPCs; this one makes the viewer's
    const service = admin();
    const { data: v, error } = await service.schema("app").from("people").select("id").eq("user_id", viewer.userId).single();
    if (error) throw error;
    const grant = await service.schema("app").from("memberships").insert({ workspace_id: ws, person_id: v.id, role: "viewer" });
    if (grant.error) throw grant.error;
  });

  const card = (page: Page) => page.locator("[data-artwork-card]").filter({ visible: true });

  test("[D01.main] Upload artwork and extract: the main path works end to end", async ({ page, context, baseURL }) => {
    test.setTimeout(EXTRACTION_MS + 60_000);
    const productId = await product(ws, "Salmon & Rice Adult 12 kg");
    await signIn(context, editor, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/products/${productId}/check`);
    await expect(page.getByRole("heading", { level: 1, name: "Salmon & Rice Adult 12 kg" })).toBeVisible();
    await expect(page.getByText("Not uploaded")).toBeVisible();
    await axe(page);

    // Choose the file: signed upload, register_artwork, then extraction progress over app.jobs.
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Choose a file" }).click();
    // Named as the design names it, so the card can be compared with S-NV2-002.
    const named = { name: "salmon-rice-12kg-v7.pdf", mimeType: "application/pdf", buffer: fs.readFileSync(fixture("clean_3lang")) };
    await (await chooser).setFiles(named);
    await expect(card(page)).toHaveAttribute("data-artwork-card", "succeeded", { timeout: EXTRACTION_MS });
    await expect(card(page)).toContainText("Complete");
    await expect(card(page)).toContainText("salmon-rice-12kg-v7.pdf · vector text extracted");
    await axe(page);
    await page.reload(); // the card as a later visit draws it, without the upload control's transient state
    await expectLikeBaseline(page, card(page), "S-NV2-002", ARTWORK_CARD, maxDiff);

    // The database holds what the screen says: one version, one run, three panels with text objects.
    const service = admin();
    const versions = await service.schema("app").from("artwork_versions").select("id, storage_path, file_sha256").eq("product_id", productId);
    expect(versions.data).toHaveLength(1);
    const [av] = versions.data!;
    expect(av.storage_path).toBe(`${ws}/${productId}/${av.file_sha256}.pdf`);
    const job = await service.schema("app").from("jobs").select("status, progress").eq("idempotency_key", `extract:${av.id}`).single();
    expect(job.data).toMatchObject({ status: "succeeded", progress: { stage: "done", panels: 3, panels_extracted: 3 } });

    // What ran, per panel.
    await page.getByRole("link", { name: "What ran, per panel →" }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${ws}/products/${productId}/artwork/${av.id}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Extraction" })).toBeVisible();
    await expect(page.locator('[data-run-status="succeeded"]')).toContainText("3 of 3 panels");
    const rows = page.locator("tr[data-panel]");
    await expect(rows).toHaveCount(3);
    await expect(rows.and(page.locator('[data-panel-status="extracted"]'))).toHaveCount(3);
    await expect(page.getByText("Not assessed because of this file")).toHaveCount(0);
    await axe(page);
    await page.getByRole("link", { name: "← Back to upload & scope" }).click();
    await expect(page).toHaveURL(new RegExp(`/products/${productId}/check$`));
    expect(errors).toEqual([]);
  });

  test("[C02.fail.1] An unsupported file type is rejected before upload.", async ({ page, context, baseURL }) => {
    const productId = await product(ws, "Lamb Adult 3 kg");
    await signIn(context, editor, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/products/${productId}/check`);
    const sent: string[] = [];
    page.on("request", (r) => {
      if (/\/storage\/v1\/|register_artwork/.test(r.url())) sent.push(`${r.method()} ${r.url()}`);
    });
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Choose a file" }).click();
    await (await chooser).setFiles({ name: "label.pdf", mimeType: "application/pdf", buffer: Buffer.from("GIF89a, renamed") });
    await expect(page.getByText("This file was not uploaded")).toBeVisible();
    await expect(page.getByText("This is not a PDF, PNG or JPEG file.")).toBeVisible();
    await axe(page);
    expect(sent).toEqual([]);
    const listed = await admin().storage.from("artwork").list(`${ws}/${productId}`);
    expect(listed.data ?? []).toEqual([]);
    const versions = await admin().schema("app").from("artwork_versions").select("id").eq("product_id", productId);
    expect(versions.data).toEqual([]);

    // The state's one action opens the file chooser again.
    const again = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Choose another file" }).click();
    await again;
    expect(errors).toEqual([]);
  });

  test("a partly outlined artwork persists what was read and names what was not", async ({ page, context, baseURL }) => {
    test.setTimeout(EXTRACTION_MS + 60_000);
    const productId = await product(ws, "Grain Free Adult 2 kg");
    await signIn(context, editor, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/products/${productId}/check`);
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Choose a file" }).click();
    await (await chooser).setFiles(fixture("mixed_9panels"));
    await expect(card(page)).toHaveAttribute("data-artwork-card", "partial", { timeout: EXTRACTION_MS });
    await expect(card(page)).toContainText("Partial");
    await page.getByRole("link", { name: "What ran, per panel →" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Partial extraction" })).toBeVisible();
    await expect(page.locator("tr[data-panel]")).toHaveCount(9);
    await expect(page.locator('tr[data-panel-status="not_assessable"]').first()).toContainText("Not measured");
    await expect(page.getByText("Not assessed because of this file")).toBeVisible();
    await expect(page.getByText("How to get the geometry check")).toBeVisible();
    await axe(page);
    await page.getByRole("link", { name: "Upload another file" }).click();
    await expect(page).toHaveURL(new RegExp(`/products/${productId}/check$`));
    // Back on the upload screen, the card shows the partial result and the next version can be uploaded.
    await expect(page.getByRole("button", { name: "Upload a new version" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("a viewer sees the no-permission state, and an unknown product reads as not found", async ({ page, context, baseURL }) => {
    const productId = await product(ws, "Senior 7+ 12 kg");
    await signIn(context, viewer, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/products/${productId}/check`);
    await expect(page.getByText("Your role cannot open Upload & scope")).toBeVisible();
    await expect(page.locator("[data-dropzone]")).toHaveCount(0);
    await expect(page.locator("input[type=file]")).toHaveCount(0);
    await axe(page);
    await signIn(context, editor, baseURL!);
    await page.goto(`/w/${ws}/products/${randomUUID()}/check`);
    await expect(page.getByText("This product is not in this workspace")).toBeVisible();
    await page.goto(`/w/${ws}/products/${productId}/artwork/${randomUUID()}`);
    await expect(page.getByText("This artwork is not in this workspace")).toBeVisible();
    await axe(page);
    await page.getByRole("link", { name: "Open the board" }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${ws}/board$`));
    expect(errors).toEqual([]);
  });

  test("no dead controls on Upload & scope: every button and link in the screen does something", async ({ page, context, baseURL }) => {
    const productId = await product(ws, "Puppy Chicken 2 kg");
    await signIn(context, editor, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/products/${productId}/check`);
    const controls = page.locator('main[data-screen="S-NV2-002"]').locator("a, button").filter({ visible: true });
    await expect(controls).toHaveCount(1);
    const chooser = page.waitForEvent("filechooser");
    await controls.first().click();
    await chooser;
    expect(errors).toEqual([]);
  });
});
