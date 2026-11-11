// T-1105: the performance budgets of spec/nfr.yaml under load, against the local stack (scripts/load/run.sh: local
// Supabase, the worker and the production build of the web) or, in GitHub Actions only, staging. Each test names its
// budget as [nfr:<section>.<key>] and writes its result to reports/load/ (support/budgets.ts). The profile
// (config/load/profiles.yaml, LOAD_PROFILE) sets the sample sizes and which budgets fail the run when exceeded.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { PUBLIC_ROUTES, SEGMENTS, segmentHref } from "../../src/lib/public/links";
import { haveStack, signIn } from "../e2e/support/people";
import { judgeP95, OUT, outcome, pool, profile, timed, withhold } from "./support/budgets";
import { finished, issuedReport, loadWorkspace, product, registerArtwork, type LoadWorkspace } from "./support/seed";

const EXTRACT_TIMEOUT_MS = 10 * 60_000;
const CHECK_TIMEOUT_MS = 10 * 60_000;

test.describe("performance budgets", () => {
  test.skip(!haveStack(), "needs the stack's variables: run through scripts/load/run.sh (make load)");
  // Not serial: a budget that fails must not skip the others. After a failure Playwright starts a new worker, whose
  // beforeAll seeds a fresh workspace for the tests left.

  let load: LoadWorkspace;

  test.beforeAll(async () => {
    test.setTimeout(10 * 60_000);
    load = await loadWorkspace(profile.recipes);
  });

  test("[nfr:performance.rpc_p95_ms] RPCs under a member's session stay within the p95 budget under load", async () => {
    const app = load.owner.db.schema("app");
    const p = load.products;
    // The calls the screens make most: reads every screen makes and the brief's writes (each idempotent, so repeating
    // them leaves the same state: a write audits, which is part of what it costs).
    const calls: [string, () => PromiseLike<{ error: unknown }>][] = [
      ["rollup_state", () => app.rpc("rollup_state", { p_product: p[0], p_node: "EU" })],
      ["live_billable_counts", () => app.rpc("live_billable_counts", { p_ws: load.ws })],
      ["billing_context", () => app.rpc("billing_context", { p_ws: load.ws })],
      ["set_intended_claims", () => app.rpc("set_intended_claims", { p_product: p[1 % p.length], p_language: "de", p_claims: ["Alleinfuttermittel"] })],
      ["set_formula_lines", () => app.rpc("set_formula_lines", { p_product: p[2 % p.length], p_lines: [{ ingredient: "Lachs", percent: 26 }] })],
    ];
    const errors: Record<string, number> = {};
    const runs = await pool(profile.rpc_calls, profile.concurrency, (i) => {
      const [name, call] = calls[i % calls.length];
      return timed("app", async () => {
        const { error } = await call();
        if (error) errors[name] = (errors[name] ?? 0) + 1;
        return !error;
      });
    });
    const ok = runs.filter((r) => r.ok).map((r) => r.ms);
    judgeP95("performance.rpc_p95_ms", "ms", ok, { calls: calls.map(([n]) => n), failed: errors, concurrency: profile.concurrency });
    expect(errors, "every RPC answered").toEqual({});
  });

  test("[nfr:performance.board_300_recipes_p95_ms] the board of a 300-recipe workspace renders within the p95 budget", async ({ browser, baseURL }) => {
    test.setTimeout(15 * 60_000);
    const context = await browser.newContext();
    await signIn(context, load.owner, baseURL!);
    const url = `/w/${load.ws}/board`;
    // One warm-up load, so a cold server's first compile of the route is not counted.
    await context.request.get(url);
    const runs = await pool(profile.board_loads, Math.min(profile.concurrency, 4), () =>
      timed("app", async () => {
        const res = await context.request.get(url);
        const html = await res.text();
        return res.status() === 200 && html.includes('data-region="grid"') && html.includes("Load recipe 001");
      }),
    );
    await context.close();
    const ok = runs.filter((r) => r.ok).map((r) => r.ms);
    const scaled = profile.recipes === 300 ? undefined : `profile ${profile.name} seeds ${profile.recipes} recipes, not 300: reported, not comparable`;
    judgeP95("performance.board_300_recipes_p95_ms", "ms", ok, { recipes: profile.recipes, failed: runs.length - ok.length }, scaled, !scaled);
    expect(runs.length - ok.length, "every board load rendered the grid").toBe(0);
  });

  test("[nfr:performance.search_300_recipes_p95_ms] search over 300 recipes is withheld: no search exists before BE-41", async () => {
    // F02 (search, saved views) is LATER and BE-41 is after launch (#56 Q6): there is no endpoint to measure, so the
    // budget is withheld, never met.
    withhold("performance.search_300_recipes_p95_ms", "ms", "not_built: search (F02, BE-41) is after launch", { recipes: profile.recipes });
  });

  test("[nfr:performance.extraction_10_pages_p95_s] a 10-page artwork extracts within the p95 budget [nfr:performance.check_completion_p95_s] and its check completes within budget", async () => {
    test.setTimeout((profile.extractions + profile.checks) * (EXTRACT_TIMEOUT_MS + CHECK_TIMEOUT_MS));
    const extract: number[] = [];
    const check: number[] = [];
    const failures: string[] = [];
    const checkJobs: string[] = [];
    // One artwork at a time: each sample is the job's own time from enqueue to done, as the person waits for it.
    for (let i = 0; i < Math.max(profile.extractions, profile.checks); i++) {
      const productId = await product(load.ws, `Load artwork ${i + 1} ${randomUUID().slice(0, 4)}`);
      const av = await registerArtwork(load.owner, load.ws, productId);
      const ex = await finished({ key: `extract:${av}` }, EXTRACT_TIMEOUT_MS);
      if (ex.status !== "succeeded") {
        failures.push(`extract ${ex.status}: ${ex.last_error ?? ""}`);
        continue;
      }
      if (i < profile.extractions) extract.push(ex.seconds);
      if (i >= profile.checks) continue;
      const { data: jobId, error } = await load.owner.db.schema("app").rpc("request_check", { p_product: productId });
      if (error || !jobId) {
        failures.push(`request_check: ${(error as { message?: string } | null)?.message ?? "no job"}`);
        continue;
      }
      const ck = await finished({ id: jobId as string }, CHECK_TIMEOUT_MS);
      if (ck.status !== "succeeded") failures.push(`check ${ck.status}: ${ck.last_error ?? ""}`);
      else check.push(ck.seconds);
      checkJobs.push(jobId as string);
    }
    // The check jobs this run made, for the cost budget (2-operations.spec.ts).
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, "check-jobs.json"), JSON.stringify(checkJobs));
    judgeP95("performance.extraction_10_pages_p95_s", "s", extract, { pages: 10, failures });
    judgeP95("performance.check_completion_p95_s", "s", check, { pages: 10, failures });
    expect(failures, "every extraction and check succeeded").toEqual([]);
  });

  test("[nfr:performance.verify_endpoint_p95_ms] the verify Edge Function answers within the p95 budget under load", async () => {
    const ref = await issuedReport(load.ws, load.products[0]);
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "");
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const perMinute = 1000; // under the function's per-instance limit (1200 a minute, verify.js)
    const started = Date.now();
    let limited = 0;
    const call = (i: number) =>
      fetch(`${base}/functions/v1/verify/${ref}`, {
        headers: {
          Authorization: `Bearer ${anon}`,
          apikey: anon,
          // Distinct callers from the documentation range (RFC 5737), as the per-client limit (60 a minute) would
          // otherwise answer 429 to a single load client. A gateway that sets its own address ignores this.
          "X-Forwarded-For": `198.51.100.${(i % 250) + 1}`,
          "x-request-id": `load-${i}`,
        },
      });
    await call(0); // warm-up: the edge runtime's first boot of the function is not a request a person waits for
    const runs = await pool(profile.verify_calls, profile.concurrency, async (i) => {
      const due = started + (i * 60_000) / perMinute;
      if (due > Date.now()) await new Promise((r) => setTimeout(r, due - Date.now()));
      const started1 = performance.now();
      const res = await call(i).catch(() => null);
      const ms = performance.now() - started1;
      if (res?.status === 429) {
        limited++;
        return { ms, ok: null as boolean | null };
      }
      const body = res ? ((await res.json().catch(() => null)) as { status?: string } | null) : null;
      const ok = res?.status === 200 && body?.status === "current";
      return { ms, ok };
    });
    // 429 is the rate limiter doing its job (I04): neither a success nor an outage, so it is left out of both.
    for (const r of runs) if (r.ok !== null) outcome("verify", r.ok);
    const ok = runs.filter((r) => r.ok).map((r) => r.ms);
    judgeP95("performance.verify_endpoint_p95_ms", "ms", ok, { failed: runs.filter((r) => r.ok === false).length, rate_limited: limited });
    expect(runs.filter((r) => r.ok === false).length, "every verification answered current").toBe(0);
  });

  test("[nfr:performance.public_pages_lcp_s] public pages paint their largest content within the LCP budget", async ({ browser, baseURL }) => {
    test.setTimeout(10 * 60_000);
    const ref = await issuedReport(load.ws, load.products[0]);
    // Every public route (T-603, src/lib/public/links.ts), each "Who it is for" page, and a verification page.
    const routes = [...Object.values(PUBLIC_ROUTES), ...SEGMENTS.map((seg) => segmentHref(seg.slug)), `/verify/${ref}`];
    const samples: number[] = [];
    const byRoute: Record<string, number[]> = {};
    for (let run = 0; run < profile.lcp_runs; run++) {
      for (const route of routes) {
        // A fresh context each time: an empty cache, as a first visit from a search result.
        const ctx = await browser.newContext({ baseURL, viewport: { width: 1366, height: 768 } });
        const page = await ctx.newPage();
        const res = await page.goto(route, { waitUntil: "load" });
        const lcp = await page.evaluate(
          () =>
            new Promise<number>((resolve) => {
              let latest = 0;
              new PerformanceObserver((list) => {
                for (const e of list.getEntries()) latest = e.startTime;
              }).observe({ type: "largest-contentful-paint", buffered: true });
              setTimeout(() => resolve(latest), 1000);
            }),
        );
        await ctx.close();
        if (res?.ok() && lcp > 0) {
          samples.push(lcp / 1000);
          (byRoute[route] ??= []).push(Math.round(lcp));
        }
      }
    }
    judgeP95("performance.public_pages_lcp_s", "s", samples, { routes: byRoute, viewport: "1366x768", throttling: "none" });
    expect(samples.length, "every public page painted").toBe(routes.length * profile.lcp_runs);
  });
});
