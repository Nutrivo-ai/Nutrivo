import { defineConfig, devices } from "@playwright/test";

// BASE_URL points at a deployed environment (make smoke, make acceptance-staging); locally scripts/ci/e2e.sh serves
// the production build on port 3000.
export default defineConfig({
  testDir: "./tests/e2e",
  // Screenshot assertions name their image under tests/visual/: design baselines (baselines/<screen id>.png, written by
  // `pnpm baselines` from design/) or the kit's own images (kit/<name>.png, written with --update-snapshots).
  snapshotPathTemplate: "{testDir}/../visual/{arg}{ext}",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1600, height: 1000 } } }],
});
