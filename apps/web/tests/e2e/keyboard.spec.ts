// T-1104 · Keyboard and focus order for the main flows (WCAG 2.1.1 Keyboard, 2.1.2 No keyboard trap, 2.4.1 Bypass
// blocks, 2.4.3 Focus order, 2.4.7 Focus visible, 2.4.11 Focus not obscured). Each flow is driven by the keyboard
// alone: Tab, Shift+Tab, Enter, Space, the arrow keys and Escape. support/a11y.ts holds the per-stop checks.
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { focused, tabThrough } from "./support/a11y";
import { admin, haveStack, person, signIn, workspace, type Person } from "./support/people";

test.skip(!haveStack(), "needs the local Supabase stack (scripts/ci/e2e.sh)");

async function settle(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}

/** Every element in <main> a keyboard can reach: visible, enabled, not taken out of the tab order. */
function tabbableInMain(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("main a[href], main button, main input, main select, main textarea, main [tabindex]"))
      .filter((el) => {
        if (el.tabIndex < 0 || (el as HTMLButtonElement).disabled) return false;
        if (el.closest("dialog:not([open]), [inert], [hidden]")) return false;
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        // A visually hidden radio is reached through its group (one stop per group, arrows inside it).
        if (el instanceof HTMLInputElement && el.type === "radio") return el.checked;
        return r.width > 0 && r.height > 0 && s.visibility !== "hidden";
      }).length,
  );
}

