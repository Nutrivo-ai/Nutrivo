// T-504 · Obligations (G01, S-NV2-008) and the registration pack (G02, G03, S-NV2-020) on the full local stack.
// Products are made the way the app makes them (app.create_product as their admin). No obligation is written: none is
// eligible until a person can accept one (#54 Q4), so every market reads not assessed. The screens read under the
// viewer's session (RLS), axe runs on every state, and every control on them is clicked (no dead controls, docs/20).
import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { parse } from "yaml";
import { REPO_ROOT } from "../visual/screens";
import { expectLikeBaseline } from "./support/baseline";
import { admin, haveStack, person, signIn, workspace, type Person } from "./support/people";

const nfr = parse(fs.readFileSync(path.join(REPO_ROOT, "spec/nfr.yaml"), "utf8")) as {
  quality: { visual_max_diff_pixel_ratio: number; axe_serious_or_critical: number };
};

// The S-NV2-008 baseline's introduction at 1600 px (design box from the "obligations" screen). The design's table,
// with its Obligation, Products, Due and Status columns, has no backing data (#54 Q5) and is not compared.
const INTRO = { x: 242, y: 90, width: 948, height: 46, fractionY: 0.6875 } as const;

/** Controls a registration screen must never offer: Nutrivo never submits, files, pays or prepares a pack (G02.must.1). */
const FORBIDDEN = /submit|\bfile\b|filing|pay|prepare|download/i;

function watch(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
  });
  return errors;
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  expect(serious.length).toBeLessThanOrEqual(nfr.quality.axe_serious_or_critical);
}

async function personId(who: Person) {
  const { data, error } = await admin().schema("app").from("people").select("id").eq("user_id", who.userId).single();
  if (error) throw error;
  return data.id as string;
}

async function product(who: Person, ws: string, name: string, nodes: string[]) {
  const { data, error } = await who.db.schema("app").rpc("create_product", {
    p_ws: ws,
    p_name: name,
    p_family_name: name,
    p_stage: "active",
    p_nodes: nodes,
  });
  if (error) throw error;
  return data as string;
}

/** The accessible names of every button and link in the screen's main region. */
async function controlNames(page: Page) {
  const main = page.locator("main");
  const names: string[] = [];
  for (const role of ["button", "link"] as const) {
    for (const c of await main.getByRole(role).all()) names.push(((await c.textContent()) ?? "").trim());
  }
  return names;
}

const obligationsOf = (ws: string) => `/w/${ws}/obligations`;
const packOf = (ws: string, p: string, node: string) => `/w/${ws}/products/${p}/nodes/${node}/registration`;

