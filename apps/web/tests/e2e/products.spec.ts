// T-401: products, families, variants, stages and the free label allowance, through the real screens on the full local
// stack (scripts/ci/e2e.sh): Add a product (S-NV2-022), a product from a label file (C02), Upload & scope's stage and
// markets (S-NV2-002), Discontinued (S-NV2-023) and the allowance moments (S-PLN-004, S-PLN-005). Test setup uses the
// service role; the app writes only through app.create_product, app.create_product_from_artwork,
// app.add_product_markets, app.set_product_stage and app.register_artwork.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { parse } from "yaml";
import { REPO_ROOT } from "../visual/screens";
import { expectLikeBaseline } from "./support/baseline";
import { admin, haveStack, person, signIn, workspace, type Person } from "./support/people";

const maxDiff = (parse(fs.readFileSync(path.join(REPO_ROOT, "spec/nfr.yaml"), "utf8")) as { quality: { visual_max_diff_pixel_ratio: number } })
  .quality.visual_max_diff_pixel_ratio;

// Design regions at 1600 px (docs/20 §4), compared where the screen draws the design's own static content:
//   S-NV2-022 "Also accepted later", the panel at x 870, y 445, 320 × 142;
//   S-NV2-023 the three notes ("Not deleted", "Out of the numbers", "Reversible"), x 242, y 598, 948 × 111;
//   S-PLN-004 the "One free label left" panel, x 267, y 317, 521 × 186.
const ALSO_LATER = { x: 870, y: 445, width: 320, height: 142, fractionY: 0 };
const NOTES = { x: 242, y: 598, width: 948, height: 111, fractionY: 0 };
const LAST_LABEL = { x: 267, y: 317, width: 521, height: 186, fractionY: 0 };

