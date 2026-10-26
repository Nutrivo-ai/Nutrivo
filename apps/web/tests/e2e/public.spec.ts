// The public site's data-bearing routes (T-603): pricing (P02), coverage (P01) and the landing page that shows both.
// Each is compared with its design baseline region by region (the regions the build keeps exactly as drawn; what
// differs on purpose is named beside each list), passes axe, and passes the no-dead-controls crawl.
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { REPO_ROOT } from "../visual/screens";
import { expectLikeBaseline } from "./support/baseline";
import { axe, crawl, INVENTED, maxDiffPixelRatio, open } from "./support/public";
import { addonAmount, euros, PARTNER, plans, priceLabel } from "../../src/lib/public/pricing";
import { START } from "../../src/lib/public/links";

/** Compares the element with the same box of the baseline, `dy` lower down where something above it was omitted. */
async function likeDesign(page: Page, testId: string, screenId: string, dy = 0) {
  const element = page.getByTestId(testId).first();
  const box = await element.boundingBox();
  if (!box) throw new Error(`${testId} is not rendered`);
  const scroll = await page.evaluate(() => window.scrollY);
  const region = { x: Math.floor(box.x), y: Math.floor(box.y + scroll) + dy, width: Math.round(box.width), height: Math.round(box.height) };
  await expectLikeBaseline(page, element, screenId, region, maxDiffPixelRatio);
}

/** The "Plans and dials" table of docs/08-billing.md: plan name → price cell. */
function billingTable(): Map<string, string> {
  const doc = fs.readFileSync(path.join(REPO_ROOT, "docs/08-billing.md"), "utf8");
  const section = doc.split("## Plans and dials")[1].split("\n## ")[0];
  const rows = section.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Plan") && !l.startsWith("|---"));
  return new Map(rows.map((l) => l.split("|").map((c) => c.trim())).map((c) => [c[1].replace(/ \(after launch\)$/, ""), c[2]]));
}

test.describe("pricing (P02)", () => {
  test("[P02.main] Pricing page: every plan with its price from config, the term toggle, and calls to action that go somewhere", async ({ page }) => {
    const { errors, status } = await open(page, "/pricing");
    expect(status).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Check three labels free. Then decide.");
    for (const p of plans) {
      await expect(page.getByTestId(`plan-${p.key}`).getByTestId("price")).toHaveText(priceLabel(p.key, "month"));
    }
    const monthly = page.getByRole("button", { name: "Monthly" });
    const annual = page.getByRole("button", { name: /^Annual/ });
    await expect(monthly).toHaveAttribute("aria-pressed", "true");
    await annual.click();
    await expect(annual).toHaveAttribute("aria-pressed", "true");
    for (const p of plans) {
      await expect(page.getByTestId(`plan-${p.key}`).getByTestId("price")).toHaveText(priceLabel(p.key, "year"));
    }
    await expect(page.getByTestId("plan-standard")).toContainText(`A second region for ${euros(addonAmount("region", "standard", "year")!)} a year`);
    await monthly.click();
    await expect(page.getByTestId("plan-basic").getByTestId("price")).toHaveText(priceLabel("basic", "month"));

    await expect(page.getByRole("link", { name: "Check three labels", exact: true })).toHaveAttribute("href", START);
    await expect(page.getByRole("link", { name: "Talk to us", exact: true })).toHaveAttribute("href", /^mailto:/);
    await page.getByRole("link", { name: "Choose Standard" }).click();
    await expect(page).toHaveURL(new RegExp(`${START}$`));
    expect(errors).toEqual([]);
  });

  test("[P02.must.1] Plan names and prices on the pricing page match docs/08-billing.md", async ({ page }) => {
    const table = billingTable();
    await open(page, "/pricing");
    for (const p of plans) {
      const card = page.getByTestId(`plan-${p.key}`);
      await expect(card.getByRole("heading", { level: 3 })).toHaveText(p.name);
      const shown = (await card.getByTestId("price").innerText()).trim();
      expect(table.get(p.name), `${p.name} in docs/08`).toBeDefined();
      expect(table.get(p.name)!.startsWith(shown), `${p.name}: page ${shown}, docs/08 ${table.get(p.name)}`).toBe(true);
    }
    await expect(page.getByTestId("partner").getByRole("heading", { level: 2 })).toHaveText(PARTNER.name);
    expect(table.get(PARTNER.name)).toBe(`${await page.getByTestId("partner-price").innerText()} per ${PARTNER.clientWorkspaces} client workspaces`);
    // Nothing on the page prices a plan that docs/08 does not name.
    for (const name of ["Core", "Portfolio", "Verified"]) await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  });

  // Compared as drawn: header, intro, Basic and Standard, the EU region card and its two notes, never/not sold, the
  // plan table, growth. Not compared: the Free card (D-21 editors), the Advanced card (no "100 recipes"), the region
  // tabs (EU only) and Partner (rows docs/08 does not hold), which also moves the answers and close 113 px up.
  test("S-PRC-001 /pricing matches its design baseline at 1600 px, region by region", async ({ page }) => {
    await open(page, "/pricing");
    for (const id of ["header", "intro", "ladder-head", "plan-basic", "plan-standard", "region-eu", "region-notes", "never", "qualify", "grow"]) {
      await likeDesign(page, id, "S-PRC-001");
    }
    for (const id of ["answers", "close"]) await likeDesign(page, id, "S-PRC-001", 113);
  });

  test("/pricing passes axe and has no dead controls", async ({ page }) => {
    await open(page, "/pricing");
    await axe(page);
    await crawl(page, "/pricing");
  });

  test("/pricing shows none of the design's invented claims", async ({ page }) => {
    await open(page, "/pricing");
    const text = await page.locator("body").innerText();
    for (const claim of [...INVENTED, "100 RECIPES", "Above 100 recipes", "€14,990", "€129/mo", "Above 25 clients"]) expect(text).not.toContain(claim);
  });
});
