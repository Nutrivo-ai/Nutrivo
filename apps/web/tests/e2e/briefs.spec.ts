// T-1001 · E01 Create a brief on Brief & formula (S-NV2-004), on the full local stack (scripts/ci/e2e.sh). The
// product is made at stage brief by the editor's own app.create_product (C01); the screen then writes only through
// app.set_formula_lines and app.set_intended_claims. The register is empty on the local stack (the K0x imports do not
// run here), so two synthetic rows, named as test rows, are added as the service role for the person to pick (#76 Q3):
// @local-only, never against staging. That entering a formula makes a check's additive rules run is proven in pgTAP
// (supabase/tests/app/96_briefs.test.sql) and in the worker (tests/test_check_pg.py), where a ruleset can be seeded.
import { expect, test, type Page } from "@playwright/test";
import { expectLikeBaseline } from "./support/baseline";
import { admin, haveStack, person, signIn, workspace, type Person } from "./support/people";
import { axe, maxDiffPixelRatio, watch } from "./support/public";

// S-NV2-004 at 1600 px: "The brief" frame is the box at x 242, y 90.6875, 586 wide; its top 60 px (frame, the "The brief"
// kicker and the first row's field labels) are compared. The field values below carry the design's sample product.
const BRIEF_HEAD = { x: 242, y: 90, width: 586, height: 60, fractionY: 0.6875 };
const MATERIAL = { number: "TEST.E01.1", name: "Test chicken liver (E01 e2e row)" };
const ADDITIVE = { id: "TEST-E01-3b", name: "Test zinc chelate (E01 e2e row)" };

async function seedRegister() {
  const ref = admin().schema("ref");
  const fm = await ref.from("feed_materials").upsert({ number: MATERIAL.number, names: { en: MATERIAL.name } });
  if (fm.error) throw fm.error;
  const fa = await ref.from("feed_additives").upsert({ id: ADDITIVE.id, name: ADDITIVE.name });
  if (fa.error) throw fa.error;
}

async function personId(who: Person) {
  const { data, error } = await admin().schema("app").from("people").select("id").eq("user_id", who.userId).single();
  if (error) throw error;
  return data.id as string;
}

async function pick(page: Page, line: number, query: string, result: string) {
  await page.getByRole("button", { name: new RegExp(`^Line ${line}: register match`) }).click();
  const dialog = page.getByRole("dialog", { name: "Pick the register row" });
  await dialog.getByLabel("Feed material or additive: name or number").fill(query);
  await dialog.getByRole("button", { name: "Search" }).click();
  await dialog.getByRole("button", { name: new RegExp(result) }).click();
  await expect(dialog).toBeHidden();
}

