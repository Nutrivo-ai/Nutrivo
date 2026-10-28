// T-205: the pure parts of the /admin reads (no database, no environment), so they are unit-tested without a stack.
import type { Json } from "@/lib/database.types";

export type Extraction = {
  verified: boolean;
  found: boolean;
  articleRef: string | null;
  excerpt: string | null;
  params: Json | null;
  /** Can be accepted: a verified finding with params, article and excerpt (what app.accept_candidate checks). */
  acceptable: boolean;
};

export function extraction(value: Json | null): Extraction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const x = (value as Record<string, Json>).extraction;
  const e = x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, Json>) : {};
  const verified = (value as Record<string, Json>).verified === true;
  const found = e.found === true;
  const articleRef = typeof e.article_ref === "string" ? e.article_ref : null;
  const excerpt = typeof e.excerpt === "string" ? e.excerpt : null;
  const params = e.params ?? null;
  const isObject = params !== null && typeof params === "object" && !Array.isArray(params);
  return { verified, found, articleRef, excerpt, params, acceptable: verified && found && !!articleRef && !!excerpt && isObject };
}

export type DraftMember = {
  ruleKey: string;
  version: number;
  title: string | null;
  domain: string | null;
  nodeId: string | null;
  /** The outcomes the version's fixtures cover; tested means passed, failed and withheld (docs/12). */
  fixtureOutcomes: string[];
  fixtures: number;
};

export type FixtureRun = { id: string; passed: boolean; ruleFixturesRan: number; runner: string; ranAt: string };

/** What blocks a release, as far as the screen can tell before asking app.release_ruleset (which decides). */
export function releaseBlockers(detail: { members: DraftMember[]; latestRun: FixtureRun | null; fixturesExpected: number }): string[] {
  const out: string[] = [];
  if (detail.members.length === 0) out.push("The draft has no member rules, so no fixture can pass.");
  const untested = detail.members.filter((m) => !["failed", "passed", "withheld"].every((o) => m.fixtureOutcomes.includes(o)));
  if (untested.length) {
    out.push(`Fixtures for passed, failed and withheld are missing for ${untested.map((m) => `${m.ruleKey} v${m.version}`).join(", ")}.`);
  }
  if (!detail.latestRun) out.push("No fixture run is recorded for this draft. The fixture runner records it (T-206).");
  else if (!detail.latestRun.passed) out.push("The latest fixture run did not pass.");
  else if (detail.latestRun.ruleFixturesRan !== detail.fixturesExpected) {
    out.push(`The latest fixture run judged ${detail.latestRun.ruleFixturesRan} of ${detail.fixturesExpected} fixtures.`);
  }
  return out;
}
