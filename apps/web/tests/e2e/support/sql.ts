// SQL on the local stack's database as postgres, for test setup only; the app never reaches the database this way.
import { spawnSync } from "node:child_process";

/**
 * Runs SQL as postgres: psql on DATABASE_URL (scripts/ci/e2e.sh exports it), or inside the stack's container, as
 * supabase/seed/demo/load.sh does.
 */
export function sql(query: string) {
  const local = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  // Never a hosted database: the nightly runs these specs against staging with staging's DATABASE_URL in the
  // environment, and test setup must not write there as postgres (#85, CLAUDE.md 11).
  if (process.env.DATABASE_URL && !/@(127\.0\.0\.1|localhost)(:\d+)?\//.test(process.env.DATABASE_URL)) {
    throw new Error("sql() runs only against the local stack's database");
  }
  const viaPsql = spawnSync("psql", [process.env.DATABASE_URL || local, "-v", "ON_ERROR_STOP=1", "-Atq", "-c", query], { encoding: "utf8" });
  const run = viaPsql.error
    ? spawnSync("docker", ["exec", "-i", "supabase_db_nutrivo", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-Atq", "-c", query], { encoding: "utf8" })
    : viaPsql;
  if (run.error || run.status !== 0) throw new Error(`sql failed: ${run.error?.message ?? run.stderr}`);
  return run.stdout.trim();
}
