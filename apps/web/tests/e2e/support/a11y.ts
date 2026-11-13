// T-1104 · WCAG 2.2 AA checks shared by the accessibility sweep (a11y.spec.ts) and the keyboard tests (keyboard.spec.ts).
// axe runs with the WCAG 2.0, 2.1 and 2.2 A and AA rules and must find nothing at any impact; its best-practice rules
// keep the nfr budget (no serious or critical finding, spec/nfr.yaml). What axe cannot see (page titles, the skip link,
// focus that is visible, not obscured and never trapped, reflow at 320 px) is checked here directly.
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { nfr } from "./public";

export const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** Zero WCAG 2.2 A/AA violations of any impact, and no serious or critical best-practice finding. */
export async function wcag(page: Page, where = page.url()) {
  const results = await new AxeBuilder({ page }).withTags([...WCAG_22_AA, "best-practice"]).analyze();
  const describe = (v: (typeof results.violations)[number]) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`;
  const wcagViolations = results.violations.filter((v) => v.tags.some((t) => WCAG_22_AA.includes(t)));
  expect(wcagViolations.map(describe), `WCAG 2.2 AA on ${where}`).toEqual([]);
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map(describe), `serious or critical on ${where}`).toEqual([]);
  expect(serious.length).toBeLessThanOrEqual(nfr.quality.axe_serious_or_critical);
}

/** WCAG 2.4.2: every page names itself, "<what> · Nutrivo", never the bare product name. */
export async function titled(page: Page) {
  await expect(page).toHaveTitle(/^\S.* · Nutrivo$|^Nutrivo · \S|^Kit · \S/);
}

/** WCAG 1.4.10: nothing makes the page scroll sideways at 320 CSS px (wide tables scroll inside their own region). */
export async function reflows(page: Page, where = page.url()) {
  const size = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 800 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), { message: `${where} reflows at 320 px` })
    .toBeLessThanOrEqual(0);
  if (size) await page.setViewportSize(size);
}

export type Stop = { name: string; tag: string; segments: number; ring: boolean; obscured: boolean; inMain: boolean; key: string };

/** The element that has focus now, with what the focus checks need. Null when focus is on the page itself. */
export function focused(page: Page): Promise<Stop | null> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body || el === document.documentElement) return null;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const x = Math.min(Math.max(rect.left + rect.width / 2, 0), innerWidth - 1);
    const y = Math.min(Math.max(rect.top + rect.height / 2, 0), innerHeight - 1);
    const hit = document.elementFromPoint(x, y);
    // A native control that is visually hidden behind its label (a styled radio or checkbox) is shown by the label.
    const label = (el as HTMLInputElement).labels?.[0] ?? null;
    const shows = (h: Element | null) => !!h && (h === el || el.contains(h) || h.contains(el) || (!!label && (label === h || label.contains(h))));
    const ring =
      (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) ||
      (style.boxShadow !== "" && style.boxShadow !== "none") ||
      // A visually hidden control (a styled radio) whose label draws the focus instead.
      (!!label && getComputedStyle(label).outlineStyle !== "none" && parseFloat(getComputedStyle(label).outlineWidth) > 0);
    return {
      name: (el.getAttribute("aria-label") || el.innerText || (el as HTMLInputElement).value || el.getAttribute("name") || el.tagName).trim().slice(0, 60),
      tag: el.tagName,
      // A date or time field's segments (day, month, year) and its picker button each take a Tab.
      segments: el instanceof HTMLInputElement && /^(date|time|datetime-local|month|week)$/.test(el.type) ? 4 : 1,
      ring,
      obscured: !shows(hit),
      inMain: !!el.closest("main"),
      key: `${el.outerHTML.length}:${el.outerHTML.slice(0, 200)}:${Math.round(rect.top + scrollY)}:${Math.round(rect.left + scrollX)}`,
    };
  });
}

/**
 * Tabs through the page from the top (WCAG 2.1.1, 2.1.2, 2.4.7, 2.4.11): every stop shows a focus indicator and is not
 * hidden behind other content, and focus always moves on. A date field's segments and picker are one element and take
 * a press each, so a date field may hold focus for up to four presses in a row; anything else moves on at once. Returns the stops in order.
 */
export async function tabThrough(page: Page, where = page.url(), max = 200): Promise<Stop[]> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const stops: Stop[] = [];
  let repeats = 0;
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const stop = await focused(page);
    if (!stop) break; // focus left the document: the end of the page
    const last = stops[stops.length - 1];
    if (last && last.key === stop.key) {
      repeats++;
      expect(repeats, `focus is trapped on "${stop.name}" on ${where}`).toBeLessThan(stop.segments);
      continue;
    }
    repeats = 0;
    if (stops.some((s) => s.key === stop.key)) break; // wrapped around to the start
    expect(stop.ring, `"${stop.name}" on ${where} shows where focus is`).toBe(true);
    expect(stop.obscured, `"${stop.name}" on ${where} is not hidden behind other content when focused`).toBe(false);
    stops.push(stop);
  }
  return stops;
}
