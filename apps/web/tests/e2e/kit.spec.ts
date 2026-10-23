// The Cobalt component kit (T-101): its test pages compared with design/ and with their own images, axe on every
// kit page, and the keyboard paths through the dialog and the toasts.
import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { parse } from "yaml";
import { loadScreens, REPO_ROOT } from "../visual/screens";

const nfr = parse(fs.readFileSync(path.join(REPO_ROOT, "spec/nfr.yaml"), "utf8")) as {
  quality: { visual_max_diff_pixel_ratio: number; axe_serious_or_critical: number };
};
const maxDiffPixelRatio = nfr.quality.visual_max_diff_pixel_ratio;

async function open(page: Page, url: string) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  return errors;
}

// A failed screenshot leaves its expected, actual and diff images in reports/visual/, which CI uploads with the e2e
// reports, so the diff can be read from the run (docs/20 §4).
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const dir = path.join(REPO_ROOT, "reports/visual", testInfo.titlePath.slice(1).join(" ").replace(/[^\w.-]+/g, "-"));
  for (const attachment of testInfo.attachments) {
    if (!attachment.path?.endsWith(".png")) continue;
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(attachment.path, path.join(dir, `${testInfo.retry}-${path.basename(attachment.path)}`));
  }
});

test.describe("kit", () => {
  test("S-EES-001 empty and error states match the design baseline at 1600 px", async ({ page }) => {
    const screen = loadScreens().find((s) => s.id === "S-EES-001")!;
    const errors = await open(page, "/kit/empty-and-error-states");
    await expect(page).toHaveScreenshot(screen.baseline.replace("apps/web/tests/visual/", "").split("/"), {
      fullPage: true,
      maxDiffPixelRatio,
      animations: "disabled",
      caret: "hide",
    });
    expect(errors).toEqual([]);
  });

  for (const section of ["states", "provenance", "findings", "tables", "patterns", "controls"]) {
    test(`kit ${section} matches its image`, async ({ page }) => {
      await open(page, "/kit");
      await expect(page.getByTestId(`kit-${section}`)).toHaveScreenshot(["kit", `${section}.png`], {
        maxDiffPixelRatio,
        animations: "disabled",
        caret: "hide",
      });
    });
  }

  for (const url of ["/kit", "/kit/empty-and-error-states"]) {
    test(`axe finds nothing serious or critical on ${url}`, async ({ page }) => {
      const errors = await open(page, url);
      const results = await new AxeBuilder({ page }).analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
      expect(serious.length).toBeLessThanOrEqual(nfr.quality.axe_serious_or_critical);
      expect(errors).toEqual([]);
    });
  }

  test("every state shows its glyph next to its name, never colour alone", async ({ page }) => {
    await open(page, "/kit");
    const badges = page.getByTestId("kit-states").locator("[data-state]");
    expect(await badges.count()).toBeGreaterThanOrEqual(12);
    for (const badge of await badges.all()) {
      await expect(badge.locator("[data-glyph]")).toBeVisible();
      await expect(badge).toHaveText(/^(Clear|Action needed|Not assessed|Blocked)$/);
    }
  });

  test("every finding shows provenance, and every Not assessed links to its coverage gap", async ({ page }) => {
    await open(page, "/kit");
    const findings = page.getByTestId("kit-findings").locator("[data-finding-state]");
    expect(await findings.count()).toBe(6);
    for (const finding of await findings.all()) {
      await expect(finding.locator("[data-provenance]")).toHaveCount(1);
      if ((await finding.getAttribute("data-finding-state")) === "not_assessed") {
        await expect(finding.locator("[data-gap-id] a")).toHaveAttribute("href", /\/library\/coverage\//);
      } else {
        await expect(finding.locator("[data-rule-key]")).toHaveCount(1);
      }
    }
  });

  test("the dialog opens on Enter, traps focus, closes on Escape and returns focus", async ({ page }) => {
    await open(page, "/kit");
    const opener = page.getByRole("button", { name: "Open the dialog" });
    await opener.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Remove M. Lind from this workspace?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveScreenshot(["kit", "dialog.png"], { maxDiffPixelRatio, animations: "disabled", caret: "hide" });
    await page.keyboard.press("Tab");
    await expect(dialog.locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("the dialog's one action confirms, closes and reports in a polite toast", async ({ page }) => {
    await open(page, "/kit");
    await page.getByRole("button", { name: "Open the dialog" }).click();
    await page.getByRole("button", { name: "Remove M. Lind" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    const toast = page.locator("[data-toast]");
    await expect(toast).toHaveText(/M\. Lind was removed\./);
    await page.getByRole("button", { name: "DISMISS" }).click();
    await expect(toast).toHaveCount(0);
  });

  test("a failure toast carries its mark and tag", async ({ page }) => {
    await open(page, "/kit");
    await page.getByRole("button", { name: "Show a failure" }).click();
    const toast = page.locator('[data-toast="blocked"]');
    await expect(toast.locator('[data-mark="blocked"]')).toBeVisible();
    await expect(toast).toContainText("SOMETHING FAILED");
  });
});
