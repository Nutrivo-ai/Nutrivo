// Shared checks for the public site (T-603): open a route watching for errors, axe, and the no-dead-controls crawl
// (docs/20 §4) that every public route runs.
import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { parse } from "yaml";
import { REPO_ROOT } from "../../visual/screens";

export const nfr = parse(fs.readFileSync(path.join(REPO_ROOT, "spec/nfr.yaml"), "utf8")) as {
  quality: { visual_max_diff_pixel_ratio: number; axe_serious_or_critical: number };
};
export const maxDiffPixelRatio = nfr.quality.visual_max_diff_pixel_ratio;

export function watch(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  return errors;
}

export async function open(page: Page, url: string) {
  const errors = watch(page);
  const response = await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  return { errors, status: response?.status() };
}

export async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  expect(serious.length).toBeLessThanOrEqual(nfr.quality.axe_serious_or_critical);
}

/** What a button's click may change: the page's visible text, any pressed/selected/expanded state, or the URL. */
async function fingerprint(page: Page) {
  return page.evaluate(() => {
    const states = Array.from(document.querySelectorAll("[aria-pressed],[aria-selected],[aria-expanded],[aria-current]"))
      .map((el) => ["aria-pressed", "aria-selected", "aria-expanded", "aria-current"].map((a) => el.getAttribute(a)).join(","))
      .join("|");
    return `${location.href}\n${states}\n${document.body.innerText}`;
  });
}

/**
 * No dead controls: every visible link resolves (an internal route answers below 400, a fragment names an element on
 * the page, a mail link has an address) and every visible button changes something on the page. A button that is
 * the current choice of its group (pressed or selected) is clicked once another choice is current.
 */
export async function crawl(page: Page, url: string) {
  const { errors } = await open(page, url);
  const hrefs = await page.locator("a").filter({ visible: true }).evaluateAll((links) => links.map((a) => a.getAttribute("href")));
  expect(hrefs.length, `${url} has links`).toBeGreaterThan(0);
  for (const href of new Set(hrefs)) {
    expect(href, `a link on ${url} has no href`).toBeTruthy();
    if (href!.startsWith("#")) {
      expect(await page.locator(`[id="${href!.slice(1)}"]`).count(), `${href} on ${url} names an element`).toBe(1);
    } else if (href!.startsWith("mailto:")) {
      expect(href).toMatch(/^mailto:[^@\s]+@[^@\s]+\.[a-z]+/);
    } else {
      expect(href, `${href} on ${url} stays on the site`).toMatch(/^\//);
      const response = await page.request.get(href!.split("#")[0], { maxRedirects: 0 });
      expect(response.status(), `${href} on ${url}`).toBeLessThan(400);
    }
  }
  const buttons = page.locator("button").filter({ visible: true });
  const count = await buttons.count();
  const clicked = new Set<number>();
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < count; i++) {
      if (clicked.has(i)) continue;
      const button = buttons.nth(i);
      const current = (await button.getAttribute("aria-pressed")) === "true" || (await button.getAttribute("aria-selected")) === "true";
      if (current && pass === 0) continue;
      const before = await fingerprint(page);
      await button.click();
      await expect.poll(() => fingerprint(page), { message: `button "${await button.innerText()}" on ${url} does something` }).not.toBe(before);
      clicked.add(i);
      if (page.url() !== new URL(url, page.url()).href) await page.goto(url);
    }
  }
  expect(clicked.size, `every button on ${url} was clicked`).toBe(count);
  expect(errors).toEqual([]);
}

/**
 * Figures, names and claims the public design files draw that no released source backs (D-19, plan on issue #60).
 * None may appear on any public route; the coverage figures come from public.coverage_snapshot() only.
 */
export const INVENTED = [
  "1.9 mm",
  "Annex VI",
  "306 rules",
  "Applying 306",
  "418",
  "Taama",
  "€300–700",
  "GIW",
  "2026.08",
  "4 SEP 2026",
  "4 Sep 2026",
  "PLACEHOLDER",
  "Office of the Texas State Chemist",
];
