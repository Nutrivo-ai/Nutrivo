// T-402: classify the product (D03) on Upload & scope (S-NV2-002, "3 · Which rulebook applies"). Runs on the full
// local stack (scripts/ci/e2e.sh): the worker extracts the uploaded synthetic label and suggests a classification from
// its text through nutrivo_worker.models, replaying the recorded response (MODELS_MODE=replay), never a live call.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
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
// S-NV2-002 at 1600 px: the "3 · Which rulebook applies" frame is the box at x 870, y 90.6875, 320 wide; its top 100 px
// (frame, label and heading) are compared. The five rows below carry the design's sample product, and its "Challenge
// this determination" button waits on the confirmation write path (Q1 on #44).
const RULEBOOK_HEAD = { x: 870, y: 90, width: 320, height: 100, fractionY: 0.6875 };

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

/** A product to classify; no RPC creates one yet (asked on #41), so the test makes it as the service role. */
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

const panel = (page: Page) => page.getByTestId("classification");
const row = (page: Page, field: string) => panel(page).locator(`[data-field="${field}"]`);

test.describe("classify the product", () => {
  test.skip(!haveStack(), "needs the local Supabase stack and the worker: run through scripts/ci/e2e.sh (make e2e)");
  test.describe.configure({ mode: "serial" });

  let editor: Person;
  let ws: string;

  test.beforeAll(async () => {
    editor = await person("t402-editor");
    ws = await workspace(editor, "Halden Classification Test");
  });

  test("[D03.main] Classify the product: suggested from the label text with its citation, left unconfirmed for a person", async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(EXTRACTION_MS + 60_000);
    const productId = await product(ws, "Nordic Cat Adult 1.5 kg");
    await signIn(context, editor, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/products/${productId}/check`);
    await expect(panel(page)).toContainText("No classification yet.");
    await axe(page);

    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Choose a file" }).click();
    await (await chooser).setFiles({ name: "nordic-cat-adult.pdf", mimeType: "application/pdf", buffer: fs.readFileSync(fixture("clean_3lang")) });
    await expect(page.locator("[data-artwork-card]").filter({ visible: true })).toHaveAttribute("data-artwork-card", "succeeded", {
      timeout: EXTRACTION_MS,
    });

    // The suggestion, with the printed words each value rests on; the unsure fields are empty for the person.
    await expect(row(page, "species")).toContainText("Cat");
    await expect(row(page, "species")).toContainText("Label text “Complete feed for adult cats” · panel 1 · EN");
    await expect(row(page, "product_class")).toContainText("Complete feed");
    await expect(row(page, "intended_use")).toContainText("Not determined");
    await expect(row(page, "parnut_status")).toContainText("Not determined");
    await expect(panel(page).getByTestId("classification-status")).toContainText("not confirmed");
    await axe(page);
    await expectLikeBaseline(page, panel(page), "S-NV2-002", RULEBOOK_HEAD, maxDiff);

    // The database holds what the screen says: one insert-only row from the model, unconfirmed, with its model call.
    const service = admin().schema("app");
    const rows = await service.from("classifications").select("*").eq("product_id", productId);
    expect(rows.data).toHaveLength(1);
    const [c] = rows.data!;
    expect(c).toMatchObject({ provenance: "model_judgement", confirmed_at: null, confirmed_by: null, species: "cat", product_class: "complete" });
    expect(JSON.parse(c.citation)).toMatchObject({ basis: "label_text", fields: { species: { quote: "Complete feed for adult cats" } } });
    const call = await service.from("model_calls").select("purpose, prompt_version").eq("id", c.model_call_id!).single();
    expect(call.data).toEqual({ purpose: "classification", prompt_version: "classification.v1" });
    expect(errors).toEqual([]);
  });

  test("[D03.fail.1] The model is unsure: the fields are left empty for the person, never guessed", async ({ page, context, baseURL }) => {
    const productId = await product(ws, "Unclear Mixer 2 kg");
    const service = admin().schema("app");
    const inserted = await service.from("classifications").insert({
      workspace_id: ws,
      product_id: productId,
      citation: JSON.stringify({
        basis: "label_text",
        fields: {},
        empty: { species: "low_confidence", life_stage: "abstained", product_class: "quote_not_on_label", intended_use: "abstained", parnut_status: "abstained" },
      }),
      provenance: "model_judgement",
    });
    if (inserted.error) throw inserted.error;
    await signIn(context, editor, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/products/${productId}/check`);
    await expect(panel(page).getByText("Not determined")).toHaveCount(5);
    await expect(row(page, "species")).toContainText("Left for you: the suggestion was not sure enough");
    await expect(row(page, "product_class")).toContainText("Left for you: the quoted words are not on the label");
    await expect(panel(page).getByTestId("classification-status")).toContainText("0 of 5 filled");
    await axe(page);
    expect(errors).toEqual([]);
  });
});
