import { defineConfig, devices } from "@playwright/test";

// `pnpm baselines`: captures every screen of spec/screens.yaml from its design file into tests/visual/baselines/
// (docs/20 §2). Run on demand when design/ or the inventory changes; CI compares built routes against the images.
export default defineConfig({
  testDir: "./tests/visual",
  testMatch: "baselines.spec.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: "line",
  timeout: 60_000,
  use: { ...devices["Desktop Chrome"], viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 },
});
