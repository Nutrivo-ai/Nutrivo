// T-1105: the budgets of spec/nfr.yaml, the load profile (config/load/profiles.yaml) and the record each budget's test
// leaves in reports/load/<section>.<key>.json for scripts/load/budgets.py to report (reports/LOAD.md).
// A test title carries its budget as [nfr:<section>.<key>]; scripts/load/test_budgets.py fails when one has none.
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { parse } from "yaml";
import { REPO_ROOT } from "../../visual/screens";

export type Status = "met" | "exceeded" | "withheld" | "staging_only";

export type Profile = {
  name: string;
  recipes: number;
  markets_per_recipe: number;
  rpc_calls: number;
  board_loads: number;
  verify_calls: number;
  lcp_runs: number;
  extractions: number;
  checks: number;
  concurrency: number;
  enforce: string[];
};

type Nfr = Record<string, Record<string, number>>;

export const nfr = parse(fs.readFileSync(path.join(REPO_ROOT, "spec/nfr.yaml"), "utf8")) as Nfr;

const PROFILES = parse(fs.readFileSync(path.join(REPO_ROOT, "config/load/profiles.yaml"), "utf8")) as Record<string, Omit<Profile, "name">>;

export const profileName = process.env.LOAD_PROFILE || "local";
if (!PROFILES[profileName]) throw new Error(`unknown load profile ${profileName}: config/load/profiles.yaml has ${Object.keys(PROFILES).join(", ")}`);
export const profile: Profile = { name: profileName, ...PROFILES[profileName] };

export const OUT = path.join(REPO_ROOT, "reports/load");

/** The budget's value in spec/nfr.yaml, by `<section>.<key>`. */
export function budget(key: string): number {
  const [section, name] = key.split(".");
  const value = nfr[section]?.[name];
  if (typeof value !== "number") throw new Error(`spec/nfr.yaml has no budget ${key}`);
  return value;
}

/** Nearest-rank percentile (the value at or below which p% of samples fall); null for no samples. */
export function percentile(samples: number[], p: number): number | null {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

export type Result = {
  budget: string;
  limit: number;
  unit: string;
  measured: number | null;
  n: number;
  status: Status;
  profile: string;
  enforced: boolean;
  reason?: string;
  detail?: Record<string, unknown>;
};

/** Writes the budget's result and, when the profile enforces it, fails the test unless it is met. */
export function record(r: Omit<Result, "limit" | "profile" | "enforced">): Result {
  const full: Result = { ...r, limit: budget(r.budget), profile: profile.name, enforced: profile.enforce.includes(r.budget) };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${r.budget}.json`), JSON.stringify(full, null, 2) + "\n");
  const shown = r.measured == null ? "not measured" : `${round(r.measured)} ${r.unit}`;
  test.info().annotations.push({ type: r.status, description: `${shown} against ${full.limit} ${r.unit}, n ${r.n}${r.reason ? ` (${r.reason})` : ""}` });
  if (full.enforced) expect(full.status, `${r.budget}: ${shown} against ${full.limit} ${r.unit}${r.reason ? `: ${r.reason}` : ""}`).toBe("met");
  return full;
}

/** A latency budget (lower is better): the p95 of the samples against the budget. No samples is withheld, never met. */
export function judgeP95(key: string, unit: string, samples: number[], detail?: Record<string, unknown>, reason?: string, comparable = true): Result {
  const p95 = percentile(samples, 95);
  // A run at another scale than the budget's own (the ci profile's 30 recipes) is reported, never judged met.
  const status: Status = p95 == null || !comparable ? "withheld" : p95 <= budget(key) ? "met" : "exceeded";
  return record({ budget: key, unit, measured: p95, n: samples.length, status, detail, reason: reason ?? (p95 == null ? "no samples" : undefined) });
}

/** A budget the load run cannot measure: recorded as withheld with its reason, so the report never shows it as met. */
export function withhold(key: string, unit: string, reason: string, detail?: Record<string, unknown>): Result {
  return record({ budget: key, unit, measured: null, n: 0, status: "withheld", reason, detail });
}

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}

/** Runs `count` calls of `fn` with at most `concurrency` in flight; returns each call's result in order. */
export async function pool<T>(count: number, concurrency: number, fn: (i: number) => Promise<T>): Promise<T[]> {
  const out: T[] = new Array(count);
  let next = 0;
  const lane = async () => {
    while (next < count) {
      const i = next++;
      out[i] = await fn(i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, count)) }, lane));
  return out;
}

/** Milliseconds `fn` took, and whether it succeeded; every request also counts towards the availability stand-in. */
export async function timed(service: "app" | "verify", fn: () => Promise<boolean>): Promise<{ ms: number; ok: boolean }> {
  const started = performance.now();
  let ok = false;
  try {
    ok = await fn();
  } catch {
    ok = false;
  }
  const ms = performance.now() - started;
  outcome(service, ok);
  return { ms, ok };
}

/** Appends one request outcome to reports/load/requests.jsonl (read by the availability tests). */
export function outcome(service: "app" | "verify", ok: boolean) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.appendFileSync(path.join(OUT, "requests.jsonl"), JSON.stringify({ service, ok }) + "\n");
}

/** The request outcomes recorded so far in this run. */
export function outcomes(): { service: string; ok: boolean }[] {
  const file = path.join(OUT, "requests.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
