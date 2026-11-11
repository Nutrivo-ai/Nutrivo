// T-1104 · Accessibility to WCAG 2.2 AA across apps/web (docs/20 §4). Every route in src/app/**/page.tsx is opened in
// the states a person can reach it in and checked with axe at WCAG 2.0, 2.1 and 2.2 A and AA (zero findings at any
// impact; support/a11y.ts), for a page title of its own (2.4.2) and a skip link to <main> (2.4.1). The workspace routes
// are also checked for reflow at 320 px (1.4.10).
//
// States: signed out (public, auth, verification, invitation, supplier links, the kit); a workspace admin with a
// product in four markets (populated); the same admin in a workspace with no products (empty); a viewer (what a
// read-only role sees, with no write controls); and a person outside the workspace (no access). Routes that name a
// check, an artwork or an invoice are opened with an id that does not exist, so they show their not-found state.
//
// Not covered here: reflow on the public marketing pages. They are drawn at a fixed 1280 px (design/public), and
// making them reflow at 320 px needs a design for narrow screens: question on issue #82 (needs-human).
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { reflows, titled, wcag } from "./support/a11y";
import { admin, haveStack, person, signIn, workspace, type Person } from "./support/people";
import { LEGAL_ORDER } from "../../src/components/public/legal";
import { SEGMENT_CONTENT } from "../../src/components/public/segments/content";

const PUBLIC = [
  "/",
  "/about",
  "/coverage",
  "/faq",
  "/pricing",
  ...SEGMENT_CONTENT.map((s) => `/for/${s.slug}`),
  ...LEGAL_ORDER.map((d) => `/legal/${d}`),
  "/sign-in",
  "/auth/forgot",
  "/auth/reset",
  "/verify",
  "/verify/NV-0000-0000",
  `/invite/${randomUUID()}`,
  `/supplier/${randomUUID()}`,
  "/kit",
  "/kit/shell",
  "/kit/empty-and-error-states",
];

/** Every route under /w/[workspace], for a product `p`; check, artwork and invoice ids that do not exist. */
function workspaceRoutes(ws: string, p: string) {
  const none = randomUUID();
  return [
    "",
    "/alerts",
    "/billing/checkout",
    "/billing/plans",
    `/billing/invoices/${none}`,
    "/board",
    "/board?view=findings",
    `/briefs/${p}`,
    `/briefs/${p}/envelope`,
    "/capture",
    "/certificates",
    "/documents",
    "/exports",
    "/horizon",
    "/library/coverage",
    "/library/coverage/EU-DE",
    "/library/suppliers",
    "/library/terms",
    "/markets",
    "/monitoring",
    "/obligations",
    `/products/${p}`,
    `/products/${p}/artwork/${none}`,
    `/products/${p}/check`,
    `/products/${p}/checks/${none}`,
    `/products/${p}/nodes/EU-DE`,
    `/products/${p}/nodes/EU-DE/registration`,
    `/products/${p}/report`,
    `/products/${p}/report/send`,
    "/products/discontinued",
    "/products/new",
    "/screening",
    "/settings",
    "/settings/audit",
    "/settings/billing",
    "/settings/billing/details",
    "/settings/billing/invoices",
    "/settings/billing/payment",
    "/settings/data",
    "/settings/people",
    "/settings/workspace",
  ].map((r) => `/w/${ws}${r}`);
}

async function settle(page: Page, url: string) {
  const response = await page.goto(url);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  return response;
}

/** The skip link is the first thing in the page and names a <main id="main"> that exists exactly once (2.4.1). */
async function skips(page: Page, where: string) {
  await expect(page.locator("a[href='#main']").first(), `${where} has a skip link`).toHaveText("Skip to content");
  await expect(page.locator("main#main"), `${where} has one <main id="main">`).toHaveCount(1);
}

test.describe("[T-1104] WCAG 2.2 AA, signed out", () => {
  test.skip(!haveStack(), "needs the local Supabase stack (scripts/ci/e2e.sh)");

  for (const url of PUBLIC) {
    test(`[T-1104] ${url.replace(/[0-9a-f-]{36}/, ":id")} passes axe at WCAG 2.2 AA, has its own title and a skip link`, async ({ page }) => {
      const response = await settle(page, url);
      expect(response?.status(), url).toBeLessThan(400);
      await wcag(page, url);
      await titled(page);
      await skips(page, url);
    });
  }

  test("[T-1104] a workspace route signed out lands on sign-in, which passes axe", async ({ page }) => {
    await settle(page, `/w/${randomUUID()}/board`);
    await expect(page).toHaveURL(/\/sign-in\?next=/);
    await wcag(page);
    await titled(page);
  });
});

