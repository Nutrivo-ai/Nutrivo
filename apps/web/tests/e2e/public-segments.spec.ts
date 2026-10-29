// T-603 · The five segment pages (S-SEG-001…005, design/public/Nutrivo Segment Pages.dc.html): the design baseline by
// region, axe, the no-dead-controls crawl, and no invented or omitted claim on the page. These screens carry no
// acceptance IDs, so each test names its screen.
import { expect, test } from "@playwright/test";
import { expectLikeBaseline, type Region } from "./support/baseline";
import { axe, crawl, INVENTED, maxDiffPixelRatio, open } from "./support/public";

type Part = "seg-top" | "seg-hero" | "seg-problem" | "seg-flow" | "seg-proof" | "seg-close";

// Where each compared element sits in its 1600 px baseline: the 1280 px design column starts at x 160. fractionY is the
// sub-pixel part of the element's top edge in the design.
const TOP: Region = { x: 160, y: 0, width: 1280, height: 143 };
const HERO: Region = { x: 160, y: 143, width: 1280, height: 431, fractionY: 0.563 };

const SCREENS: { id: string; slug: string; title: string; regions: Partial<Record<Part, Region>> }[] = [
  {
    id: "S-SEG-001",
    slug: "new-product-development",
    title: "New product development · Nutrivo",
    // Not compared: the proof section, whose example rows and "Example envelope" panel are omitted (regulatory content).
    regions: {
      "seg-top": TOP,
      "seg-hero": HERO,
      "seg-problem": { x: 160, y: 575, width: 1280, height: 301, fractionY: 0.031 },
      "seg-flow": { x: 160, y: 876, width: 1280, height: 397, fractionY: 0.938 },
      "seg-close": { x: 160, y: 1750, width: 1280, height: 382, fractionY: 0.219 },
    },
  },
  {
    id: "S-SEG-002",
    slug: "product-management",
    title: "Product & range management · Nutrivo",
    // Not compared: the proof section (Texas registration rows and the "Example cell" panel omitted) and the close
    // section ("four minutes" sentence and the "27 markets" foot omitted).
    regions: {
      "seg-top": TOP,
      "seg-hero": HERO,
      "seg-problem": { x: 160, y: 575, width: 1280, height: 337, fractionY: 0.031 },
      "seg-flow": { x: 160, y: 912, width: 1280, height: 432, fractionY: 0.125 },
    },
  },
  {
    id: "S-SEG-003",
    slug: "consultants",
    title: "Consultants & agencies · Nutrivo",
    // Not compared: the flow (the first step's "€129/MO EACH BEYOND" meta omitted) and the proof section (the €1,757
    // and "above twenty-five" rows and the cost row of the panel omitted).
    regions: {
      "seg-top": TOP,
      "seg-hero": HERO,
      "seg-problem": { x: 160, y: 575, width: 1280, height: 337, fractionY: 0.031 },
      "seg-close": { x: 160, y: 1820, width: 1280, height: 382, fractionY: 0.67 },
    },
  },
  {
    id: "S-SEG-004",
    slug: "contract-manufacturers",
    title: "Contract manufacturers · Nutrivo",
    // Not compared: the close section, whose "three minutes from done" sentence is omitted.
    regions: {
      "seg-top": TOP,
      "seg-hero": HERO,
      "seg-problem": { x: 160, y: 575, width: 1280, height: 301, fractionY: 0.031 },
      "seg-flow": { x: 160, y: 876, width: 1280, height: 417, fractionY: 0.938 },
      "seg-proof": { x: 160, y: 1294, width: 1280, height: 464, fractionY: 0.688 },
    },
  },
  {
    id: "S-SEG-005",
    slug: "retailers",
    title: "Retailers & buyers · Nutrivo",
    // Not compared: "what happens today" (the Northern Ireland sentence omitted) and the proof section (the "Example
    // verification" panel omitted).
    regions: {
      "seg-top": TOP,
      "seg-hero": HERO,
      "seg-flow": { x: 160, y: 876, width: 1280, height: 397, fractionY: 0.938 },
      "seg-close": { x: 160, y: 1738, width: 1280, height: 382, fractionY: 0.9 },
    },
  },
];

/** Design copy the pages omit (T-603 plan on issue #60, D-19, CLAUDE.md 7): none of it may appear. */
const OMITTED = [
  "we hold the permitted wording",
  "glossary version",
  "with the article",
  "Italian wording",
  "Example envelope",
  "Glucosamine",
  "Joint claim",
  "Markets feasible",
  "missing state filing",
  "Texas",
  "commercial feed registration",
  "We name the authority",
  "Only the operator named on the label",
  "Example cell",
  "four minutes",
  "27 markets",
  "€129",
  "€1,757",
  "twenty-five",
  "three minutes",
  "Northern Ireland",
  "Example verification",
  "NTV-4K7Q-2FJ8",
];

const url = (slug: string) => `/for/${slug}`;

for (const screen of SCREENS) {
  test.describe(`${screen.id} ${url(screen.slug)}`, () => {
    test(`${screen.id} ${url(screen.slug)} matches its design baseline by region at 1600 px`, async ({ page }) => {
      // Console errors and failed requests are the crawl's check (below), not this one.
      const { status } = await open(page, url(screen.slug));
      expect(status).toBe(200);
      await expect(page).toHaveTitle(screen.title);
      for (const [testId, region] of Object.entries(screen.regions)) {
        await test.step(testId, async () => {
          await expectLikeBaseline(page, page.getByTestId(testId), screen.id, region, maxDiffPixelRatio);
        });
      }
    });

    test(`${screen.id} ${url(screen.slug)} has no serious or critical axe findings`, async ({ page }) => {
      await open(page, url(screen.slug));
      await axe(page);
    });

    test(`${screen.id} ${url(screen.slug)} has no dead controls`, async ({ page }) => {
      await crawl(page, url(screen.slug));
    });

    test(`${screen.id} ${url(screen.slug)} marks its segment in the strip`, async ({ page }) => {
      await open(page, url(screen.slug));
      const strip = page.getByRole("navigation", { name: "Who it's for" });
      await expect(strip.getByRole("link")).toHaveCount(SCREENS.length);
      const current = strip.locator('[aria-current="page"]');
      await expect(current).toHaveCount(1);
      await expect(current).toHaveAttribute("href", url(screen.slug));
    });

    test(`${screen.id} ${url(screen.slug)} shows no invented claim and none of the omitted copy`, async ({ page }) => {
      await open(page, url(screen.slug));
      const text = await page.locator("body").innerText();
      for (const phrase of [...INVENTED, ...OMITTED]) expect(text, phrase).not.toContain(phrase);
    });
  });
}

test("S-SEG /for/unknown is a 404", async ({ request }) => {
  const response = await request.get("/for/unknown");
  expect(response.status()).toBe(404);
});
