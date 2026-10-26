// The public site's data-bearing routes (T-603): pricing (P02), coverage (P01) and the landing page that shows both.
// Each is compared with its design baseline region by region (the regions the build keeps exactly as drawn; what
// differs on purpose is named beside each list), passes axe, and passes the no-dead-controls crawl.
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { REPO_ROOT } from "../visual/screens";
import { expectLikeBaseline } from "./support/baseline";
import { axe, crawl, INVENTED, maxDiffPixelRatio, open } from "./support/public";
import { createClient } from "@supabase/supabase-js";
import { addonAmount, euros, PARTNER, plans, priceLabel } from "../../src/lib/public/pricing";
import { isoDay, shapeCoverage, type Coverage, type Snapshot } from "../../src/lib/public/coverage";
import { haveStack } from "./support/people";
import { START } from "../../src/lib/public/links";

/**
 * Compares the element with the same box of the baseline: `dy` lower down where something above it was omitted, or at
 * the baseline's `y` where data above it makes the route's position vary.
 */
async function likeDesign(page: Page, testId: string, screenId: string, at: { dy?: number; y?: number; fractionY?: number } = {}) {
  const element = page.getByTestId(testId).filter({ visible: true }).first();
  const box = await element.boundingBox();
  if (!box) throw new Error(`${testId} is not rendered`);
  const scroll = await page.evaluate(() => window.scrollY);
  const y = at.y ?? Math.floor(box.y + scroll) + (at.dy ?? 0);
  const region = { x: Math.floor(box.x), y, width: Math.round(box.width), height: Math.round(box.height), fractionY: at.fractionY };
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
    for (const id of ["answers", "close"]) await likeDesign(page, id, "S-PRC-001", { dy: 113 });
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

/** The snapshot as anyone reads it: the anon key, no session (the same call the page makes). */
async function snapshot(): Promise<Coverage> {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data, error } = await db.rpc("coverage_snapshot");
  if (error) throw error;
  return shapeCoverage(data as Snapshot);
}

const DEPTH_LABEL = { complete: "COMPLETE", partial: "PARTIAL", not_encoded: "NOT ENCODED" } as const;