test.describe("@local-only Brief & formula (E01)", () => {
  test.skip(!haveStack(), "needs the local stack (scripts/ci/e2e.sh)");
  test.describe.configure({ mode: "serial" });
  test.use({ viewport: { width: 1600, height: 1000 } });

  let editor: Person, viewer: Person, ws: string, productId: string;

  test.beforeAll(async () => {
    [editor, viewer] = await Promise.all([person("t1001-editor"), person("t1001-viewer")]);
    ws = await workspace(editor, "T-1001 briefs");
    await workspace(viewer, "Viewer's own");
    const grant = await admin().schema("app").from("memberships").insert({ workspace_id: ws, person_id: await personId(viewer), role: "viewer" });
    if (grant.error) throw grant.error;
    await seedRegister();
    const created = await editor.db.schema("app").rpc("create_product", {
      p_ws: ws,
      p_name: "Senior Joint Support Wet",
      p_family_name: "Senior Joint Support Wet",
      p_stage: "brief",
      p_species: "dog",
      p_nodes: ["EU-DE"],
    });
    if (created.error) throw created.error;
    productId = created.data as string;
  });

  test("[E01.main] Create a brief: the main path works end to end", async ({ page, context, baseURL }) => {
    const errors = watch(page);
    await signIn(context, editor, baseURL!);
    await page.goto(`/w/${ws}/briefs/${productId}`);
    await expect(page.getByRole("heading", { name: "Senior Joint Support Wet — working brief" })).toBeVisible();

    // Empty: no formula yet, and the screen says what that does to a check.
    await expect(page.getByText("No formula has been entered")).toBeVisible();
    await expect(page.locator("[data-formula-changes-outcomes]")).toContainText("This formula changes check results");
    await expect(page.locator('[data-field="Product class"]')).toHaveText("Not determined");
    await expect(page.locator('[data-field="Target nodes"]')).toHaveText("EU · DE");
    for (const absent of ["Upload", "Import from spec", "Screen this brief", "What we can answer with this"]) {
      await expect(page.locator("main").getByText(absent, { exact: true })).toHaveCount(0);
    }
    await axe(page);
    await expectLikeBaseline(page, page.locator('section[aria-labelledby="the-brief"]'), "S-NV2-004", BRIEF_HEAD, maxDiffPixelRatio);

    // Paste: three lines, none matched to the register until the person picks.
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Paste", exact: true }).click();
    const paste = page.getByRole("dialog", { name: "Paste the formula" });
    await paste.getByRole("textbox").fill("Chicken liver, 12.0\nZinc chelate 180 mg/kg\nBotanical blend 4B, 0.6");
    await expect(paste.getByText("3 lines read")).toBeVisible();
    await paste.getByRole("button", { name: "Add these lines" }).click();
    await expect(page.locator("[data-matched]")).toHaveText("0 of 3 ingredients matched to the register");
    await expect(page.locator('[data-note="not-matched"]')).toHaveCount(3);
    await axe(page);

    await pick(page, 1, "Test chicken liver", MATERIAL.number);
    await pick(page, 2, "Test zinc", ADDITIVE.id);
    await expect(page.locator("[data-matched]")).toHaveText("2 of 3 ingredients matched to the register");
    await expect(page.locator('[data-note="not-matched"]')).toHaveCount(1);

    // Add a line, then remove it again; Discard is offered while there are changes.
    await page.getByRole("button", { name: "Add a line" }).click();
    await expect(page.locator("tr[data-line]")).toHaveCount(4);
    await page.getByRole("button", { name: "Remove line 4" }).click();
    await expect(page.locator("tr[data-line]")).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Discard changes" })).toBeVisible();

    await page.getByRole("button", { name: "Save formula" }).click();
    await expect(page.locator('[data-status="saved"]')).toContainText("Formula saved: 3 lines");

    // Intended claims: the customer's German text, as typed.
    await page.getByLabel("Language").selectOption("de");
    await page.getByLabel("Claims, one per line").fill("Unterstützt die Gelenkbeweglichkeit\nFür ältere Hunde");
    await page.getByRole("button", { name: "Save DE claims" }).click();
    await expect(page.getByText("Saved 2 claims in DE.")).toBeVisible();

    // Read back after a reload, under RLS.
    await page.reload();
    await expect(page.locator("tr[data-line]")).toHaveCount(3);
    await expect(page.locator("[data-matched]")).toHaveText("2 of 3 ingredients matched to the register");
    await expect(page.getByRole("button", { name: /^Line 2: register match, Additive TEST-E01-3b/ })).toBeVisible();
    await expect(page.locator('[data-field="Intended claim"]')).toHaveText("Unterstützt die Gelenkbeweglichkeit");
    await axe(page);

    // What was stored: a person applied every line (E03), in order, with the rows they picked; both writes audited.
    const service = admin().schema("app");
    const lines = await service.from("formula_lines").select("position, ingredient, feed_material_ref, additive_ref, percent, amount, unit, applied_by")
      .eq("product_id", productId).order("position");
    if (lines.error) throw lines.error;
    const me = await personId(editor);
    expect(lines.data.map((l) => [l.ingredient, l.feed_material_ref, l.additive_ref, l.applied_by])).toEqual([
      ["Chicken liver", MATERIAL.number, null, me],
      ["Zinc chelate", null, ADDITIVE.id, me],
      ["Botanical blend 4B", null, null, me],
    ]);
    expect([Number(lines.data[1].amount), lines.data[1].unit]).toEqual([180, "mg/kg"]);
    const claims = await service.from("intended_claims").select("language, claim_text").eq("product_id", productId).order("created_at");
    if (claims.error) throw claims.error;
    expect(claims.data).toEqual([
      { language: "de", claim_text: "Unterstützt die Gelenkbeweglichkeit" },
      { language: "de", claim_text: "Für ältere Hunde" },
    ]);
    const audit = await service.from("audit_events").select("kind").eq("object_id", productId).in("kind", ["formula.set", "intended_claims.set"]);
    if (audit.error) throw audit.error;
    expect(audit.data.map((a) => a.kind).sort()).toEqual(["formula.set", "intended_claims.set"]);
    expect(errors).toEqual([]);
  });

  test("a match can be cleared, and a change can be discarded", async ({ page, context, baseURL }) => {
    await signIn(context, editor, baseURL!);
    await page.goto(`/w/${ws}/briefs/${productId}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /^Line 1: register match/ }).click();
    const dialog = page.getByRole("dialog", { name: "Pick the register row" });
    await dialog.getByRole("button", { name: "Clear the match" }).click();
    await expect(page.locator("[data-matched]")).toHaveText("1 of 3 ingredients matched to the register");
    await page.getByRole("button", { name: "Discard changes" }).click();
    await expect(page.locator("[data-matched]")).toHaveText("2 of 3 ingredients matched to the register");
    // A search the register cannot answer says so, and leaves the line as it is.
    await page.getByRole("button", { name: /^Line 3: register match/ }).click();
    await dialog.getByLabel("Feed material or additive: name or number").fill("Botanical blend 4B");
    await dialog.getByRole("button", { name: "Search" }).click();
    await expect(dialog.getByText("No feed material or additive in the register matches.")).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
  });

  test("a viewer gets the no-permission state, and another workspace's product reads as not found", async ({ page, context, baseURL }) => {
    await signIn(context, viewer, baseURL!);
    await page.goto(`/w/${ws}/briefs/${productId}`);
    await expect(page.getByText("Your role cannot open Brief & formula")).toBeVisible();
    await expect(page.locator("tr[data-line]")).toHaveCount(0);
    await axe(page);
    await signIn(context, editor, baseURL!);
    await page.goto(`/w/${ws}/briefs/00000000-0000-4000-8101-000000000000`);
    await expect(page.getByText("This product is not in this workspace")).toBeVisible();
    await axe(page);
  });
});