test.describe("Registration", () => {
  test.skip(!haveStack(), "needs the local Supabase stack: run through scripts/ci/e2e.sh (make e2e)");
  test.describe.configure({ mode: "serial" });

  let ada: Person, vic: Person, other: Person;
  let ws: string, salmon: string;

  test.beforeAll(async () => {
    [ada, vic, other] = await Promise.all([person("t504-ada"), person("t504-vic"), person("t504-oto")]);
    ws = await workspace(ada, "Halden Pet Nutrition");
    await workspace(vic, "Vic's own");
    await workspace(other, "Other workspace");
    salmon = await product(ada, ws, "Salmon & Rice 12 kg", ["EU-DE", "EU-BE"]);
    await product(ada, ws, "Senior Joint Support", ["EU-DE"]);
    const grant = await admin()
      .schema("app")
      .from("memberships")
      .insert({ workspace_id: ws, person_id: await personId(vic), role: "viewer" });
    if (grant.error) throw grant.error;
  });

  test("[G01.main] every market reads no sourced obligation held, registration not assessed, with its gap", async ({ page, context, baseURL }) => {
    await signIn(context, ada, baseURL!);
    const errors = watch(page);
    await page.goto(obligationsOf(ws));
    await expect(page.getByTestId("obligations-intro")).toBeVisible();
    await expect(page.locator("[data-market]")).toHaveCount(2);
    // Germany sells two products, Belgium one: Germany first.
    await expect(page.locator("[data-market]").first()).toHaveAttribute("data-market", "EU-DE");
    for (const node of ["EU-DE", "EU-BE"]) {
      const m = page.locator(`[data-market="${node}"]`);
      await expect(m).toHaveAttribute("data-market-state", "not_assessed");
      await expect(m).toContainText("No sourced obligation held for this market.");
      await expect(m).toContainText("Registration not assessed.");
      await expect(m.locator("[data-obligation]")).toHaveCount(0);
      await expect(m.getByRole("link", { name: `GAP GAP-${node}-REGISTRATION · why is this not assessed` })).toBeVisible();
    }
    for (const name of await controlNames(page)) expect(name).not.toMatch(FORBIDDEN);
    await axe(page);
    await expectLikeBaseline(page, page.getByTestId("obligations-intro"), "S-NV2-008", INTRO, nfr.quality.visual_max_diff_pixel_ratio);

    // No dead controls: each gap link opens its coverage node.
    for (const node of ["EU-DE", "EU-BE"]) {
      await page.goto(obligationsOf(ws));
      await page.locator(`[data-market="${node}"]`).getByRole("link").click();
      await expect(page).toHaveURL(new RegExp(`/w/${ws}/library/coverage/${node}#GAP-${node}-REGISTRATION$`));
    }
    expect(errors).toEqual([]);
  });

  test("[G01.main] a workspace with no product on a market gets the empty state", async ({ page, context, baseURL }) => {
    await signIn(context, other, baseURL!);
    const fresh = await workspace(other, "Empty workspace");
    const errors = watch(page);
    await page.goto(obligationsOf(fresh));
    await expect(page.getByText("No product is on a market yet")).toBeVisible();
    await expect(page.locator("[data-market]")).toHaveCount(0);
    await axe(page);
    await page.locator("main").getByRole("link", { name: "Add a product" }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${fresh}/products/new$`));
    expect(errors).toEqual([]);
  });

  test("[G02.main] the registration pack's checklist is read only and not assessed; registration is unknown, never Clear", async ({ page, context, baseURL }) => {
    await signIn(context, vic, baseURL!);
    const errors = watch(page);
    await page.goto(packOf(ws, salmon, "EU-DE"));
    await expect(page.locator("[data-registration-pack]")).toBeVisible();
    await expect(page.getByTestId("registration-state")).toHaveAttribute("data-registration-state", "unknown");
    await expect(page.getByTestId("registration-state")).toContainText("Unknown");
    await expect(page.getByTestId("display-state").locator('[data-state="clear"]')).toHaveCount(0);
    await expect(page.locator('[data-checklist="not_assessed"]')).toContainText("No sourced evidence list held. Checklist not assessed.");
    await expect(page.getByText("No sourced obligation held for this market.")).toBeVisible();
    // Read only: no checkbox, radio or other input in the checklist.
    await expect(page.locator("[data-checklist] input")).toHaveCount(0);
    await axe(page);
    expect(errors).toEqual([]);
  });

  test("[G02.must.1] neither screen offers a submit, file, pay, prepare-pack or download-form control", async ({ page, context, baseURL }) => {
    await signIn(context, ada, baseURL!);
    for (const url of [obligationsOf(ws), packOf(ws, salmon, "EU-DE"), packOf(ws, salmon, "EU-BE")]) {
      await page.goto(url);
      await expect(page.locator("main [data-obligations], main [data-registration-pack]").first()).toBeVisible();
      for (const name of await controlNames(page)) expect(name).not.toMatch(FORBIDDEN);
      await expect(page.getByText(/PREPARE PACK|DOWNLOAD FORM SET/)).toHaveCount(0);
      await expect(page.locator('main input[type="radio"]')).toHaveCount(0);
    }
  });

  test("[G03.main] a viewer reads the pack with no record form", async ({ page, context, baseURL }) => {
    await signIn(context, vic, baseURL!);
    const errors = watch(page);
    await page.goto(packOf(ws, salmon, "EU-DE"));
    await expect(page.getByTestId("record-no-permission")).toBeVisible();
    await expect(page.locator("[data-record-form]")).toHaveCount(0);
    await expect(page.locator("main").getByRole("button")).toHaveCount(0);
    // No dead controls: the only link is the market's gap.
    await page.locator("main").getByRole("link", { name: /GAP GAP-EU-DE-REGISTRATION/ }).click();
    await expect(page).toHaveURL(new RegExp(`/library/coverage/EU-DE#GAP-EU-DE-REGISTRATION$`));
    expect(errors).toEqual([]);
  });

  test("[G03.main] an editor records a registration and sees it registered, as recorded", async ({ page, context, baseURL }) => {
    await signIn(context, ada, baseURL!);
    const errors = watch(page);
    await page.goto(packOf(ws, salmon, "EU-BE"));
    const form = page.locator("[data-record-form]");
    await expect(form).toBeVisible();
    await expect(page.getByTestId("registration-state")).toHaveAttribute("data-registration-state", "unknown");
    await axe(page);

    // Refused before the database sees it: an expiry before the registration date.
    await form.getByLabel("Registration number").fill("SYN-REG-0001");
    await form.getByLabel("Registered on").fill("2026-10-01");
    await form.getByLabel("Expires (optional)").fill("2026-09-01");
    await form.getByRole("button", { name: "Record registration" }).click();
    await expect(form.locator('[data-refusal="invalid"]')).toBeVisible();
    // A refusal keeps what was typed.
    await expect(form.getByLabel("Registration number")).toHaveValue("SYN-REG-0001");
    await expect(form.getByLabel("Registered on")).toHaveValue("2026-10-01");

    await form.getByLabel("Expires (optional)").fill("2099-10-01");
    await form.getByRole("button", { name: "Record registration" }).click();
    await expect(page.getByTestId("recorded-number")).toHaveText("SYN-REG-0001");
    await expect(page.getByTestId("registration-state")).toHaveAttribute("data-registration-state", "registered");
    await expect(page.getByTestId("registration-state")).toContainText("Registered");
    // Registered is not Clear: the label in Belgium is not assessed, so the market stays withheld.
    await expect(page.getByTestId("display-state").locator('[data-state="clear"]')).toHaveCount(0);
    await axe(page);

    // The row and its audit event, written by the RPC under Ada's session.
    const row = await admin().schema("app").from("registrations").select("number, expires_at").eq("product_id", salmon).eq("node_id", "EU-BE");
    expect(row.error).toBeNull();
    expect(row.data).toEqual([{ number: "SYN-REG-0001", expires_at: "2099-10-01" }]);
    expect(errors).toEqual([]);
  });

  test("a person who is not a member gets no access and no registration", async ({ page, context, baseURL }) => {
    await signIn(context, other, baseURL!);
    const errors = watch(page);
    for (const url of [obligationsOf(ws), packOf(ws, salmon, "EU-DE")]) {
      await page.goto(url);
      await expect(page.getByText("This workspace is not open to you")).toBeVisible();
      await expect(page.locator("[data-registration-pack], [data-market]")).toHaveCount(0);
      await axe(page);
    }
    expect(errors).toEqual([]);
  });
});
