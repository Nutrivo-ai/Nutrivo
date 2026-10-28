// S-LGL-001…003: the three legal drafts (T-603), built from design/public/Nutrivo Legal - Terms, DPA, Privacy.dc.html.
// These screens have no acceptance IDs (spec/screens.yaml), so the titles name the screen.
import { expect, test } from "@playwright/test";
import { expectLikeBaseline, type Region } from "./support/baseline";
import { INVENTED, axe, crawl, maxDiffPixelRatio, open } from "./support/public";

// Regions of each baseline (1600 px wide), measured on the design file rendered per doc: the header spans the page;
// the column is max-width 1020 px centred, so it starts at x 290 and its contents (inside its 1 px border) at x 291;
// the banner sits 34 px further in. fractionY is the sub-pixel part of the element's top in the design.
//
// The four facts under each title are left out of the title block's region (height stops above them): the hosting
// fact in each (Terms "Processing location", DPA "Processing location", Privacy "Data held in") reads "European
// Union" instead of the design's Ireland (docs/02-decisions.md D-02). For the same reason the sections that name
// hosting or sub-processors are not compared: DPA 05 and 06, Privacy 04.
const HEADER: Region = { x: 0, y: 0, width: 1600, height: 57 };
const BANNER: Region = { x: 325, y: 79, width: 950, height: 122, fractionY: 0.594 };
const TITLE: Region = { x: 291, y: 201, width: 1018, height: 168, fractionY: 0.703 };
const CONTACT = (y: number): Region => ({ x: 291, y: Math.floor(y), width: 1018, height: 192, fractionY: +(y % 1).toFixed(3) });
const SECTION = (y: number, height: number): Region => ({ x: 291, y: Math.floor(y), width: 1018, height: Math.floor(height), fractionY: +(y % 1).toFixed(3) });

const ROUTES = [
  {
    screen: "S-LGL-001",
    url: "/legal/terms",
    tab: "Terms and conditions",
    title: "Terms and conditions",
    sections: { "01": SECTION(460.75, 330.578), "02": SECTION(791.328, 476.563), "03": SECTION(1267.891, 509.094) },
    contact: CONTACT(5332.453),
  },
  {
    screen: "S-LGL-002",
    url: "/legal/dpa",
    tab: "Data processing agreement",
    title: "Data processing agreement",
    sections: { "01": SECTION(460.75, 330.578), "02": SECTION(791.328, 708.453), "03": SECTION(1499.781, 420.031), "04": SECTION(1919.813, 184.984) },
    contact: CONTACT(4645.344),
  },
  {
    screen: "S-LGL-003",
    url: "/legal/privacy",
    tab: "Privacy policy",
    title: "Privacy policy",
    sections: { "01": SECTION(460.75, 306.141), "02": SECTION(766.891, 507.125), "03": SECTION(1274.016, 286.047) },
    contact: CONTACT(2759.047),
  },
] as const;

for (const r of ROUTES) {
  test.describe(`${r.screen} ${r.url}`, () => {
    test(`${r.screen} ${r.url} matches its baseline at 1600 px: header, draft banner, title, unchanged sections, contact`, async ({ page }) => {
      const { status } = await open(page, r.url);
      expect(status).toBe(200);
      await expectLikeBaseline(page, page.getByTestId("legal-header"), r.screen, HEADER, maxDiffPixelRatio);
      await expectLikeBaseline(page, page.getByTestId("legal-draft-banner"), r.screen, BANNER, maxDiffPixelRatio);
      await expectLikeBaseline(page, page.getByTestId("legal-title"), r.screen, TITLE, maxDiffPixelRatio);
      for (const [n, region] of Object.entries(r.sections)) {
        await expectLikeBaseline(page, page.getByTestId(`legal-section-${n}`), r.screen, region, maxDiffPixelRatio);
      }
      await expectLikeBaseline(page, page.getByTestId("legal-contact"), r.screen, r.contact, maxDiffPixelRatio);
    });

    test(`${r.screen} ${r.url} passes axe with nothing serious or critical`, async ({ page }) => {
      await open(page, r.url);
      await axe(page);
    });

    test(`${r.screen} ${r.url} has no dead controls`, async ({ page }) => {
      await crawl(page, r.url);
    });

    test(`${r.screen} ${r.url} is not indexed, is titled, and its tab is the current page`, async ({ page }) => {
      await open(page, r.url);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
      await expect(page).toHaveTitle(new RegExp(`^${r.title}`));
      const current = page.locator('nav[aria-label="Legal documents"] a[aria-current="page"]');
      await expect(current).toHaveCount(1);
      await expect(current).toHaveText(r.tab);
      await expect(page.getByRole("link", { name: "Nutrivo home" })).toHaveAttribute("href", "/");
    });

    test(`${r.screen} ${r.url} shows the draft banner`, async ({ page }) => {
      await open(page, r.url);
      const banner = page.getByTestId("legal-draft-banner");
      await expect(banner).toBeVisible();
      await expect(banner).toContainText("Draft for review by Swedish counsel before publication");
    });

    test(`${r.screen} ${r.url} names no invented figure and never Ireland as the hosting location`, async ({ page }) => {
      await open(page, r.url);
      const text = await page.locator("body").innerText();
      for (const phrase of [...INVENTED, "Ireland", "eu-west-1"]) expect(text, phrase).not.toContain(phrase);
    });
  });
}

test("S-LGL /legal/unknown is a 404", async ({ page }) => {
  const response = await page.goto("/legal/unknown");
  expect(response?.status()).toBe(404);
});
