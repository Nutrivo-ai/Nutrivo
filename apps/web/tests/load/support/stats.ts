// Pure helpers of the load records (T-1105, issue 348): no Playwright and no files, so vitest can test them
// (stats.test.ts) and support/budgets.ts can use them.

/** Nearest-rank percentile (the value at or below which p% of samples fall); null for no samples. */
export function percentile(samples: number[], p: number): number | null {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

/** Rounded to `step` (0.1 rounds to one decimal); null stays null. */
export function roundTo(n: number | null, step: number): number | null {
  return n == null ? null : Math.round(n / step) / Math.round(1 / step);
}

/** p50 and p95 of samples in ms, to 0.1 ms; null for none. */
export function spread(samples: number[]): { p50_ms: number | null; p95_ms: number | null } {
  return { p50_ms: roundTo(percentile(samples, 50), 0.1), p95_ms: roundTo(percentile(samples, 95), 0.1) };
}

/** The edge location in a cf-ray header ("8f1c2d3e4a5b6c7d-SEA" is SEA); "none" without one. */
export function edgeOf(ray: string | null | undefined): string {
  const m = /-([A-Z]{3})$/.exec(ray ?? "");
  return m ? m[1] : "none";
}
