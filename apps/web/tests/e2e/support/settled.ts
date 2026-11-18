// Waits until every finite CSS transition and animation on the page has finished (#279). A colour transition caught
// half-way reads as a contrast failure: kit-transition takes 120 ms, and on a loaded CI runner axe can measure a tab
// that was just pressed while its background is still turning from paper to accent and its text already reads paper.
// Infinite animations (a spinner) are left running, so this never waits on them.
import type { Page } from "@playwright/test";

export async function settled(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => Number.isFinite(Number(a.effect?.getComputedTiming().endTime ?? Infinity)))
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}