const SYNTH = path.join(REPO_ROOT, "fixtures/synth/out");
function fixture(name: string) {
  const file = path.join(SYNTH, `${name}.pdf`);
  if (!fs.existsSync(file)) {
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

const db = () => admin().schema("app");

async function count(table: "families" | "products" | "artwork_versions", ws: string) {
  const { count: n, error } = await db().from(table).select("id", { count: "exact", head: true }).eq("workspace_id", ws);
  if (error) throw error;
  return n ?? 0;
}

async function labelsUsed(ws: string) {
  const { data, error } = await db().from("allowances").select("labels_used").eq("workspace_id", ws).single();
  if (error) throw error;
  return data.labels_used;
}

async function setUsed(ws: string, used: number) {
  const { error } = await db().from("allowances").update({ labels_used: used }).eq("workspace_id", ws);
  if (error) throw error;
}

/** A product made the way the app makes one: the editor's own app.create_product. */
async function createAs(who: Person, ws: string, name: string, family?: string) {
  const { data, error } = await who.db.schema("app").rpc("create_product", {
    p_ws: ws,
    p_name: name,
    p_family: family,
    p_family_name: family ? undefined : name,
    p_stage: "in_development",
    p_nodes: ["EU-DE"],
  });
  if (error) throw error;
  return data as string;
}

async function familyOf(productId: string) {
  const { data, error } = await db().from("products").select("family_id").eq("id", productId).single();
  if (error) throw error;
  return data.family_id;
}

test.describe("products, families, stages and the free allowance", () => {
  test.skip(!haveStack(), "needs the local Supabase stack: run through scripts/ci/e2e.sh (make e2e)");
  test.describe.configure({ mode: "serial" });

  let editor: Person, viewer: Person;
  let ws: string;

  test.beforeAll(async () => {
    [editor, viewer] = await Promise.all([person("t401-editor"), person("t401-viewer")]);
    ws = await workspace(editor, "Halden Products Test");
    await workspace(viewer, "Viewer's own");
    const { data: v, error } = await db().from("people").select("id").eq("user_id", viewer.userId).single();
    if (error) throw error;
    const grant = await db().from("memberships").insert({ workspace_id: ws, person_id: v.id, role: "viewer" });
    if (grant.error) throw grant.error;
  });

  test("[C01.main] Create a product and family: the main path works end to end", async ({ page, context, baseURL }) => {
    await signIn(context, editor, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/products/new`);
    await expect(page.getByRole("heading", { level: 1, name: "Add a product" })).toBeVisible();
    await axe(page);
    await expectLikeBaseline(page, page.getByText("Also accepted later").locator(".."), "S-NV2-022", ALSO_LATER, maxDiff);

    await page.getByLabel("Product name").fill("Salmon & Rice Adult 12 kg");
    await page.getByLabel("New family name").fill("Salmon & Rice Adult");
    await page.getByLabel("Life stage").fill("adult maintenance");
    await page.getByLabel("Format").fill("complete feed · dry");
    await page.getByRole("checkbox", { name: "DE", exact: true }).check();
    await page.getByRole("checkbox", { name: "FR", exact: true }).check();
    await page.getByText("ACTIVE", { exact: true }).click();
    await expect(page.locator("[data-family-title]")).toHaveText("Salmon & Rice Adult · 1 product");
    await page.getByRole("button", { name: "Create product" }).click();

    await expect(page).toHaveURL(new RegExp(`/w/${ws}/products/[0-9a-f-]{36}/check\\?created=1$`));
    await expect(page.getByRole("heading", { level: 1, name: "Salmon & Rice Adult 12 kg" })).toBeVisible();
    await expect(page.locator("[data-market-line]")).toHaveText("EU · DE, FR");
    await expect(page.locator("[data-current-stage]")).toHaveAttribute("data-current-stage", "active");
    const productId = page.url().split("/products/")[1].split("/")[0];
    const { data: row } = await db().from("products").select("name, stage, species, life_stage, format, families(name)").eq("id", productId).single();
    expect(row).toMatchObject({ name: "Salmon & Rice Adult 12 kg", stage: "active", species: "dog", life_stage: "adult maintenance", format: "complete feed · dry", families: { name: "Salmon & Rice Adult" } });
    const { data: nodes } = await db().from("product_nodes").select("node_id, display_state").eq("product_id", productId).order("node_id");
    expect(nodes).toEqual([{ node_id: "EU-DE", display_state: "not_assessed" }, { node_id: "EU-FR", display_state: "not_assessed" }]);
    expect(errors).toEqual([]);
  });

  test("[C03.main] [C03.must.1] Add a variant to a family: a pack size joins its family, no new billable family", async ({ page, context, baseURL }) => {
    const base = await createAs(editor, ws, "Lamb Adult 3 kg");
    const family = await familyOf(base);
    const families = await count("families", ws);
    await signIn(context, editor, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/products/new?family=${family}`);
    await expect(page.getByLabel("Family")).toHaveValue(family);
    await expect(page.getByRole("link", { name: "Lamb Adult 3 kg" })).toBeVisible();
    await page.getByLabel("Product name").fill("Lamb Adult 12 kg");
    await expect(page.locator("[data-family-title]")).toHaveText("Lamb Adult 3 kg · 2 products");
    await page.getByRole("button", { name: "Create product" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Lamb Adult 12 kg" })).toBeVisible();
    const productId = page.url().split("/products/")[1].split("/")[0];
    expect(await familyOf(productId)).toBe(family);
    expect(await count("families", ws)).toBe(families);
    const { data: counts } = await editor.db.schema("app").rpc("live_billable_counts", { p_ws: ws });
    expect((counts as { recipes: number }).recipes).toBe(families);
    expect(errors).toEqual([]);
  });

  test("[C01.must.2] [C01.fail.1] Over a paid plan's recipes: the next plan is offered, nothing is created, no larger invoice", async ({ page, context, baseURL }) => {
    const owner = await person("t401-basic");
    const paid = await workspace(owner, "Basic Workspace");
    await createAs(owner, paid, "Only recipe");
    await db().from("workspaces").update({ plan: "basic" }).eq("id", paid);
    const sub = await db().from("subscriptions").insert({ workspace_id: paid, plan: "basic", status: "active", recipes_included: 1, editor_seats: 3 });
    if (sub.error) throw sub.error;
    await signIn(context, owner, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${paid}/products/new`);
    await page.getByLabel("Product name").fill("A second recipe");
    await page.getByRole("button", { name: "Create product" }).click();
    const refusal = page.locator('[data-refusal="P0034"]');
    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText("Every recipe on your plan is in use");
    await expect(refusal).toContainText("nothing was added to your invoice");
    await expect(refusal.getByRole("link", { name: "See Standard" })).toHaveAttribute("href", `/w/${paid}/billing/plans`);
    await axe(page);
    expect(await count("families", paid)).toBe(1);
    expect(await count("products", paid)).toBe(1);
    const { data: s } = await db().from("subscriptions").select("plan, recipes_included").eq("workspace_id", paid).single();
    expect(s).toEqual({ plan: "basic", recipes_included: 1 });
    expect(errors).toEqual([]);
  });

  test("[C04.main] [C04.must.1] Change a product's stage: discontinued leaves the counts, stays resolvable, and comes back", async ({ page, context, baseURL }) => {
    const productId = await createAs(editor, ws, "Ocean Fish Adult 2 kg");
    const before = (await editor.db.schema("app").rpc("live_billable_counts", { p_ws: ws })).data as { recipes: number };
    await signIn(context, editor, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/products/${productId}/check`);
    await page.getByLabel("Change to").selectOption("discontinued");
    await page.getByLabel("Reason recorded (optional)").fill("Pack size withdrawn from retail");
    await page.getByRole("button", { name: "Change stage" }).click();
    await expect(page.locator("[data-current-stage]")).toHaveAttribute("data-current-stage", "discontinued");
    const after = (await editor.db.schema("app").rpc("live_billable_counts", { p_ws: ws })).data as { recipes: number };
    expect(after.recipes).toBe(before.recipes - 1);
    const { data: audit } = await db().from("audit_events").select("before, after").eq("object_id", productId).eq("kind", "product.stage_changed").single();
    expect(audit).toEqual({ before: { stage: "in_development" }, after: { stage: "discontinued", reason: "Pack size withdrawn from retail" } });

    await page.goto(`/w/${ws}/products/discontinued`);
    await expect(page.getByRole("heading", { level: 1, name: "Discontinued products" })).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: "Ocean Fish Adult 2 kg" });
    await expect(row).toContainText("Pack size withdrawn from retail");
    await expect(row).toContainText("Never checked");
    await axe(page);
    await expectLikeBaseline(page, page.locator("[data-discontinued-notes]"), "S-NV2-023", NOTES, maxDiff);

    // Reversible: from the product, back to active; it leaves the list.
    await row.getByRole("link", { name: "Ocean Fish Adult 2 kg" }).click();
    await page.getByLabel("Change to").selectOption("active");
    await page.getByRole("button", { name: "Change stage" }).click();
    await expect(page.locator("[data-current-stage]")).toHaveAttribute("data-current-stage", "active");
    await page.goto(`/w/${ws}/products/discontinued`);
    await expect(page.getByRole("row").filter({ hasText: "Ocean Fish Adult 2 kg" })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("[C02.main] [C02.must.1] Create a product from an artwork: the label file makes the product and registers its artwork", async ({ page, context, baseURL }) => {
    const owner = await person("t401-c02");
    const fresh = await workspace(owner, "From Artwork");
    await signIn(context, owner, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${fresh}/products/new`);
    await page.waitForLoadState("networkidle"); // hydrated: the input's change handler is attached
    await page.getByLabel("Label file", { exact: true }).setInputFiles(fixture("clean_3lang"));
    await expect(page).toHaveURL(new RegExp(`/w/${fresh}/products/[0-9a-f-]{36}/check$`), { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1, name: "clean 3lang" })).toBeVisible();
    const productId = page.url().split("/products/")[1].split("/")[0];
    const { data: versions } = await db().from("artwork_versions").select("version, is_new_artwork").eq("product_id", productId);
    expect(versions).toEqual([{ version: 1, is_new_artwork: true }]);
    expect(await labelsUsed(fresh)).toBe(1);
    const { data: jobs } = await db().from("jobs").select("kind").eq("workspace_id", fresh).eq("kind", "extract");
    expect(jobs).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  test("[C02.fail.1] An unsupported file type is rejected before upload, and before any product is made", async ({ page, context, baseURL }) => {
    await signIn(context, editor, baseURL!);
    const products = await count("products", ws);
    const sent: string[] = [];
    page.on("request", (r) => {
      if (/\/storage\/v1\/|create_product_from_artwork|register_artwork/.test(r.url())) sent.push(r.url());
    });
    await page.goto(`/w/${ws}/products/new`);
    await page.waitForLoadState("networkidle"); // hydrated: the input's change handler is attached
    await page.getByLabel("Label file", { exact: true }).setInputFiles({ name: "label.pdf", mimeType: "application/pdf", buffer: Buffer.from("GIF89a, renamed") });
    await expect(page.getByText("This is not a PDF, PNG or JPEG file.")).toBeVisible();
    await axe(page);
    expect(sent).toEqual([]);
    expect(await count("products", ws)).toBe(products);
  });

  test("[B02.main] [B02.must.1] Use the free label allowance: the counter, the last-label panel, one email, and free extras", async ({ page, context, baseURL }) => {
    const owner = await person("t401-b02");
    const free = await workspace(owner, "Free Allowance");
    const first = await createAs(owner, free, "First label");
    await setUsed(free, 2);
    await signIn(context, owner, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${free}/products/${first}/check`);
    await expect(page.locator("[data-allowance-counter]")).toHaveText("1 of 3 free labels left");
    await expect(page.getByRole("heading", { name: "One free label left" })).toBeVisible();
    await axe(page);
    await expectLikeBaseline(page, page.locator("[data-last-label]"), "S-PLN-004", LAST_LABEL, maxDiff);

    // Further markets never count.
    await page.getByRole("button", { name: "Add markets" }).click();
    await page.getByRole("checkbox", { name: "NL", exact: true }).check();
    await page.getByRole("button", { name: "Add markets" }).click();
    await expect(page.locator("[data-market-line]")).toHaveText("EU · DE, NL");
    expect(await labelsUsed(free)).toBe(2);

    // The third label: counted once, one email queued; a revision of it never counts.
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Choose a file" }).click();
    await (await chooser).setFiles(fixture("clean_3lang"));
    await expect.poll(() => labelsUsed(free), { timeout: 30_000 }).toBe(3);
    const { data: notify } = await db().from("jobs").select("idempotency_key, payload").eq("workspace_id", free).eq("kind", "notify");
    expect(notify).toEqual([{ idempotency_key: `allowance:${free}`, payload: { template: "allowance_used" } }]);
    const revised = await owner.db.schema("app").rpc("register_artwork", { p_product: first, p_storage_path: `${free}/${first}/${"b".repeat(64)}.pdf`, p_sha256: "b".repeat(64) });
    expect(revised.error).toBeNull();
    expect(await labelsUsed(free)).toBe(3);
    await page.reload();
    await expect(page.locator("[data-allowance-counter]")).toHaveText("3 of 3 free labels used");
    expect(errors).toEqual([]);
  });

  test("[B02.fail.1] [B02.must.2] Allowance used: P0032 and the upsell; everything checked stays readable, re-checks stay free", async ({ page, context, baseURL }) => {
    const owner = await person("t401-spent");
    const spent = await workspace(owner, "Spent Allowance");
    const checked = await createAs(owner, spent, "Checked label");
    const reg = await owner.db.schema("app").rpc("register_artwork", { p_product: checked, p_storage_path: `${spent}/${checked}/${"c".repeat(64)}.pdf`, p_sha256: "c".repeat(64) });
    expect(reg.error).toBeNull();
    const fresh = await createAs(owner, spent, "A fourth label");
    await setUsed(spent, 3);
    await signIn(context, owner, baseURL!);
    const errors = watch(page);

    await page.goto(`/w/${spent}/products/${fresh}/check`);
    await expect(page.getByRole("heading", { name: "You have used all three free labels" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Pick a plan" })).toHaveAttribute("href", `/w/${spent}/billing/plans`);
    await expect(page.locator("[data-artwork-upload]")).toHaveCount(0);
    await axe(page);

    // The checked label stays readable and keeps its free re-checks and revisions.
    await page.goto(`/w/${spent}/products/${checked}/check`);
    await expect(page.locator("[data-artwork-upload]")).toBeVisible();
    await expect(page.getByRole("heading", { name: "You have used all three free labels" })).toHaveCount(0);
    const again = await owner.db.schema("app").rpc("register_artwork", { p_product: checked, p_storage_path: `${spent}/${checked}/${"d".repeat(64)}.pdf`, p_sha256: "d".repeat(64) });
    expect(again.error).toBeNull();

    // A label file now is refused with P0032 before any product exists.
    const products = await count("products", spent);
    await page.goto(`/w/${spent}/products/new`);
    await page.waitForLoadState("networkidle"); // hydrated: the input's change handler is attached
    await page.getByLabel("Label file", { exact: true }).setInputFiles(fixture("clean_3lang"));
    await expect(page.locator("[data-start-from-label]")).toContainText("All three free labels are used");
    await expect(page.locator("[data-start-from-label]").getByRole("link", { name: "Pick a plan" })).toBeVisible();
    expect(await count("products", spent)).toBe(products);

    // Per workspace: the editor's own workspace is untouched by this one's spent allowance.
    expect(await labelsUsed(ws)).toBeLessThan(3);
    // PostgREST answers a raised P-code other than P0001 with HTTP 500, so the expected P0032 refusal shows as a failed
    // request in the browser console; the screen handled it above. Nothing else may fail.
    const expected = (e: string) => /rpc\/create_product_from_artwork$/.test(e) || /status of 500/.test(e);
    expect(errors.filter((e) => !expected(e))).toEqual([]);
    expect(errors.filter(expected)).toHaveLength(2);
  });

  test("a viewer gets the no-permission state on Add a product, and reads Discontinued", async ({ page, context, baseURL }) => {
    await signIn(context, viewer, baseURL!);
    await page.goto(`/w/${ws}/products/new`);
    await expect(page.getByText("Your role cannot open Add a product")).toBeVisible();
    await axe(page);
    await page.goto(`/w/${ws}/products/discontinued`);
    await expect(page.getByRole("heading", { level: 1, name: "Discontinued products" })).toBeVisible();
  });

  test("the empty Discontinued state and no dead controls on Add a product and Discontinued", async ({ page, context, baseURL }) => {
    const owner = await person("t401-empty");
    const empty = await workspace(owner, "Nothing Discontinued");
    await signIn(context, owner, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${empty}/products/discontinued`);
    await expect(page.getByText("No product is discontinued")).toBeVisible();
    await axe(page);
    await page.locator("main").getByRole("link", { name: "Add a product" }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${empty}/products/new$`));

    // Add a product: every button does something (the two submits are covered above; the file button opens a chooser).
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Choose a file" }).click();
    await chooser;
    const buttons = page.locator('main[data-screen="S-NV2-022"]').locator("button").filter({ visible: true });
    await expect(buttons).toHaveCount(3);
    expect(errors).toEqual([]);
  });
});