test.describe("[T-1104] keyboard in the workspace", () => {
  test.describe.configure({ mode: "serial" });
  let owner: Person;
  let ws: string, product: string;

  test.beforeAll(async () => {
    owner = await person("t1104-keys");
    ws = await workspace(owner, "Halden Keys");
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
    const n = await app.from("product_nodes").insert(["EU-DE", "EU-SE"].map((node_id) => ({ product_id: product, node_id, workspace_id: ws }))).select("node_id");
    if (n.error) throw n.error;
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await signIn(context, owner, baseURL!);
  });

  test("[T-1104] the first Tab is a visible skip link, and Enter on it moves the next Tab into <main>", async ({ page }) => {
    await settle(page, `/w/${ws}/board`);
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    // Shown while it has focus, inside the viewport (it is hidden until then, so no screen differs from its design).
    const box = (await skip.boundingBox())!;
    expect(box.width).toBeGreaterThan(40);
    expect(box.y).toBeGreaterThanOrEqual(0);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    expect((await focused(page))?.inMain, "after the skip link, focus goes to the page, not the rail").toBe(true);
  });

  test("[T-1104] the rail is in reading order, the current section is marked, and Enter follows a link", async ({ page }) => {
    await settle(page, `/w/${ws}/board`);
    const rail = page.getByRole("navigation", { name: "Workspace" });
    const links = rail.getByRole("link");
    const count = await links.count();
    expect(count).toBeGreaterThan(3);
    await expect(rail.locator("[aria-current='page']")).toHaveText(/Board/);
    // Tab from the skip link visits the rail's links top to bottom, in the order they are drawn.
    await page.keyboard.press("Tab");
    const tops: number[] = [];
    let obligations = -1;
    for (let i = 0; i < count; i++) {
      await page.keyboard.press("Tab");
      const handle = await page.evaluateHandle(() => document.activeElement);
      const inRail = await rail.evaluate((nav, el) => nav.contains(el as Node), handle);
      if (!inRail) continue;
      tops.push(await page.evaluate(() => document.activeElement!.getBoundingClientRect().top));
      if ((await page.evaluate(() => (document.activeElement as HTMLElement).innerText)).startsWith("Obligations")) obligations = i;
    }
    expect(tops.length).toBe(count);
    expect(tops, "rail focus order follows the visual order").toEqual([...tops].sort((a, b) => a - b));
    expect(obligations).toBeGreaterThanOrEqual(0);
    // Shift+Tab walks back the same way.
    await page.keyboard.press("Shift+Tab");
    const back = await page.evaluate(() => document.activeElement!.getBoundingClientRect().top);
    expect(back).toBeLessThan(tops[tops.length - 1] + 1);
    // Enter on a focused rail link navigates.
    await rail.getByRole("link", { name: /^Obligations/ }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/w/${ws}/obligations$`));
    await expect(rail.locator("[aria-current='page']")).toHaveText(/Obligations/);
  });

  for (const [name, route] of [
    ["board", "/board"],
    ["findings", "/board?view=findings"],
    ["product", "/products/:p"],
    ["product × market", "/products/:p/nodes/EU-DE"],
    ["upload & scope", "/products/:p/check"],
    ["label report", "/products/:p/report"],
    ["export, send, share", "/products/:p/report/send"],
    ["add a product", "/products/new"],
    ["brief & formula", "/briefs/:p"],
    ["registration pack", "/products/:p/nodes/EU-DE/registration"],
    ["people and roles", "/settings/people"],
    ["workspace settings", "/settings/workspace"],
    ["audit log", "/settings/audit"],
    ["plan and allowance", "/settings/billing"],
  ] as const) {
    test(`[T-1104] ${name}: every control in <main> is reached by Tab, focus is always visible and never trapped`, async ({ page }) => {
      const url = `/w/${ws}${route.replace(":p", product)}`;
      await settle(page, url);
      const stops = await tabThrough(page, url);
      expect(stops[0]?.name, "the skip link comes first").toBe("Skip to content");
      const mainStops = stops.filter((s) => s.inMain).length;
      expect(mainStops, `every control in <main> on ${url} is in the tab order`).toBe(await tabbableInMain(page));
    });
  }

  test("[T-1104] add a product by keyboard: the stage cards are one radio group, arrows move between them and show focus", async ({ page }) => {
    await settle(page, `/w/${ws}/products/new`);
    const group = page.getByRole("radiogroup", { name: "Lifecycle stage" });
    const checked = group.locator("input[type=radio]:checked");
    await checked.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(checked).toBeFocused();
    const card = checked.locator("xpath=ancestor::label[1]");
    // The radio is visually hidden, so the card draws the focus (2.4.7).
    await expect.poll(() => card.evaluate((l) => getComputedStyle(l).outlineStyle)).not.toBe("none");
    const before = await checked.getAttribute("value");
    await page.keyboard.press("ArrowRight");
    const now = group.locator("input[type=radio]:checked");
    // Arrow keys move through the enabled stages; a stage that cannot be created here stays unchecked.
    const values = await group.locator("input[type=radio]:not([disabled])").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    if (values.length > 1) expect(await now.getAttribute("value")).not.toBe(before);
    await expect(now).toBeFocused();
  });
});

test.describe("[T-1104] keyboard on a phone (390 px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("[T-1104] More opens the section dialog with Enter, keeps focus inside it, and Escape returns focus to More", async ({ page, context, baseURL }) => {
    const who = await person("t1104-phone");
    const ws = await workspace(who, "Halden Phone");
    await signIn(context, who, baseURL!);
    await settle(page, `/w/${ws}/board`);
    const more = page.getByRole("button", { name: "More" });
    await more.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Every section" });
    await expect(dialog).toBeVisible();
    // Focus moved into the dialog, and Tab never reaches the page behind it (the native modal makes the page inert).
    // After the last control focus may pass to the browser itself (activeElement is then the body), never the page.
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab");
      const where = await dialog.evaluate((d) => (d.contains(document.activeElement) ? "dialog" : document.activeElement === document.body ? "browser" : "page"));
      expect(where, `Tab ${i} does not reach the page behind the dialog`).not.toBe("page");
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(more).toBeFocused();
  });
});

test.describe("[T-1104] signing in by keyboard", () => {
  test("[T-1104] sign-in: fields in reading order, Enter submits, a wrong password is announced, then lands in the workspace", async ({ page }) => {
    const who = await person("t1104-signin");
    const ws = await workspace(who, "Halden Sign-in");
    const password = `pass ${randomUUID()}`;
    const { error } = await admin().auth.admin.updateUserById(who.userId, { password });
    if (error) throw error;

    await settle(page, `/w/${ws}/board`);
    await expect(page).toHaveURL(/\/sign-in\?next=/);
    const stops = await tabThrough(page);
    expect(stops[0].name).toBe("Skip to content");
    const names = stops.map((s) => s.name);
    const email = names.findIndex((n) => /email/i.test(n) || n === "INPUT");
    expect(email, `the email field is in the tab order: ${names.join(" | ")}`).toBeGreaterThan(0);

    await page.getByLabel("Work email").focus();
    await page.keyboard.type(who.email);
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Password")).toBeFocused();
    await page.keyboard.type("not the password at all");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("auth-sign-in").getByRole("alert")).toContainText("do not sign in");
    // The address is kept, so only the password is typed again (WCAG 3.3.7 Redundant entry).
    await expect(page.getByLabel("Work email")).toHaveValue(who.email);

    await page.getByLabel("Password").focus();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(password);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/w/${ws}/board$`));
  });
});
