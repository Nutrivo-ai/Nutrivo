// D09 reads, under the person's own session. The latest release is read through public.coverage_snapshot(), the very
// function the public /coverage page calls (BE-10: the same table); a market pinned to an earlier ruleset reads
// ref.coverage_nodes at that version (every authenticated person may read ref). Products and their markets are
// app data, so RLS decides: a product in another workspace reads exactly like one that does not exist.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { nodeName, type Snapshot, type SnapshotRow } from "@/lib/public/coverage";
import { coverageRow, type CoverageRow, type GapRow } from "./model";

type Db = SupabaseClient<Database>;

export class CoverageReadError extends Error {
  constructor(what: string, cause: { message: string; code?: string }) {
    super(`could not read coverage (${what}): ${cause.code ?? "error"} ${cause.message}`);
    this.name = "CoverageReadError";
  }
}

function ok<T>(what: string, r: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (r.error) throw new CoverageReadError(what, r.error);
  return r.data as T;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NODE = /^[A-Z]{2,3}(-[A-Z0-9]{2,3})?$/;

async function snapshot(db: Db): Promise<Snapshot> {
  const data = ok("snapshot", await db.rpc("coverage_snapshot"));
  const s = (data ?? {}) as unknown as Partial<Snapshot>;
  return { ruleset_version: s.ruleset_version ?? null, nodes: s.nodes ?? [] };
}

async function rowsAt(db: Db, version: string, nodeIds: string[]): Promise<SnapshotRow[]> {
  if (!nodeIds.length) return [];
  const rows = ok(
    "coverage",
    await db
      .schema("ref")
      .from("coverage_nodes")
      .select("node_id, domain, state, rules_encoded, method, last_checked_at, gap_id")
      .eq("ruleset_version", version)
      .in("node_id", nodeIds),
  );
  return (rows ?? []) as SnapshotRow[];
}

async function gapsFor(db: Db, rows: SnapshotRow[]): Promise<Map<string, GapRow>> {
  const ids = [...new Set(rows.map((r) => r.gap_id).filter((g): g is string => !!g))];
  if (!ids.length) return new Map();
  const gaps = ok(
    "gaps",
    await db.schema("ref").from("coverage_gaps").select("gap_id, node_id, domain, reason_code, description, opened_in, closed_in").in("gap_id", ids),
  );
  return new Map((gaps ?? []).map((g) => [g.gap_id, g as GapRow]));
}

async function namesOf(db: Db, nodeIds: string[]): Promise<Map<string, string>> {
  if (!nodeIds.length) return new Map();
  const rows = ok("jurisdictions", await db.schema("ref").from("jurisdictions").select("id, name").in("id", nodeIds));
  return new Map((rows ?? []).map((j) => [j.id, j.name]));
}

export type LibraryCoverage =
  | { kind: "not-found" }
  | { kind: "loaded"; product: { id: string; name: string } | null; latest: string | null; rows: CoverageRow[] };

/** S-NV2-013: every node at the latest release, or (with a product) that product's markets at their pinned rulesets. */
export async function readLibraryCoverage(db: Db, workspaceId: string, productId: string | null): Promise<LibraryCoverage> {
  const snap = await snapshot(db);
  const latest = snap.ruleset_version;
  if (productId === null) {
    const ids = [...new Set(snap.nodes.map((r) => r.node_id))].sort();
    const [names, gaps] = await Promise.all([namesOf(db, ids), gapsFor(db, snap.nodes)]);
    const rows = ids.map((id) =>
      coverageRow({ nodeId: id, name: names.get(id) ?? nodeName(id), rulesetVersion: latest, pinned: false, rows: snap.nodes, gaps }),
    );
    return { kind: "loaded", product: null, latest, rows };
  }

  if (!UUID.test(workspaceId) || !UUID.test(productId)) return { kind: "not-found" };
  const app = db.schema("app");
  const product = ok("product", await app.from("products").select("id, name").eq("id", productId).eq("workspace_id", workspaceId).maybeSingle());
  if (!product) return { kind: "not-found" };
  const markets = ok("markets", await app.from("product_nodes").select("node_id, ruleset_version").eq("product_id", productId)) ?? [];
  const ids = markets.map((m) => m.node_id).sort();
  const versionOf = new Map(markets.map((m) => [m.node_id, m.ruleset_version ?? latest]));

  // Markets at the latest release come from the snapshot itself; any other pinned version is read at that version.
  const others = [...new Set(markets.map((m) => m.ruleset_version).filter((v): v is string => !!v && v !== latest))];
  const byVersion = new Map<string | null, SnapshotRow[]>([[latest, snap.nodes]]);
  await Promise.all(
    others.map(async (v) => byVersion.set(v, await rowsAt(db, v, markets.filter((m) => m.ruleset_version === v).map((m) => m.node_id)))),
  );
  const all = [...byVersion.values()].flat();
  const [names, gaps] = await Promise.all([namesOf(db, ids), gapsFor(db, all)]);
  const rows = ids.map((id) => {
    const version = versionOf.get(id) ?? null;
    return coverageRow({
      nodeId: id,
      name: names.get(id) ?? nodeName(id),
      rulesetVersion: version,
      pinned: markets.find((m) => m.node_id === id)?.ruleset_version != null,
      rows: byVersion.get(version) ?? [],
      gaps,
    });
  });
  return { kind: "loaded", product, latest, rows };
}

export type NodeCoveragePage =
  | { kind: "not-found" }
  | { kind: "loaded"; row: CoverageRow; latest: string | null };

/** S-NV2-021: one node at a ruleset (the latest release unless a pinned one is named). */
export async function readNodeCoverage(db: Db, nodeId: string, ruleset: string | null): Promise<NodeCoveragePage> {
  if (!NODE.test(nodeId)) return { kind: "not-found" };
  const snap = await snapshot(db);
  const latest = snap.ruleset_version;
  const version = ruleset ?? latest;
  const names = await namesOf(db, [nodeId]);
  if (!names.has(nodeId)) return { kind: "not-found" };
  let rows = snap.nodes;
  if (version !== latest && version !== null) {
    const exists = ok("ruleset", await db.schema("ref").from("ruleset_versions").select("id").eq("id", version).maybeSingle());
    if (!exists) return { kind: "not-found" };
    rows = await rowsAt(db, version, [nodeId]);
  }
  const gaps = await gapsFor(db, rows.filter((r) => r.node_id === nodeId));
  const row = coverageRow({ nodeId, name: names.get(nodeId)!, rulesetVersion: version, pinned: version !== latest, rows, gaps });
  return { kind: "loaded", row, latest };
}
