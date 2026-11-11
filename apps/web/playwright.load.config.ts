import { defineConfig, devices } from "@playwright/test";

// T-1105: the load test (tests/load), one run per profile in config/load/profiles.yaml (LOAD_PROFILE). Started by
// scripts/load/run.sh (make load), which serves the local stack, or by the nightly staging-load job with BASE_URL.
// One worker, files in name order: 1-performance makes the load, 2-operations reads what it recorded.
export default defineConfig({
  testDir: "./tests/load",
  workers: 1,
  fullyParallel: false,
  retries: 0, // a budget is measured once per run: a retry would hide a slow sample
  timeout: 30 * 60_000,
  forbidOnly: Boolean(process.env.CI),
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3000",
    trace: "off",
  },
  projects: [{ name: "load", use: { ...devices["Desktop Chrome"] } }],
});
