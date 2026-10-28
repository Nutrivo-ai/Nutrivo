// T-205: what the /admin screens read, as the service role after the staff check (./server.ts). Reads only. A failed
// read throws AdminReadError, which the admin error boundary shows and Sentry records with the code only.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { AdminReadError } from "./server";
import { extraction, type DraftMember, type Extraction, type FixtureRun } from "./model";
import { DOMAINS } from "./staff";

export { releaseBlockers, type DraftMember, type Extraction, type FixtureRun } from "./model";

type Db = SupabaseClient<Database>;

function must<T>(what: string, result: { data: T | null; error: { code?: string; message?: string } | null }): T {
  if (result.error) throw new AdminReadError(what, result.error);
  return result.data as T;
}

export type SourceFacts = {
  title: string;
  celex: string | null;
  language: string | null;
  kind: string;
  retrievedAt: string | null;
  /** Kind eurlex with a sha256 and a storage path: a stored official text (T-201). */
  storedOfficial: boolean;
};

type SourceRow = {
  title: string;
  celex: string | null;
  language: string | null;
  kind: string;
  retrieved_at: string | null;
  sha256: string | null;
  storage_path: string | null;
};
const SOURCE = "title, celex, language, kind, retrieved_at, sha256, storage_path";

function source(row: SourceRow | SourceRow[] | null): SourceFacts | null {
  const s = Array.isArray(row) ? row[0] : row;
  if (!s) return null;
  return {
    title: s.title,
    celex: s.celex,
    language: s.language,
    kind: s.kind,
    retrievedAt: s.retrieved_at,
    storedOfficial: s.kind === "eurlex" && Boolean(s.sha256) && Boolean(s.storage_path),
  };
}

// ─── K03 · term register ──────────────────────────────────────────────────────────────────────────
export type TermCandidate = {
  id: string;
  termKey: string;
  language: string;
  term: string;
  kind: string;
  articleRef: string;
  rulesetVersion: string | null;
  createdAt: string;
  source: SourceFacts | null;
  /** The English entry of the same term key, shown for reference only: it never produces this string (BE-11). */
  englishReference: string | null;
};

export async function readTermQueue(db: Db): Promise<TermCandidate[]> {
  const rows = must(
    "term candidates",
    await db
      .schema("ref")
      .from("term_entries")
      .select(`id, term_key, language, term, kind, article_ref, ruleset_version, created_at, source:sources(${SOURCE})`)
      .eq("status", "candidate")
      .order("created_at")
      .order("id")
      .limit(500),
  );
  const keys = [...new Set(rows.map((r) => r.term_key))];
  const english = keys.length
    ? must(
        "English reference terms",
        await db
          .schema("ref")
          .from("term_entries")
          .select("term_key, term, status")
          .in("term_key", keys)
          .eq("language", "en")
          .neq("status", "rejected")
          .order("created_at", { ascending: false }),
      )
    : [];
  const reference = new Map<string, string>();
  for (const e of english) if (!reference.has(e.term_key)) reference.set(e.term_key, e.term);
  return rows.map((r) => ({
    id: r.id,
    termKey: r.term_key,
    language: r.language,
    term: r.term,
    kind: r.kind,
    articleRef: r.article_ref,
    rulesetVersion: r.ruleset_version,
    createdAt: r.created_at,
    source: source(r.source as SourceRow | SourceRow[] | null),
    englishReference: r.language === "en" ? null : (reference.get(r.term_key) ?? null),
  }));
}

// ─── K01/K02 → J02 · rule candidates ──────────────────────────────────────────────────────────────
export type RuleCandidate = {
  id: string;
  ruleKey: string | null;
  article: string;
  decision: string;
  agree: boolean | null;
  createdAt: string;
  source: SourceFacts | null;
  first: Extraction | null;
  second: Extraction | null;
  /** The rule already exists: shape, domain and node are kept and not asked for. */
  existingRule: { shape: string; domain: string; nodeId: string; title: string } | null;
};

export async function readRuleQueue(db: Db): Promise<RuleCandidate[]> {
  const rows = must(
    "rule candidates",
    await db
      .schema("ref")
      .from("rule_candidates")
      .select(`id, article, proposed_rule_key, first_value, second_value, agree, decision, created_at, source:sources(${SOURCE})`)
      .in("decision", ["pending", "needs_review"])
      .order("created_at")
      .order("id")
      .limit(500),
  );
  const keys = [...new Set(rows.map((r) => r.proposed_rule_key).filter((k): k is string => Boolean(k)))];
  const rules = keys.length
    ? must("rules", await db.schema("ref").from("rules").select("rule_key, shape, domain, node_id, title").in("rule_key", keys))
    : [];
  const byKey = new Map(rules.map((r) => [r.rule_key, r]));
  return rows.map((r) => {
    const rule = r.proposed_rule_key ? byKey.get(r.proposed_rule_key) : undefined;
    return {
      id: r.id,
      ruleKey: r.proposed_rule_key,
      article: r.article,
      decision: r.decision,
      agree: r.agree,
      createdAt: r.created_at,
      source: source(r.source as SourceRow | SourceRow[] | null),
      first: extraction(r.first_value),
      second: extraction(r.second_value),
      existingRule: rule ? { shape: rule.shape, domain: rule.domain, nodeId: rule.node_id, title: rule.title } : null,
    };
  });
}

export type Jurisdiction = { id: string; name: string; nodeType: string; parentId: string | null };

export async function readJurisdictions(db: Db): Promise<Jurisdiction[]> {
  const rows = must(
    "jurisdictions",
    await db.schema("ref").from("jurisdictions").select("id, name, node_type, parent_id").order("id"),
  );
  return rows.map((j) => ({ id: j.id, name: j.name, nodeType: j.node_type, parentId: j.parent_id }));
}

