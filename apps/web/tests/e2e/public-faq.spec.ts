// T-603 · S-FAQ-001 /faq and S-FAQ-002 /about, from design/public/Nutrivo FAQ and About.dc.html. Neither screen has
// an acceptance ID, so the titles name the screen. Each route is compared with its design baseline at 1600 px region
// by region, only where the route draws what the design draws; regions that differ because copy was omitted (D-19,
// plan on issue #60) are named below and not compared.
import { expect, test } from "@playwright/test";
import { OMITTED_ABOUT } from "../../src/components/public/faq/about";
import { OMITTED_FAQ } from "../../src/components/public/faq/questions";
import { expectLikeBaseline, type Region } from "./support/baseline";
import { axe, crawl, INVENTED, maxDiffPixelRatio, open } from "./support/public";

// Element boxes measured in the design file at 1600 px (its 1120 px column starts at x 240, content at 266).
// fractionY is the sub-pixel part of the element's top in the design.
const FAQ: Record<string, Region> = {
  "faq-header": { x: 0, y: 0, width: 1600, height: 69 },
  "faq-hero": { x: 0, y: 69, width: 1600, height: 329, fractionY: 0.141 },
  // Group 01: the heading and the first row. The second and third rows are not compared: "Who is it not for?" and
  // "Is this legal advice?" each lose a sentence of regulation.
  "faq-group-what": { x: 0, y: 398, width: 1600, height: 262, fractionY: 0.969 },
  // Group 02: the heading, then the questions kept whole. The first row (two questions omitted) is not drawn, and
  // "What happens when a rule changes?" and "Will I know…" lose sentences, so their row is not compared.
  "faq-group-coverage": { x: 0, y: 1072, width: 1600, height: 88, fractionY: 0.609 },
  "faq-q-how-do-you-know-your-rules-are-right": { x: 266, y: 1424, width: 523, height: 196, fractionY: 0.5 },
  "faq-q-what-happens-if-you-do-not-cover-something": { x: 811, y: 1424, width: 523, height: 196, fractionY: 0.5 },
  "faq-q-do-you-check-in-the-local-language": { x: 266, y: 1906, width: 523, height: 128, fractionY: 0 },
  "faq-q-can-you-guarantee-an-authority-will-accept-my-label": { x: 811, y: 1906, width: 523, height: 128, fractionY: 0 },
  // Group 03: the heading and the first two rows. The third row is not compared: "Why can I not buy a single
  // country?" is omitted, so "What happens if I stop paying?" and "Do you offer a discount?" move.
  "faq-group-trying": { x: 0, y: 2075, width: 1600, height: 435, fractionY: 0.625 },
  // Group 04: "How long does a check take?" and "Who can sign a certificate?" are omitted, so the kept questions
  // move between columns; each is compared with where the design draws it.
  "faq-group-using": { x: 0, y: 2869, width: 1600, height: 88, fractionY: 0.297 },
  "faq-q-what-do-i-upload": { x: 266, y: 2958, width: 523, height: 151, fractionY: 0.094 },
  "faq-q-can-my-colleagues-use-it": { x: 266, y: 3131, width: 523, height: 151, fractionY: 0.813 },
  "faq-q-can-my-consultant-or-my-supplier-use-it": { x: 811, y: 3131, width: 523, height: 151, fractionY: 0.813 },
  "faq-q-can-i-get-my-data-out": { x: 811, y: 3305, width: 523, height: 151, fractionY: 0.531 },
  // Group 05: "Where is my data held?", "Do you train models…" and "Who can see my recipes?" lose sentences and
  // "Do you support single sign-on?" is omitted; the two questions kept whole are compared.
  "faq-group-trust": { x: 0, y: 3498, width: 1600, height: 88, fractionY: 0.25 },
  "faq-q-can-the-record-be-altered": { x: 811, y: 3760, width: 523, height: 174, fractionY: 0.766 },
  "faq-q-what-if-a-recipient-wants-to-verify-a-report": { x: 811, y: 3957, width: 523, height: 151, fractionY: 0.578 },
  "faq-contact": { x: 0, y: 4150, width: 1600, height: 265, fractionY: 0.297 },
  "faq-footer": { x: 0, y: 4415, width: 1600, height: 60, fractionY: 0.797 },
};

// Not compared on /about: the draft banner (omitted), the hero (its heading and first paragraph are omitted), the
// left column of "The line we will not sell past" (a sentence of regulation omitted), "How this started" and "Who
// does this" (omitted placeholders), and the second row of "The company" (three of its four items omitted).
const ABOUT: Record<string, Region> = {
  "faq-header": { x: 0, y: 0, width: 1600, height: 69 },
  "about-beliefs": { x: 0, y: 585, width: 1600, height: 637, fractionY: 0 },
  "about-never": { x: 813, y: 1258, width: 521, height: 223, fractionY: 0.125 },
  "about-company": { x: 0, y: 2252, width: 1600, height: 135, fractionY: 0.891 },
  "about-cta": { x: 0, y: 2515, width: 1600, height: 311, fractionY: 0.578 },
  "faq-footer": { x: 0, y: 2827, width: 1600, height: 60, fractionY: 0.156 },
};

const ROUTES = [
  { id: "S-FAQ-001", url: "/faq", title: "Questions · Nutrivo", regions: FAQ, omitted: OMITTED_FAQ },
  { id: "S-FAQ-002", url: "/about", title: "About us · Nutrivo", regions: ABOUT, omitted: OMITTED_ABOUT },
];

for (const route of ROUTES) {
  test.describe(`${route.id} ${route.url}`, () => {
    for (const [testId, region] of Object.entries(route.regions)) {
      test(`${route.id} ${route.url} ${testId} matches its baseline region at 1600 px`, async ({ page }) => {
        // Console errors and failed requests are asserted by the axe and crawl tests below.
        const { status } = await open(page, route.url);
        expect(status).toBe(200);
        await expectLikeBaseline(page, page.getByTestId(testId), route.id, region, maxDiffPixelRatio);
      });
    }

    test(`${route.id} ${route.url} has its title and passes axe`, async ({ page }) => {
      const { errors } = await open(page, route.url);
      await expect(page).toHaveTitle(route.title);
      await axe(page);
      expect(errors).toEqual([]);
    });

    test(`${route.id} ${route.url} has no dead controls`, async ({ page }) => {
      await crawl(page, route.url);
    });

    test(`${route.id} ${route.url} shows no invented claim and none of the omitted copy`, async ({ page }) => {
      await open(page, route.url);
      const text = await page.locator("body").innerText();
      for (const phrase of [...INVENTED, ...route.omitted]) expect(text, phrase).not.toContain(phrase);
    });
  });
}

test("S-FAQ-001 /faq and S-FAQ-002 /about link to each other, and the topic chips reach their sections", async ({ page }) => {
  await open(page, "/faq");
  await expect(page.getByRole("link", { name: "Questions", exact: true })).toHaveAttribute("aria-current", "page");
  for (const [chip, id] of [["Using it day to day", "using"], ["Data, security and trust", "trust"]]) {
    await page.getByRole("navigation", { name: "Topics" }).getByRole("link", { name: chip }).click();
    await expect(page).toHaveURL(new RegExp(`/faq#${id}$`));
    await expect(page.locator(`#${id}`)).toBeInViewport();
  }
  await page.getByRole("link", { name: "About us", exact: true }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole("link", { name: "About us", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: "Questions", exact: true }).click();
  await expect(page).toHaveURL(/\/faq$/);
});
