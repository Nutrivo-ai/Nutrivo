// T-703 · M01, M02, M03, M05 on the local stack: the plan picker reads live counts, checkout goes to Stripe-hosted
// Checkout (the fake Stripe in apps/web/tests/fake-stripe, which scripts/ci/e2e.sh points the web server at), the
// paid subscription comes back as Stripe's events, the invoice states its VAT, and cancelling leaves the workspace on
// Free with its data and its free export. The webhook leg is T-702's and is represented here by what it does: the
// stored event (app.payment_events, as the service role) and app.apply_subscription. Every screen passes axe.
// @local-only: these need the fake Stripe; a deployed environment's own test mode is not driven from here.
import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { parse } from "yaml";
import { REPO_ROOT } from "../visual/screens";
import { expectLikeBaseline } from "./support/baseline";
import { admin, haveStack, person, signIn, workspace, type Person } from "./support/people";

const nfr = parse(fs.readFileSync(path.join(REPO_ROOT, "spec/nfr.yaml"), "utf8")) as { quality: { visual_max_diff_pixel_ratio: number } };
const maxDiff = nfr.quality.visual_max_diff_pixel_ratio;

// Regions of the billing baselines at 1600 px that the design draws the same for any workspace (the static cards),
// measured from the design files. The rest of each screen carries the workspace's own counts, plan and invoices.
const REGION = {
  neverMetered: { x: 240, y: 991, width: 577, height: 292, fractionY: 0.078125 },
  notSigningUp: { x: 838, y: 683, width: 521, height: 139, fractionY: 0.203125 },
  itemised: { x: 244, y: 481, width: 430, height: 156, fractionY: 0.078125 },
  notOperator: { x: 950, y: 546, width: 621, height: 121, fractionY: 0.125 },
} as const;

type Json = Record<string, unknown>;
const STRIPE = process.env.STRIPE_API_BASE ?? "";

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
}

async function product(who: Person, ws: string, name: string, family: string) {
  const { data, error } = await who.db.schema("app").rpc("create_product", { p_ws: ws, p_name: name, p_family_name: family, p_nodes: ["EU-SE"] });
  if (error) throw error;
  return data;
}

async function personId(userId: string) {
  const { data, error } = await admin().schema("app").from("people").select("id").eq("user_id", userId).single();
  if (error) throw error;
  return data.id;
}

/** What the webhook leg does with a paid Checkout (T-702): store the invoice event and mirror the subscription. */
async function deliver(ws: string, sessionId: string, plan: string, term: "monthly" | "annual", extraSeats = 0) {
  const res = await fetch(`${STRIPE}/__fake/payments/${sessionId}`);
  expect(res.ok).toBe(true);
  const paid = (await res.json()) as { events: Json[]; subscription: Json; invoice: Json };
  const service = admin();
  for (const e of paid.events.filter((x) => x.type === "invoice.paid")) {
    const { error } = await service.schema("app").from("payment_events").insert({ stripe_event_id: String(e.id), workspace_id: ws, type: String(e.type), payload: e as never });
    if (error) throw error;
  }
  await applySubscription(ws, paid.subscription, plan, term, "active", extraSeats);
  return paid;
}

/** As the worker maps it (T-702): the plan's seats and recipes plus the add-on quantities on the subscription. */
async function applySubscription(ws: string, sub: Json, plan: string, term: string, status: string, extraSeats = 0) {
  const seats: Record<string, number | null> = { basic: 3, standard: 5, advanced: null };
  const recipes: Record<string, number | null> = { basic: 10, standard: 30, advanced: null };
  const { error } = await admin().schema("app").rpc("apply_subscription", {
    p_ws: ws,
    p_snapshot: {
      customer_id: String(sub.customer), subscription_id: String(sub.id), plan, term, status,
      editor_seats: seats[plan] === null ? null : seats[plan]! + extraSeats, recipes_included: recipes[plan],
      current_period_end: new Date(Number(sub.current_period_end) * 1000).toISOString(),
    },
    p_source: "webhook",
    p_ref: `e2e:${String(sub.id)}`,
  });
  if (error) throw error;
}

