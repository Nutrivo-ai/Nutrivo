// T-1105: the availability and cost budgets of spec/nfr.yaml, read from what 1-performance.spec.ts did (Playwright
// runs the files in name order on one worker, playwright.load.config.ts). Monthly availability needs a month of
// synthetic checks, so a load run checks its own success ratio against each target as a stand-in (#83 Q5); the cost of
// a check is read from app.model_calls for the checks this run made.
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { admin, haveStack } from "../e2e/support/people";
import { budget, OUT, outcomes, percentile, profile, record, withhold } from "./support/budgets";

/** The success ratio of this run's requests to `service`, against a monthly availability target (higher is better). */
function availability(key: string, service: "app" | "verify") {
  const seen = outcomes().filter((o) => o.service === service);
  if (!seen.length) return withhold(key, "%", `no ${service} requests recorded in this run (run 1-performance.spec.ts first)`);
  const percent = (100 * seen.filter((o) => o.ok).length) / seen.length;
  return record({
    budget: key,
    unit: "%",
    measured: percent,
    n: seen.length,
    status: percent >= budget(key) ? "met" : "exceeded",
    reason: "stand-in: this run's success ratio; the monthly figure comes from the synthetic monitor on staging and prod (#83 Q5)",
    detail: { failed: seen.filter((o) => !o.ok).length, profile: profile.name },
  });
}

test.describe("availability and cost budgets", () => {
  test.skip(!haveStack(), "needs the stack's variables: run through scripts/load/run.sh (make load)");

  test("[nfr:availability.app_monthly_percent] the app answered at least its availability target during the load run", () => {
    availability("availability.app_monthly_percent", "app");
  });

  test("[nfr:availability.verify_monthly_percent] verification answered at least its availability target during the load run", () => {
    availability("availability.verify_monthly_percent", "verify");
  });

  test("[nfr:cost.model_cost_per_check_eur_p95] model cost per check, from app.model_calls of this run's checks", async () => {
    const file = path.join(OUT, "check-jobs.json");
    const jobs: string[] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
    if (!jobs.length) {
      withhold("cost.model_cost_per_check_eur_p95", "EUR", "no check ran in this load run");
      return;
    }
    const app = admin().schema("app");
    const checks = await app.from("checks").select("id, job_id").in("job_id", jobs);
    expect(checks.error).toBeNull();
    const checkJob = new Map((checks.data ?? []).map((c) => [c.id, c.job_id as string]));
    const findings = checkJob.size
      ? await app.from("check_findings").select("check_id, model_call_id").in("check_id", [...checkJob.keys()]).not("model_call_id", "is", null)
      : { data: [], error: null };
    expect(findings.error).toBeNull();
    const callJob = new Map((findings.data ?? []).map((f) => [f.model_call_id as string, checkJob.get(f.check_id)!]));
    const calls = callJob.size
      ? await app.from("model_calls").select("id, cost_eur, input_tokens, output_tokens").in("id", [...callJob.keys()])
      : { data: [], error: null };
    expect(calls.error).toBeNull();

    const perJob = new Map<string, { eur: number; priced: boolean; tokens: number; calls: number }>(
      jobs.map((j) => [j, { eur: 0, priced: true, tokens: 0, calls: 0 }]),
    );
    for (const c of calls.data ?? []) {
      const j = perJob.get(callJob.get(c.id)!)!;
      j.calls++;
      j.tokens += (c.input_tokens ?? 0) + (c.output_tokens ?? 0);
      if (c.cost_eur == null) j.priced = false;
      else j.eur += Number(c.cost_eur);
    }
    const all = [...perJob.values()];
    const detail = {
      checks: all.length,
      model_calls: all.reduce((n, j) => n + j.calls, 0),
      tokens_per_check_p95: percentile(all.map((j) => j.tokens), 95),
    };
    // A model call with no price cannot be counted as free: the budget is withheld until prices are decided (#17).
    if (all.some((j) => !j.priced)) {
      withhold("cost.model_cost_per_check_eur_p95", "EUR", "unpriced: app.model_calls.cost_eur is null until Bedrock EU prices are decided (#17, #83 Q2)", detail);
      return;
    }
    // No model call means nothing was priced, not that a check costs nothing: withheld until a run makes model calls.
    if (!detail.model_calls) {
      withhold("cost.model_cost_per_check_eur_p95", "EUR", "no model call in these checks (claims judgement off, or no claim rule released)", detail);
      return;
    }
    const p95 = percentile(all.map((j) => j.eur), 95)!;
    record({
      budget: "cost.model_cost_per_check_eur_p95",
      unit: "EUR",
      measured: p95,
      n: all.length,
      status: p95 <= budget("cost.model_cost_per_check_eur_p95") ? "met" : "exceeded",
      // Replayed responses (MODELS_MODE=replay) are recorded calls: their cost is what the recording cost.
      detail,
    });
  });
});
