import { describe, expect, it } from "vitest";
import { edgeOf, percentile, roundTo, spread } from "./stats";

describe("load record helpers (issue 348)", () => {
  it("percentile is nearest-rank, null for no samples", () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(xs, 95)).toBe(95);
    expect(percentile(xs, 50)).toBe(50);
    expect(percentile([3, 1, 2], 100)).toBe(3);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 95)).toBeNull();
  });

  it("spread gives p50 and p95 to 0.1 ms, nulls for no samples", () => {
    expect(spread([10.04, 20.06, 30.01, 40, 500.55])).toEqual({ p50_ms: 30, p95_ms: 500.6 });
    expect(spread([])).toEqual({ p50_ms: null, p95_ms: null });
    expect(roundTo(null, 0.1)).toBeNull();
  });

  it("edgeOf reads the edge location from cf-ray, and none without one", () => {
    expect(edgeOf("8f1c2d3e4a5b6c7d-SEA")).toBe("SEA");
    expect(edgeOf("8f1c2d3e4a5b6c7d-FRA")).toBe("FRA");
    expect(edgeOf(null)).toBe("none");
    expect(edgeOf(undefined)).toBe("none");
    expect(edgeOf("")).toBe("none");
    expect(edgeOf("8f1c2d3e4a5b6c7d")).toBe("none");
    expect(edgeOf("8f1c2d3e4a5b6c7d-sea")).toBe("none");
  });
});