test.describe("billing @local-only", () => {
  test.skip(!haveStack() || !STRIPE, "needs the local Supabase stack and the fake Stripe: run through scripts/ci/e2e.sh (make e2e)");
  test.describe.configure({ mode: "serial" });

  let ada: Person, eve: Person, gus: Person;
  let ws: string;
  let sessionId = "";
  let invoiceId = "";
  const NAME = "Halden Pet Nutrition";

  test.beforeAll(async () => {
    [ada, eve, gus] = await Promise.all([person("t703-ada"), person("t703-eve"), person("t703-gus")]);
    ws = await workspace(ada, NAME);
    await Promise.all([workspace(eve, "Eve's agency"), workspace(gus, "Gus's own")]);
    // Eve is an external admin and Gus an editor of Halden (test setup only; the app writes memberships through RPCs).
    const grant = await admin().schema("app").from("memberships").insert([
      { workspace_id: ws, person_id: await personId(eve.userId), role: "admin", is_external: true },
      { workspace_id: ws, person_id: await personId(gus.userId), role: "editor", is_external: false },
    ]);
    if (grant.error) throw grant.error;
    for (let i = 1; i <= 3; i++) await product(ada, ws, `Adult dog ${i}`, `Recipe ${i}`);
  });

  test("[M02.main] Meter the dials: the plan picker reads the workspace's recipes, region and editors and names the plan that fits", async ({ page, context, baseURL }) => {
    await signIn(context, ada, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/billing/plans`);
    await expect(page.getByRole("heading", { level: 2, name: "Basic is the plan that fits what you already have" })).toBeVisible();
    await expect(page.getByTestId("usage-recipes")).toHaveText("3");
    await expect(page.getByTestId("usage-region")).toHaveText("1");
    await expect(page.getByTestId("usage-people-who-edit")).toHaveText("3"); // Ada, Eve (external) and Gus
    await expect(page.getByTestId("plan-basic")).toHaveAttribute("data-on", "true");
    await expect(page.getByTestId("plan-basic").getByRole("link", { name: "Continue to checkout" })).toBeVisible();
    // A fourth editor: Basic's list price plus one seat (€299) is under its €374 ceiling, so Basic still fits.
    const editors = await Promise.all(["t703-ian", "t703-jo", "t703-kim"].map((l) => person(l)));
    await Promise.all(editors.map((e, i) => workspace(e, `Own ${i}`)));
    const addEditor = async (who: Person) => {
      const { error } = await admin().schema("app").from("memberships").insert({ workspace_id: ws, person_id: await personId(who.userId), role: "editor", is_external: false });
      if (error) throw error;
    };
    await addEditor(editors[0]);
    await page.reload();
    await expect(page.getByRole("heading", { level: 2, name: "Basic is the plan that fits what you already have" })).toBeVisible();
    await expect(page.getByTestId("plan-basic").getByTestId("verdict")).toHaveText("Four editors: three included and one at €50 each a month. €299 a month in all.");
    // Six editors take Basic to €399, past its ceiling: the next plan is offered instead (BE-34).
    await addEditor(editors[1]);
    await addEditor(editors[2]);
    await page.reload();
    await expect(page.getByRole("heading", { level: 2, name: "Standard is the plan that fits what you already have" })).toBeVisible();
    await expect(page.getByTestId("plan-basic").getByTestId("verdict")).toContainText("That passes the €374 ceiling. The Standard plan is offered instead.");
    await expect(page.getByTestId("plan-basic").getByText("Too small for this workspace")).toBeVisible();
    // Past Basic's ceiling its checkout is refused too, not only hidden in the picker.
    await page.goto(`/w/${ws}/billing/checkout?plan=basic&term=monthly`);
    await expect(page.getByText("Basic cannot hold this workspace")).toBeVisible();
    await axe(page);
    expect(errors).toEqual([]);
  });

  test("[M02.must.1] Counts are read at request time, never nightly: a new recipe shows on the next request", async ({ page, context, baseURL }) => {
    await signIn(context, ada, baseURL!);
    await page.goto(`/w/${ws}/billing/plans`);
    await expect(page.getByTestId("usage-recipes")).toHaveText("3");
    await product(ada, ws, "Puppy wet", "Recipe 4");
    await page.reload();
    await expect(page.getByTestId("usage-recipes")).toHaveText("4");
    await page.goto(`/w/${ws}/settings/billing`);
    await expect(page.getByTestId("dial-recipes").getByTestId("count")).toHaveText("4 · no limit");
  });

  test("[M01.must.1] Prices are net; VAT is added on the invoice: every price says EXCL. VAT and checkout adds VAT at payment", async ({ page, context, baseURL }) => {
    await signIn(context, ada, baseURL!);
    await page.goto(`/w/${ws}/billing/plans`);
    for (const k of ["basic", "standard"]) await expect(page.getByTestId(`plan-${k}`).getByTestId("per")).toHaveText("PER MONTH · EXCL. VAT");
    await expect(page.getByTestId("plan-standard").getByTestId("price")).toHaveText("€499");
    await page.getByRole("button", { name: "Annual · two months free" }).click();
    await expect(page.getByTestId("plan-standard").getByTestId("price")).toHaveText("€4,990");
    await expect(page.getByTestId("plan-standard").getByTestId("per")).toHaveText("PER YEAR · EXCL. VAT");
    await page.getByRole("button", { name: "Monthly" }).click();
    await page.getByTestId("plan-standard").getByRole("link", { name: "Continue to checkout" }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${ws}/billing/checkout\\?plan=standard&term=monthly$`));
    await expect(page.getByTestId("order-net")).toHaveText("€499");
    // Six editors on Standard's five: one seat add-on, net like everything else.
    await expect(page.getByTestId("order-extra-editors")).toContainText("Extra editor seats · 1 × €50");
    // No billing address yet: VAT cannot be known, so it is added at payment and the total says so.
    await expect(page.getByTestId("order-vat")).toContainText("ADDED AT PAYMENT");
    await expect(page.getByTestId("due")).toHaveText("€549 + VAT");
    await axe(page);
  });

  test("[M01.main] Subscribe: the main path works end to end", async ({ page, context, baseURL }) => {
    test.setTimeout(120_000);
    await signIn(context, ada, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/billing/checkout?plan=standard&term=monthly`);
    await page.getByLabel(/Purchase order reference/).fill("PO-7781");
    await page.getByTestId("pay").click();
    // Stripe-hosted Checkout (the fake): the billing details and the VAT number are entered there.
    await page.waitForURL(/\/pay\/cs_test_/);
    sessionId = new URL(page.url()).pathname.split("/").pop()!;
    await page.getByLabel("Billing name").fill("Bergmann Tiernahrung GmbH");
    await page.getByLabel("VAT number").fill("DE123456789");
    await page.getByRole("button", { name: "Pay" }).click();
    // Decision 1 on #64: payment returns to Plan and allowance, which shows the plan once the webhook has applied it.
    await page.waitForURL(new RegExp(`/w/${ws}/settings/billing\\?from=checkout$`));
    await expect(page.getByTestId("applying")).toBeVisible();
    // A second checkout while the payment is being applied opens nothing (docs/18: one payment per workspace).
    await page.goto(`/w/${ws}/billing/checkout?plan=standard&term=monthly`);
    await page.getByTestId("pay").click();
    await expect(page.getByText("A payment for this workspace was just received")).toBeVisible();
    await page.goto(`/w/${ws}/settings/billing?from=checkout`);
    const paid = await deliver(ws, sessionId, "standard", "monthly", 1);
    invoiceId = String(paid.invoice.id);
    await expect(page.getByTestId("live-banner")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("live-banner")).toContainText("Standard is live.");
    await expect(page.getByTestId("plan-name")).toHaveText("Standard");
    // The session named the workspace from app.billing_context and asked Stripe for tax and the VAT number.
    const requests = (await (await fetch(`${STRIPE}/__fake/requests`)).json()) as { method: string; path: string; params: Json }[];
    const created = requests.find((r) => r.method === "POST" && r.path === "/v1/checkout/sessions" && r.params.client_reference_id === ws)!;
    expect(created.params).toMatchObject({ mode: "subscription", automatic_tax: { enabled: "true" }, tax_id_collection: { enabled: "true" }, subscription_data: { metadata: { workspace_id: ws } } });
    expect(created.params.line_items).toEqual([
      { price: "price_nutrivo_plan_standard_eur_month", quantity: "1" },
      { price: "price_nutrivo_addon_editor_seat_standard_eur_month", quantity: "1" },
    ]);
    // The mirror and the workspace follow.
    const { data: w } = await admin().schema("app").from("workspaces").select("plan, status").eq("id", ws).single();
    expect(w).toEqual({ plan: "standard", status: "active" });
    await axe(page);

    await page.goto(`/w/${ws}/settings/billing`);
    await expect(page.getByTestId("plan-name")).toHaveText("Standard");
    await expect(page.getByText(/^STANDARD · MONTHLY · RENEWS /)).toBeVisible();
    await expect(page.getByTestId("dial-recipes").getByTestId("count")).toHaveText("4 of 30");
    await expect(page.getByTestId("dial-editors").getByTestId("count")).toHaveText("6 of 6"); // five, plus the seat add-on
    await axe(page);
    // A live subscription changes plan in the portal, never with a second checkout.
    await page.goto(`/w/${ws}/billing/checkout?plan=basic&term=monthly`);
    await expect(page.getByRole("heading", { name: "This workspace is on Standard" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("[M03.main] Invoices and VAT: the main path works end to end", async ({ page, context, baseURL }) => {
    await signIn(context, ada, baseURL!);
    await page.goto(`/w/${ws}/settings/billing/invoices`);
    const row = page.getByTestId("invoice-list").locator("tbody tr");
    await expect(row).toHaveCount(1);
    await expect(row.first()).toContainText("Standard · monthly");
    await expect(row.first()).toContainText("PAID");
    await axe(page);
    await row.first().getByRole("link").first().click();
    await expect(page.getByTestId("invoice")).toBeVisible();
    await expect(page.getByTestId("subtotal")).toHaveText("€549");
    await expect(page.getByTestId("invoice-state")).toHaveText("Paid · nothing due");
    await axe(page);
    // Billing details are the Stripe customer's: what Checkout collected, and what the admin saves here.
    await page.goto(`/w/${ws}/settings/billing/details`);
    await expect(page.getByLabel("Legal entity")).toHaveValue("Bergmann Tiernahrung GmbH");
    await expect(page.getByLabel(/Purchase order reference/)).toHaveValue("PO-7781");
    await expect(page.getByTestId("vies")).toHaveText("VALIDATED AGAINST VIES");
    await expect(page.getByTestId("applied")).toContainText("Germany · reverse charge");
    await page.getByLabel("City").fill("Hamburg-Altona");
    await page.getByRole("button", { name: "Save billing details" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("City")).toHaveValue("Hamburg-Altona");
    // Who changed what is in the audit log (app.record_billing_change).
    const { data: rows } = await admin().schema("app").from("audit_events").select("kind, actor_id, before, after").eq("workspace_id", ws).eq("kind", "billing.details_changed");
    expect(rows).toHaveLength(1);
    expect(rows![0].actor_id).toBe(await personId(ada.userId));
    expect((rows![0].before as Json).address).toMatchObject({ city: "Hamburg" });
    expect((rows![0].after as Json).address).toMatchObject({ city: "Hamburg-Altona" });
    await axe(page);
    await page.goto(`/w/${ws}/settings/billing/payment`);
    await expect(page.getByTestId("card")).toContainText("VISA ···· 4242");
    await axe(page);
  });

  test("[M03.must.1] A German company with a valid VAT number pays zero VAT and the invoice states the reverse charge", async ({ page, context, baseURL }) => {
    await signIn(context, ada, baseURL!);
    await page.goto(`/w/${ws}/billing/invoices/${invoiceId}`);
    await expect(page.getByTestId("billed-to")).toContainText("VAT DE123456789");
    await expect(page.getByTestId("vat-label")).toHaveText("VAT · reverse charge 0%");
    await expect(page.getByTestId("vat")).toHaveText("€0");
    await expect(page.getByTestId("total")).toHaveText("€549");
    await expect(page.getByTestId("vat-note")).toContainText("Reverse charge");
  });

  test("[M05.main] Cancel, downgrade or suspend: the main path works end to end", async ({ page, context, baseURL }) => {
    await signIn(context, ada, baseURL!);
    await page.goto(`/w/${ws}/settings/billing`);
    // Cancelling goes through the Stripe customer portal (the fake), which returns to Plan and allowance.
    await page.getByTestId("cancel-plan").click();
    await page.waitForURL(/\/portal\/cus_/);
    await expect(page.getByText("Flow: subscription_cancel")).toBeVisible();
    await page.getByRole("link", { name: "Return to Nutrivo" }).click();
    await page.waitForURL(new RegExp(`/w/${ws}/settings/billing$`));
    // Stripe ends the subscription; the webhook leg mirrors it, and the workspace follows to Free.
    const paid = (await (await fetch(`${STRIPE}/__fake/payments/${sessionId}`)).json()) as { subscription: Json };
    await applySubscription(ws, paid.subscription, "standard", "monthly", "canceled");
    await page.reload();
    await expect(page.getByTestId("plan-name")).toHaveText("Free");
    await expect(page.getByTestId("ended")).toContainText("Nothing was deleted");
    await axe(page);
  });

  test("[M05.must.1] Data stays; export stays free (BE-44)", async ({ page, context, baseURL }) => {
    await signIn(context, ada, baseURL!);
    const { data: w } = await admin().schema("app").from("workspaces").select("plan").eq("id", ws).single();
    expect(w!.plan).toBe("free");
    // Every recipe is still there and readable under the admin's own session.
    const { data: products } = await ada.db.schema("app").from("products").select("id").eq("workspace_id", ws);
    expect(products).toHaveLength(4);
    // The full export is still free: the admin's own request is accepted after the plan ended.
    const { data: job, error } = await ada.db.schema("app").rpc("request_export", { p_ws: ws, p_request_id: "req-m05-must-1" });
    expect(error).toBeNull();
    expect(job).toBeTruthy();
    await page.goto(`/w/${ws}/settings/billing`);
    await page.getByRole("link", { name: "EXPORT THE WORKSPACE →" }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${ws}/settings/data$`));
  });

  test("[T-703] the billing screens match their design baselines on the cards the design draws the same", async ({ page, context, baseURL }) => {
    await signIn(context, ada, baseURL!);
    await page.goto(`/w/${ws}/billing/plans`);
    await expectLikeBaseline(page, page.getByRole("heading", { name: "Never metered, on any plan" }).locator(".."), "S-PLN-001", REGION.neverMetered, maxDiff);
    await page.goto(`/w/${ws}/billing/checkout?plan=standard&term=monthly`);
    await expect(page.getByRole("heading", { name: "This workspace is on Standard" }).or(page.getByTestId("order"))).toBeVisible();
    await page.goto(`/w/${ws}/settings/billing/invoices`);
    await expectLikeBaseline(page, page.getByRole("heading", { name: "Every invoice is itemised the same way" }).locator(".."), "S-BIL-002", REGION.itemised, maxDiff);
    await page.goto(`/w/${ws}/settings/billing/details`);
    await expectLikeBaseline(page, page.getByRole("heading", { name: "Billing details are not the operator" }).locator(".."), "S-BIL-004", REGION.notOperator, maxDiff);
  });

  test("[T-703] S-PLN-002 Checkout matches its design baseline on the card the design draws the same", async ({ page, context, baseURL }) => {
    // A workspace with no plan yet, so the review step shows (Halden is on Free again after the cancellation above).
    await signIn(context, ada, baseURL!);
    await page.goto(`/w/${ws}/billing/checkout?plan=standard&term=monthly`);
    await expectLikeBaseline(page, page.getByRole("heading", { name: "What you are not signing up to" }).locator(".."), "S-PLN-002", REGION.notSigningUp, maxDiff);
  });

  test("[T-703] billing is for internal admins: an external admin and an editor get the no-permission state", async ({ page, context, baseURL }) => {
    await signIn(context, eve, baseURL!);
    for (const path of ["billing/plans", "billing/checkout?plan=basic&term=monthly", "settings/billing", "settings/billing/invoices", "settings/billing/payment", "settings/billing/details"]) {
      await page.goto(`/w/${ws}/${path}`);
      await expect(page.getByTestId("billing-no-permission")).toBeVisible();
    }
    await axe(page);
    await signIn(context, gus, baseURL!);
    await page.goto(`/w/${ws}/billing/plans`);
    await expect(page.getByText("Your role cannot open Plan picker")).toBeVisible();
  });
});
