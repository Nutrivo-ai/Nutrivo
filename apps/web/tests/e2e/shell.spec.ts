// The workspace shell (T-102): switching workspace (N02), the states a workspace route can be in, axe, the
// no-dead-controls crawl, and the rail and header held to the S-NV2-001 baseline.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { parse } from "yaml";
import { REPO_ROOT } from "../visual/screens";
import { NAV, hrefFor } from "../../src/lib/shell/routes";
import { admin, haveStack, person, signIn, workspace, type Person } from "./support/people";

const nfr = parse(fs.readFileSync(path.join(REPO_ROOT, "spec/nfr.yaml"), "utf8")) as {
  quality: { visual_max_diff_pixel_ratio: number; axe_serious_or_critical: number };
};
const maxDiffPixelRatio = nfr.quality.visual_max_diff_pixel_ratio;
const shot = { maxDiffPixelRatio, animations: "disabled", caret: "hide" } as const;

function watch(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) errors.push(`${response.status()} ${response.url()}`);
  });
  return errors;
}

async function open(page: Page, url: string) {
  const errors = watch(page);
  const response = await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  return { errors, status: response?.status() };
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  expect(serious.length).toBeLessThanOrEqual(nfr.quality.axe_serious_or_critical);
}

// A failed screenshot leaves its expected, actual and diff images in reports/visual/ (as tests/e2e/kit.spec.ts).
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const dir = path.join(REPO_ROOT, "reports/visual", testInfo.titlePath.slice(1).join(" ").replace(/[^\w.-]+/g, "-"));
  for (const attachment of testInfo.attachments) {
    if (!attachment.path?.endsWith(".png")) continue;
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(attachment.path, path.join(dir, `${testInfo.retry}-${path.basename(attachment.path)}`));
  }
});

test.describe("shell frame against the design", () => {
  test("the rail and the header match S-NV2-001 at 1600 px", async ({ page }) => {
    const { errors } = await open(page, "/kit/shell");
    await expect(page).toHaveScreenshot(["shell", "rail-S-NV2-001.png"], { ...shot, clip: { x: 0, y: 0, width: 216, height: 1831 }, fullPage: true });
    await expect(page).toHaveScreenshot(["shell", "header-S-NV2-001.png"], { ...shot, clip: { x: 216, y: 0, width: 644, height: 68 } });
    expect(errors).toEqual([]);
  });

  for (const section of ["switcher", "loading", "error", "no-access", "no-workspace"]) {
    test(`shell ${section} matches its image`, async ({ page }) => {
      await open(page, "/kit/shell/states");
      await expect(page.getByTestId(`shell-${section}`)).toHaveScreenshot(["shell", `${section}.png`], shot);
    });
  }

  for (const url of ["/kit/shell", "/kit/shell/states"]) {
    test(`axe finds nothing serious or critical on ${url}`, async ({ page }) => {
      const { errors } = await open(page, url);
      await axe(page);
      expect(errors).toEqual([]);
    });
  }
});