test.describe("coverage (P01)", () => {
  test.skip(!haveStack(), "needs the local Supabase stack: run through scripts/ci/e2e.sh (make e2e)");

  test("[P01.main] Public coverage page: every market of the released snapshot, by region, with its detail", async ({ page }) => {
    const coverage = await snapshot();
    expect(coverage.regions.length).toBeGreaterThan(0);
    const { errors, status } = await open(page, "/coverage");
    expect(status).toBe(200);
    await expect(page.getByTestId("generated")).toContainText(`RULESET ${coverage.rulesetVersion}`);
    const tabs = page.getByRole("navigation", { name: "Regions" }).getByRole("link");
    await expect(tabs).toHaveText(coverage.regions.map((r) => r.id));

    for (const region of coverage.regions) {
      await tabs.filter({ hasText: new RegExp(`^${region.id}$`) }).click();
      await expect(page).toHaveURL(new RegExp(`region=${region.id}`));
      await expect(tabs.filter({ hasText: new RegExp(`^${region.id}$`) })).toHaveAttribute("aria-current", "page");
      const rows = page.locator("[data-node]");
      await expect(rows).toHaveCount(region.nodes.length);
      for (const node of region.nodes) {
        const row = page.locator(`[data-node="${node.id}"]`);
        await expect(row).toContainText(node.name);
        await expect(row.locator('[data-col="rules"]')).toHaveText(String(node.rules));
        await expect(row.locator('[data-col="last-checked"]')).toHaveText(isoDay(node.lastChecked));
        await expect(row.locator('[data-col="depth"]')).toHaveText(DEPTH_LABEL[node.depth]);
        await expect(row.locator('[data-col="gaps"]')).toHaveText(node.gaps.length ? node.gaps.join(", ") : "None open.");
      }
      // Its first market is shown in full by default.
      await expect(page.getByTestId("node").getByRole("heading", { level: 2 })).toContainText(region.nodes[0].name);
    }

    // FULL DETAIL opens another market of the region, with its domains, gaps and record.
    const region = coverage.regions[0];
    await page.goto(`/coverage?region=${region.id}`);
    const target = region.nodes[region.nodes.length - 1];
    await page.locator(`[data-node="${target.id}"]`).getByRole("link", { name: /full detail/i }).click();
    await expect(page).toHaveURL(new RegExp(`node=${target.id}`));
    const detail = page.getByTestId("node");
    await expect(detail.getByRole("heading", { level: 2 })).toContainText(target.name);
    await expect(detail.locator("[data-domain]")).toHaveCount(target.domains.length);
    await expect(detail.locator('[data-fact="Rules encoded"]')).toHaveText(String(target.rules));
    await expect(detail.locator('[data-fact="Ruleset binding"]')).toHaveText(coverage.rulesetVersion!);
    await expect(detail.locator('[data-fact="Domains encoded"]')).toHaveText(`${target.domainsEncoded} OF ${target.domains.length}`);
    await expect(detail.locator('[data-fact="Depth"]')).toHaveText(DEPTH_LABEL[target.depth]);
    for (const gap of target.gaps) await expect(page.getByTestId("node-gaps")).toContainText(gap);
    expect(errors).toEqual([]);
  });

  test("[P01.must.1] The coverage page shows only released coverage: no invented numbers, no named specialists (D-19)", async ({ page }) => {
    const coverage = await snapshot();
    for (const region of coverage.regions) {
      await open(page, `/coverage?region=${region.id}`);
      const text = await page.locator("body").innerText();
      for (const claim of INVENTED) expect(text, claim).not.toContain(claim);
      expect(text, "no coverage percentage").not.toMatch(/\d\s*%/);
      const stats = page.getByTestId("region-stats");
      const offered = region.id === "EU" ? "Member states offered" : "Markets offered";
      await expect(stats.locator(`[data-stat="${offered}"]`)).toHaveText(String(region.nodes.length));
      await expect(stats.locator('[data-stat="Complete"]')).toHaveText(String(region.complete));
      await expect(stats.locator('[data-stat="Partial"]')).toHaveText(String(region.partial));
      await expect(stats.locator('[data-stat="Not encoded"]')).toHaveText(String(region.notEncoded));
      const markets = coverage.regions.reduce((n, r) => n + r.nodes.length, 0);
      await expect(page.getByTestId("market-count").filter({ visible: true })).toHaveText(`${markets} markets`);
      // Every figure in the market table is one the snapshot holds for that market.
      const numbers = await page.locator('[data-col="rules"]').allInnerTexts();
      expect(numbers).toEqual(region.nodes.map((n) => String(n.rules)));
    }
  });

  // Compared as drawn: header, the introduction's text, the three states, method and close. Not compared: the
  // "Never on this page" box and the generated line (they carry the snapshot's count, date and version), the region
  // index and the market in full (the snapshot's own rows), and the footer note. Method and close sit lower than in
  // the design because the table holds every market; they are compared at the design's own position.
  test("S-COV-001 /coverage matches its design baseline at 1600 px, region by region", async ({ page }) => {
    await open(page, "/coverage");
    for (const id of ["header", "lead-text", "states"]) await likeDesign(page, id, "S-COV-001");
    // The design's own tops: 3112.922 and 3628.109 px (measured in the design file at 1600 px).
    await likeDesign(page, "method", "S-COV-001", { y: 3112, fractionY: 0.922 });
    await likeDesign(page, "close", "S-COV-001", { y: 3628, fractionY: 0.109 });
  });

  test("/coverage passes axe and has no dead controls", async ({ page }) => {
    await open(page, "/coverage");
    await axe(page);
    await crawl(page, "/coverage");
  });
});
