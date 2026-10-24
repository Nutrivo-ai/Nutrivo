// Compares one element of a route with the same region of its design baseline (docs/20 §4). The Account Recovery
// baselines draw the screen as a card beside notes about it; the card is the screen, so the card is what is compared.
// The comparison runs in a blank page's canvas, so it needs no image library. A pixel differs as Playwright's own
// toHaveScreenshot decides it (pixelmatch's YIQ colour distance, threshold 0.2), so maxDiffPixelRatio means the same
// here as in every other visual test.
import fs from "node:fs";
import path from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { REPO_ROOT } from "../../visual/screens";

/**
 * Where the element sits in the baseline image. `fractionY` is the sub-pixel part of its top edge in the design (the
 * design's card follows a header and an introduction of fractional height): text rasterises differently at a
 * different fraction, so the route's element is nudged to the same fraction before it is captured. That changes the
 * comparison's raster grid, never the layout under test.
 */
export type Region = { x: number; y: number; width: number; height: number; fractionY?: number };

export async function expectLikeBaseline(page: Page, element: Locator, screenId: string, region: Region, maxDiffPixelRatio: number) {
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  const box = await element.evaluate((el, fraction) => {
    const top = el.getBoundingClientRect().top + window.scrollY;
    if (fraction !== undefined) {
      (el as HTMLElement).style.position = "relative";
      (el as HTMLElement).style.top = `${Math.floor(top) + fraction - top}px`;
    }
    const r = el.getBoundingClientRect();
    return { x: Math.floor(r.left + window.scrollX), y: Math.floor(r.top + window.scrollY) };
  }, region.fractionY);
  const clip = { x: box.x, y: box.y, width: region.width, height: region.height };
  const actual = (await page.screenshot({ clip, fullPage: true, animations: "disabled", caret: "hide" })).toString("base64");
  const baseline = fs.readFileSync(path.join(REPO_ROOT, "apps/web/tests/visual/baselines", `${screenId}.png`)).toString("base64");
  const scratch = await page.context().newPage();
  try {
    const result = await scratch.evaluate(
      async ({ actual, baseline, region }) => {
        const load = (b64: string) =>
          new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = `data:image/png;base64,${b64}`;
          });
        const [a, b] = await Promise.all([load(actual), load(baseline)]);
        const pixels = (img: HTMLImageElement, sx: number, sy: number) => {
          const canvas = document.createElement("canvas");
          canvas.width = region.width;
          canvas.height = region.height;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(img, sx, sy, region.width, region.height, 0, 0, region.width, region.height);
          return ctx.getImageData(0, 0, region.width, region.height).data;
        };
        const pa = pixels(a, 0, 0);
        const pb = pixels(b, region.x, region.y);
        const diff = document.createElement("canvas");
        diff.width = region.width * 3;
        diff.height = region.height;
        const dctx = diff.getContext("2d")!;
        dctx.drawImage(b, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height);
        dctx.drawImage(a, 0, 0, region.width, region.height, region.width, 0, region.width, region.height);
        const marks = dctx.createImageData(region.width, region.height);
        let differing = 0;
        const maxDelta = 35215 * 0.2 * 0.2;
        for (let i = 0; i < pa.length; i += 4) {
          const dr = pa[i] - pb[i];
          const dg = pa[i + 1] - pb[i + 1];
          const db = pa[i + 2] - pb[i + 2];
          const y = dr * 0.29889531 + dg * 0.58662247 + db * 0.11448223;
          const iq = dr * 0.59597799 - dg * 0.2741761 - db * 0.32180189;
          const q = dr * 0.21147017 - dg * 0.52261711 + db * 0.31114694;
          const hit = 0.5053 * y * y + 0.299 * iq * iq + 0.1957 * q * q > maxDelta;
          if (hit) differing++;
          marks.data.set(hit ? [220, 30, 30, 255] : [255, 255, 255, 255], i);
        }
        dctx.putImageData(marks, region.width * 2, 0);
        return { size: [a.width, a.height], ratio: differing / (region.width * region.height), image: diff.toDataURL("image/png") };
      },
      { actual, baseline, region },
    );
    // Design | route | differing pixels, kept in reports/visual/ (uploaded by CI) whenever the comparison fails.
    if (result.ratio > maxDiffPixelRatio || result.size[0] !== region.width || result.size[1] !== region.height) {
      const dir = path.join(REPO_ROOT, "reports/visual");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${screenId}-diff.png`), Buffer.from(result.image.split(",")[1], "base64"));
    }
    expect(result.size, `${screenId}: the element is the size the design draws`).toEqual([region.width, region.height]);
    expect(result.ratio, `${screenId}: share of pixels that differ from the design`).toBeLessThanOrEqual(maxDiffPixelRatio);
  } finally {
    await scratch.close();
  }
}