test.describe("workspace shell", () => {
  test.skip(!haveStack(), "needs the local Supabase stack: run through scripts/ci/e2e.sh (make e2e)");
  test.describe.configure({ mode: "serial" });

  // Ann is admin of two workspaces; Ben has his own and is a viewer in Ann's first; Cai has none.
  let ann: Person, ben: Person, cai: Person;
  let north: string, south: string, east: string;
  const NORTH = "Northwind Feeds", SOUTH = "Southfield Petfood", EAST = "Eastmoor Kibble";

  test.beforeAll(async () => {
    [ann, ben, cai] = await Promise.all([person("t102-ann"), person("t102-ben"), person("t102-cai")]);
    north = await workspace(ann, NORTH);
    south = await workspace(ann, SOUTH);
    east = await workspace(ben, EAST);
    // Ben's viewer seat in Northwind. Invitations need the worker's emailed token (T-105), so the test grants the
    // membership directly as the service role; the app itself never writes memberships outside an RPC.
    const service = admin();
    const { data: benPerson, error } = await service.schema("app").from("people").select("id").eq("user_id", ben.userId).single();
    if (error) throw error;
    const grant = await service.schema("app").from("memberships").insert({ workspace_id: north, person_id: benPerson.id, role: "viewer" });
    if (grant.error) throw grant.error;
  });

  // Next keeps the previous page's tree mounted but hidden after a navigation, so locators name the visible header.
  const switcher = (page: Page) => page.locator("header [data-workspace-switcher] > button").filter({ visible: true });
  const entries = (page: Page) => page.locator("header [data-workspace-list] a").filter({ visible: true });

  test("[N02.main] Switch workspace: the main path works end to end", async ({ page, context, baseURL }) => {
    await signIn(context, ann, baseURL!);
    const { errors } = await open(page, `/w/${north}/board`);
    await expect(page.getByRole("heading", { level: 1, name: "Board" })).toBeVisible();
    await expect(switcher(page)).toContainText(NORTH);
    await expect(page.getByRole("link", { name: "Board", exact: true })).toHaveAttribute("aria-current", "page");

    // The switcher lists exactly the person's active memberships, the current one marked.
    await switcher(page).click();
    await expect(switcher(page)).toHaveAttribute("aria-expanded", "true");
    const list = entries(page);
    await expect(list).toHaveCount(2);
    await expect(list.nth(0)).toContainText(NORTH);
    await expect(list.nth(0)).toContainText("admin");
    await expect(list.nth(0)).toHaveAttribute("aria-current", "true");
    await expect(list.nth(1)).toContainText(SOUTH);

    // Choosing one moves the whole shell to it, in the same section.
    await list.nth(1).click();
    await expect(page).toHaveURL(new RegExp(`/w/${south}/board$`));
    await expect(switcher(page)).toContainText(SOUTH);
    await expect(switcher(page)).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("heading", { level: 1, name: "Board" })).toBeVisible();
    for (const link of await page.locator('nav[aria-label="Workspace"]:visible a').all()) {
      expect(await link.getAttribute("href")).toMatch(new RegExp(`^/w/${south}(/|$)`));
    }

    // From a page that belongs to a product, switching lands on the other workspace's home: ids never carry across.
    await page.goto(`/w/${south}/products/${randomUUID()}/report`);
    await switcher(page).click();
    await entries(page).filter({ hasText: NORTH }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${north}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

    // Escape closes the list and gives focus back to the switcher.
    await switcher(page).click();
    await page.keyboard.press("Escape");
    await expect(switcher(page)).toHaveAttribute("aria-expanded", "false");
    await expect(switcher(page)).toBeFocused();
    expect(errors).toEqual([]);
  });

  test("[N02.must.1] RLS never joins across workspaces; switching changes context only.", async ({ page, context, baseURL }) => {
    // Under Ann's own session the database returns her two workspaces and nothing of Ben's.
    const workspaces = await ann.db.schema("app").from("workspaces").select("id");
    expect(workspaces.error).toBeNull();
    expect(new Set(workspaces.data!.map((w) => w.id))).toEqual(new Set([north, south]));
    const memberships = await ann.db.schema("app").from("memberships").select("workspace_id");
    expect(memberships.data!.every((m) => m.workspace_id === north || m.workspace_id === south)).toBe(true);
    expect((await ann.db.schema("app").from("workspaces").select("id").eq("id", east)).data).toEqual([]);
    expect((await ann.db.schema("app").from("memberships").select("id").eq("workspace_id", east)).data).toEqual([]);

    // Switching writes nothing: no request but reads, and the audit trail of both workspaces is unchanged.
    const service = admin();
    const audit = async () =>
      (await service.schema("app").from("audit_events").select("id", { count: "exact", head: true }).in("workspace_id", [north, south])).count;
    const before = await audit();
    await signIn(context, ann, baseURL!);
    const { errors } = await open(page, `/w/${north}/library/terms`);
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "GET") writes.push(`${request.method()} ${request.url()}`);
    });
    await switcher(page).click();
    await entries(page).filter({ hasText: SOUTH }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${south}/library/terms$`));
    await expect(switcher(page)).toContainText(SOUTH);
    expect(writes).toEqual([]);
    expect(await audit()).toBe(before);

    // Ben's workspace is not in Ann's switcher, and its URL reads exactly like a workspace that does not exist.
    expect(await page.locator("body").textContent()).not.toContain(EAST);
    await page.goto(`/w/${east}`);
    await expect(page.getByText("This workspace is not open to you")).toBeVisible();
    const main = page.locator("main").filter({ visible: true });
    const eastText = await main.innerText();
    expect(eastText).not.toContain(EAST);
    await page.goto(`/w/${randomUUID()}`);
    await expect(page.getByText("This workspace is not open to you")).toBeVisible();
    expect(await main.innerText()).toBe(eastText);
    expect(errors).toEqual([]);
  });

  test("a viewer sees the no-permission state on an admin screen, and the screen elsewhere", async ({ page, context, baseURL }) => {
    await signIn(context, ben, baseURL!);
    const { errors } = await open(page, `/w/${north}/settings`);
    await expect(page.getByRole("heading", { level: 1, name: "Settings & roles" })).toBeVisible();
    await expect(page.getByText("Your role cannot open Settings & roles")).toBeVisible();
    await expect(page.getByText(`You are a viewer in ${NORTH}.`)).toBeVisible();
    await expect(page.locator("[data-placeholder]")).toHaveCount(0);
    await axe(page);
    await page.goto(`/w/${north}/board`);
    await expect(page.locator('[data-placeholder="S-NV2-006"]')).toBeVisible();
    // Ben's own workspace and Ann's, nothing else.
    await switcher(page).click();
    await expect(entries(page)).toHaveText([new RegExp(EAST), new RegExp(NORTH)]);
    expect(errors).toEqual([]);
  });

  test("a person in no workspace sees the empty state, and a stranger finds nothing", async ({ page, context, baseURL }) => {
    await signIn(context, cai, baseURL!);
    const { errors } = await open(page, `/w/${north}`);
    await expect(page.getByText("This workspace is not open to you")).toBeVisible();
    await expect(page.getByText("Your account is not in a workspace yet")).toBeVisible();
    await expect(page.getByText(NORTH)).toHaveCount(0);
    await axe(page);
    expect(errors).toEqual([]);
    await context.clearCookies();
    // Signed out, a workspace route goes to /sign-in and comes back afterwards (T-103), showing nothing of it.
    await page.goto(`/w/${north}`);
    await expect(page).toHaveURL(new RegExp(`/sign-in\\?next=%2Fw%2F${north}$`));
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.locator('nav[aria-label="Workspace"]')).toHaveCount(0);
    expect(await page.locator("body").textContent()).not.toContain(NORTH);
  });

  test("axe finds nothing serious on a workspace route, with the switcher open", async ({ page, context, baseURL }) => {
    await signIn(context, ann, baseURL!);
    const { errors } = await open(page, `/w/${north}/documents`);
    await axe(page);
    await switcher(page).click();
    await axe(page);
    expect(errors).toEqual([]);
  });

  test("no dead controls: every rail link, switcher entry and button in the shell does something", async ({ page, context, baseURL }) => {
    await signIn(context, ann, baseURL!);
    const { errors } = await open(page, `/w/${north}`);
    const railLinks = page.locator('nav[aria-label="Workspace"]:visible a');
    const expected = NAV.flatMap((g) => g.items.map((i) => hrefFor(i.route, north)));
    await expect(railLinks).toHaveCount(expected.length);
    const hrefs = await railLinks.evaluateAll((links) => links.map((a) => a.getAttribute("href")!));
    expect(hrefs).toEqual(expected);
    for (const href of hrefs) {
      await page.locator(`nav[aria-label="Workspace"]:visible a[href="${href}"]`).click();
      await expect(page).toHaveURL(new RegExp(`${href}$`));
      await expect(page.locator(`nav[aria-label="Workspace"]:visible a[href="${href}"]`)).toHaveAttribute("aria-current", "page");
      await expect(page.locator("main [data-placeholder], main [data-pattern]").filter({ visible: true })).toHaveCount(1);
    }
    // The switcher opens and closes, and each entry navigates.
    await switcher(page).click();
    await expect(entries(page)).toHaveCount(2);
    await switcher(page).click();
    await expect(entries(page)).toHaveCount(0);
    for (const id of [south, north]) {
      await switcher(page).click();
      await entries(page).and(page.locator(`[data-workspace-id="${id}"]`)).click();
      await expect(page).toHaveURL(new RegExp(`/w/${id}`));
    }
    // Every visible button and link on the page is one of the above.
    await expect(switcher(page)).toContainText(NORTH);
    await expect(page.locator("a, button").filter({ visible: true })).toHaveCount(hrefs.length + 1);
    expect(errors).toEqual([]);
  });

  test.describe("at 390 px", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("the phone chrome: top bar, tab bar, and More opens the rail", async ({ page, context, baseURL }) => {
      await signIn(context, ann, baseURL!);
      const { errors } = await open(page, `/w/${north}/board`);
      await expect(page.locator('nav[aria-label="Workspace"]').first()).toBeHidden();
      const tabs = page.getByRole("navigation", { name: "Workspace sections" });
      await expect(tabs.getByRole("link", { name: "Recipes" })).toHaveAttribute("aria-current", "page");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      for (const box of [await tabs.getByRole("link", { name: "Alerts" }).boundingBox(), await tabs.getByRole("button", { name: "More" }).boundingBox()]) {
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      await axe(page);
      await expect(page).toHaveScreenshot(["shell", "phone-board.png"], shot);

      await tabs.getByRole("link", { name: "Alerts" }).click();
      await expect(page).toHaveURL(new RegExp(`/w/${north}/alerts$`));
      await tabs.getByRole("button", { name: "More" }).click();
      const dialog = page.getByRole("dialog", { name: "Every section" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("link", { name: "Term register" }).click();
      await expect(page).toHaveURL(new RegExp(`/w/${north}/library/terms$`));
      await expect(dialog).toBeHidden();

      // The switcher sits in the top bar.
      await page.locator("[data-workspace-switcher] > button:visible").click();
      await page.locator("[data-workspace-list] a:visible", { hasText: SOUTH }).click();
      await expect(page).toHaveURL(new RegExp(`/w/${south}/library/terms$`));
      expect(errors).toEqual([]);
    });
  });
});
