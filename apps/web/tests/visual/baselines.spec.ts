// Captures the baseline of every screen in spec/screens.yaml from its design file (docs/20 §2): serves design/,
// sets the design's own state to the frame, waits for fonts, and saves tests/visual/baselines/<id>.png.
import path from "node:path";
import { test } from "@playwright/test";
import { serveDesign, setDesignState } from "./design-server";
import { loadScreens, REPO_ROOT } from "./screens";

test.describe.configure({ mode: "parallel" });

let server: Awaited<ReturnType<typeof serveDesign>> | undefined;
test.beforeAll(async () => {
  server = await serveDesign();
});
test.afterAll(() => {
  server?.close();
});

for (const screen of loadScreens()) {
  test(`${screen.id} ${screen.title}`, async ({ page }) => {
    await page.goto(`${server!.url}/${encodeURI(screen.design)}`, { waitUntil: "networkidle" });
    await setDesignState(page, screen.state); // {} keeps the default frame, once the component has mounted
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(400); // the frames slide in over 260 ms
    const options = { path: path.join(REPO_ROOT, screen.baseline), animations: "disabled", caret: "hide" } as const;
    if (screen.element) {
      await page.locator(screen.element.css).nth(screen.element.nth).screenshot(options);
    } else {
      await page.screenshot({ ...options, fullPage: true });
    }
  });
}