// ─── K04/K05 · drafts, coverage, gaps and the release gate ────────────────────────────────────────
export type Draft = { id: string; basedOn: string | null; notes: string; createdAt: string; released: boolean };

export async function readDrafts(db: Db): Promise<{ drafts: Draft[]; latestRelease: string | null }> {
  const [drafts, releases] = await Promise.all([
    db.schema("ref").from("ruleset_drafts").select("id, based_on, notes, created_at").order("created_at", { ascending: false }),
    db.schema("ref").from("ruleset_versions").select("id, released_at").order("released_at", { ascending: false }).order("id", { ascending: false }),
  ]);
  const released = new Set(must("ruleset versions", releases).map((r) => r.id));
  return {
    drafts: must("ruleset drafts", drafts).map((d) => ({
      id: d.id,
      basedOn: d.based_on,
      notes: d.notes,
      createdAt: d.created_at,
      released: released.has(d.id),
    })),
    latestRelease: must("ruleset versions", releases)[0]?.id ?? null,
  };
}

export type CoverageRow = {
  nodeId: string;
  domain: string;
  state: string;
  method: string;
  lastCheckedAt: string | null;
  gapId: string | null;
};

export type Gap = { gapId: string; nodeId: string; domain: string; reasonCode: string; description: string; openedIn: string | null };

export type DraftDetail = {
  members: DraftMember[];
  /** Accepted rule versions a person can put in the draft. */
  accepted: { ruleKey: string; version: number; title: string }[];
  coverage: CoverageRow[];
  gaps: Gap[];
  latestRun: FixtureRun | null;
  /** Fixtures the run must judge: every fixture of every member (private.ruleset_draft_fixture_count). */
  fixturesExpected: number;
};

export async function readDraft(db: Db, draftId: string): Promise<DraftDetail> {
  const ref = db.schema("ref");
  const [members, coverage, runs, accepted] = await Promise.all([
    ref.from("ruleset_draft_members").select("rule_key, version").eq("draft_id", draftId).order("rule_key"),
    ref
      .from("ruleset_draft_coverage")
      .select("node_id, domain, state, method, last_checked_at, gap_id")
      .eq("draft_id", draftId)
      .order("node_id")
      .limit(2000),
    ref
      .from("fixture_runs")
      .select("id, passed, rule_fixtures_ran, runner, ran_at")
      .eq("draft_id", draftId)
      .order("seq", { ascending: false })
      .limit(1),
    ref.from("rule_versions").select("rule_key, version, rules(title)").eq("status", "accepted").order("rule_key").order("version").limit(1000),
  ]);
  const memberRows = must("draft members", members);
  const keys = memberRows.map((m) => m.rule_key);
  const [rules, fixtures, gaps] = await Promise.all([
    keys.length ? ref.from("rules").select("rule_key, title, domain, node_id").in("rule_key", keys) : Promise.resolve({ data: [], error: null }),
    keys.length ? ref.from("rule_fixtures").select("rule_key, version, expected_outcome").in("rule_key", keys) : Promise.resolve({ data: [], error: null }),
    ref.from("coverage_gaps").select("gap_id, node_id, domain, reason_code, description, opened_in").is("closed_in", null).order("gap_id").limit(2000),
  ]);
  const ruleBy = new Map(must("rules", rules).map((r) => [r.rule_key, r]));
  const fixtureRows = must("rule fixtures", fixtures);
  const run = must("fixture runs", runs)[0];
  const memberList = memberRows.map((m) => {
    const own = fixtureRows.filter((f) => f.rule_key === m.rule_key && f.version === m.version);
    const rule = ruleBy.get(m.rule_key);
    return {
      ruleKey: m.rule_key,
      version: m.version,
      title: rule?.title ?? null,
      domain: rule?.domain ?? null,
      nodeId: rule?.node_id ?? null,
      fixtureOutcomes: [...new Set(own.map((f) => f.expected_outcome))].sort(),
      fixtures: own.length,
    };
  });
  return {
    members: memberList,
    accepted: must("accepted rule versions", accepted).map((v) => {
      const rule = Array.isArray(v.rules) ? v.rules[0] : v.rules;
      return { ruleKey: v.rule_key, version: v.version, title: (rule as { title?: string } | null)?.title ?? v.rule_key };
    }),
    coverage: must("draft coverage", coverage).map((c) => ({
      nodeId: c.node_id,
      domain: c.domain,
      state: c.state,
      method: c.method,
      lastCheckedAt: c.last_checked_at,
      gapId: c.gap_id,
    })),
    gaps: must("coverage gaps", gaps).map((g) => ({
      gapId: g.gap_id,
      nodeId: g.node_id,
      domain: g.domain,
      reasonCode: g.reason_code,
      description: g.description,
      openedIn: g.opened_in,
    })),
    latestRun: run ? { id: run.id, passed: run.passed, ruleFixturesRan: run.rule_fixtures_ran, runner: run.runner, ranAt: run.ran_at } : null,
    fixturesExpected: memberList.reduce((n, m) => n + m.fixtures, 0),
  };
}

export const domainOrder = (d: string) => (DOMAINS as readonly string[]).indexOf(d);

// ─── Glossary (BE-11: authored definitions, per release, returned verbatim) ───────────────────────
export async function readGlossary(db: Db, rulesetVersion: string) {
  return must(
    "glossary",
    await db.schema("ref").from("glossary_entries").select("key, definition").eq("ruleset_version", rulesetVersion).order("key"),
  );
}