test.describe("[T-1104] WCAG 2.2 AA, every workspace route", () => {
  test.skip(!haveStack(), "needs the local Supabase stack (scripts/ci/e2e.sh)");
  test.describe.configure({ mode: "serial" });

  let owner: Person, viewer: Person, outsider: Person;
  let ws: string, empty: string, product: string;

  test.beforeAll(async () => {
    [owner, viewer, outsider] = await Promise.all([person("t1104-owner"), person("t1104-viewer"), person("t1104-outsider")]);
    ws = await workspace(owner, "Halden A11y");
    empty = await workspace(owner, "Halden A11y Empty");
    await workspace(outsider, "Somewhere else");
    await workspace(viewer, "Viewer's own"); // makes their app.people row, as board.spec does
    // Set up as the service role, as board.spec does: the product and its markets, and the viewer's membership.
    const app = admin().schema("app");
    const fam = await app.from("families").insert({ workspace_id: ws, name: "Salmon" }).select("id").single();
    if (fam.error) throw fam.error;
    const p = await app
      .from("products")
      .insert({ workspace_id: ws, family_id: fam.data.id, name: "Salmon & Rice Adult Dry 12 kg", stage: "active", species: "dog", life_stage: "adult", format: "dry" })
      .select("id")
      .single();
    if (p.error) throw p.error;
    product = p.data.id;
    const nodes = await app
      .from("product_nodes")
      .insert(["EU-DE", "EU-AT", "EU-SE", "US-TX"].map((node_id) => ({ product_id: product, node_id, workspace_id: ws })))
      .select("node_id");
    if (nodes.error) throw nodes.error;
    const v = await app.from("people").select("id").eq("user_id", viewer.userId).single();
    if (v.error) throw v.error;
    const m = await app.from("memberships").insert({ workspace_id: ws, person_id: v.data.id, role: "viewer" }).select("id");
    if (m.error) throw m.error;
  });

  const sweep = async (page: Page, urls: string[], opts: { reflow: boolean }) => {
    for (const url of urls) {
      await test.step(url.replace(/[0-9a-f-]{36}/g, ":id"), async () => {
        const response = await settle(page, url);
        expect(response?.status(), url).toBeLessThan(500);
        expect(page.url(), `${url} is not sent to two-step`).not.toContain("/auth/mfa");
        await wcag(page, url);
        await titled(page);
        await skips(page, url);
        if (opts.reflow) await reflows(page, url);
      });
    }
  };

  test("[T-1104] as an admin with a product in four markets, every route passes axe, reflows at 320 px and is titled", async ({ page, context, baseURL }) => {
    test.setTimeout(600_000);
    await signIn(context, owner, baseURL!);
    await sweep(page, workspaceRoutes(ws, product), { reflow: true });
  });

  test("[T-1104] in a workspace with no products, every route's empty state passes axe", async ({ page, context, baseURL }) => {
    test.setTimeout(600_000);
    await signIn(context, owner, baseURL!);
    await sweep(page, workspaceRoutes(empty, randomUUID()), { reflow: false });
  });

  test("[T-1104] as a viewer, every route passes axe", async ({ page, context, baseURL }) => {
    test.setTimeout(600_000);
    await signIn(context, viewer, baseURL!);
    await sweep(page, workspaceRoutes(ws, product), { reflow: false });
  });

  test("[T-1104] outside the workspace, the no-access state passes axe; /account and /onboarding too", async ({ page, context, baseURL }) => {
    await signIn(context, outsider, baseURL!);
    await sweep(page, [`/w/${ws}/board`, `/w/${ws}/settings/people`, "/account", "/onboarding"], { reflow: true });
    await settle(page, `/w/${ws}/board`);
    await expect(page.getByRole("main")).toBeVisible();
  });

  test("[T-1104] /admin for a person who is not staff passes axe", async ({ page, context, baseURL }) => {
    await signIn(context, outsider, baseURL!);
    for (const url of ["/admin/terms", "/admin/rules", "/admin/coverage", "/admin/glossary"]) {
      await settle(page, url);
      await wcag(page, url);
      await titled(page);
      await skips(page, url);
    }
  });
});
