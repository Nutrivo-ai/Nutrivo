// SQL on the local stack's database as postgres, for test setup only; the app never reaches the database this way.
import { spawnSync } from "node:child_process";

/**
 * True when `url` can only reach a database on this machine: its host is 127.0.0.1 or localhost, and no libpq
 * `host`/`hostaddr` parameter can point it elsewhere. Parsed, not pattern-matched, so a host hidden in a query string
 * or a password never passes (review on #343).
 */
export function isLocalDatabase(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) return false;
  if (u.searchParams.has("host") || u.searchParams.has("hostaddr")) return false;
  return u.hostname === "127.0.0.1" || u.hostname === "localhost";
}

/** Throws unless DATABASE_URL, when set, is the local stack's: test setup never writes to a hosted database. */
export function assertLocalDatabase(what: string) {
  const url = process.env.DATABASE_URL;
  if (url && !isLocalDatabase(url)) throw new Error(`${what} runs only against the local stack's database`);
}

/**
 * Runs SQL as postgres: psql on DATABASE_URL (scripts/ci/e2e.sh exports it), or inside the stack's container, as
 * supabase/seed/demo/load.sh does.
 */
export function sql(query: string) {
  const local = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  // Never a hosted database: the nightly runs these specs against staging with staging's DATABASE_URL in the
  // environment, and test setup must not write there as postgres (#85, CLAUDE.md 11).
  assertLocalDatabase("sql()");
  // No PGHOST, PGHOSTADDR or PGSERVICE from the environment: libpq would let them redirect the connection.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^PG(HOST|HOSTADDR|SERVICE|SERVICEFILE)$/.test(k)));
  const viaPsql = spawnSync("psql", [process.env.DATABASE_URL || local, "-v", "ON_ERROR_STOP=1", "-Atq", "-c", query], { encoding: "utf8", env });
  const run = viaPsql.error
    ? spawnSync("docker", ["exec", "-i", "supabase_db_nutrivo", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-Atq", "-c", query], { encoding: "utf8" })
    : viaPsql;
  if (run.error || run.status !== 0) throw new Error(`sql failed: ${run.error?.message ?? run.stderr}`);
  return run.stdout.trim();
}
