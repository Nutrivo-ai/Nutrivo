// The label report as Fix mode (S-FIX-001, T-1114): picking a market and reading its result sets, the same at 1600 px
// (the Market buttons) and at 390 px (the Market select).
import { expect, type Page } from "@playwright/test";

export const fixReport = (page: Page) => page.locator('[data-screen="S-NV2-003"] [data-region="report"]');
export const checklist = (page: Page) => page.locator('[data-region="findings"]');
const marketButtons = (page: Page) => page.locator('[data-region="markets"] [data-node]');

/** The markets the report offers, in order. */
export async function marketsOf(page: Page): Promise<string[]> {
  return marketButtons(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-node")!));
}

export async function chooseMarket(page: Page, node: string) {
  const button = page.locator(`[data-region="markets"] [data-node="${node}"]`);
  if (await button.isVisible()) await button.click();
  else await page.getByRole("combobox", { name: "Market" }).selectOption(node);
  await expect(fixReport(page)).toHaveAttribute("data-node", node);
  await expect(checklist(page)).toHaveAttribute("data-node", node);
}

/** The app.checks ids the selected market shows: one per printed panel, each its own result set. */
export async function panelChecks(page: Page): Promise<string[]> {
  return page.locator('[data-region="artwork"] [data-panel]').evaluateAll((els) => els.map((e) => e.getAttribute("data-check-id")!));
}

/** Every result set the report shows, market by market. */
export async function allResultSets(page: Page): Promise<{ node: string; checkId: string }[]> {
  const out: { node: string; checkId: string }[] = [];
  for (const node of await marketsOf(page)) {
    await chooseMarket(page, node);
    for (const checkId of await panelChecks(page)) out.push({ node, checkId });
  }
  return out;
}
