// S-NV2-010 Documents (T-801; H01). The workspace's documents (app.supplier_documents) read under the member's session
// and set against ref.document_requirements per market. Nothing here writes: documents are insert-only (BE-05) and
// arrive through T-802's upload path.
//
// No rule, no verdict, applied to documents: a market whose requirements are not encoded states that, never a count
// or "complete". The conservative choices below are the ones put to the founders on issue #68 (questions 1 to 7):
//   1. a market with no requirement rows reads not_encoded;
//   2. only requirements for product_class 'pet_food' (the column's default: all pet food) are matched; any other
//      class is counted as not assessed, never as met;
//   3. a document's title is its stored file name (no display name is stored yet);
//   4. the design's impact column has no source and is left out;
//   5. only scan_status 'clean' counts towards a requirement (DB-14 open); every row is one document;
//   6. the markets are the distinct nodes of the products the viewer can see;
//   7. expired before today, expiring within 60 days (H04's first notice), current otherwise, or no expiry date.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { ShellReadError } from "@/lib/workspace/memberships";

type Client = SupabaseClient<Database>;

export const EXPIRING_WITHIN_DAYS = 60;
export const ALL_PET_FOOD = "pet_food";

export type DocumentRow = {
  id: string;
  docType: string;
  storagePath: string;
  validTo: string | null;
  scanStatus: string;
  supplierName: string | null;
  createdAt: string;
};

export type RequirementRow = { nodeId: string; productClass: string; docType: string };
export type MarketRow = { nodeId: string; name: string };

export type Expiry =
  | { kind: "expired"; on: string }
  | { kind: "expiring"; on: string; days: number }
  | { kind: "current"; on: string }
  | { kind: "no_expiry" };

export type LibraryDocument = {
  id: string;
  title: string;
  typeLabel: string;
  supplier: string | null;
  scanStatus: "clean" | "quarantine" | "rejected" | string;
  expiry: Expiry;
};

export type MarketCard =
  | { nodeId: string; name: string; kind: "not_encoded" }
  | {
      nodeId: string;
      name: string;
      kind: "assessed";
      /** Requirements a clean, unexpired document of the same type meets. */
      met: number;
      /** Requirements this screen can match (product_class 'pet_food'). */
      total: number;
      /** Type labels of the matchable requirements that are not met. */
      outstanding: string[];
      /** Requirements for another product class: neither met nor outstanding, not assessed (question 2 on #68). */
      notAssessed: number;
    };

export type Library = { markets: MarketCard[]; documents: LibraryDocument[]; expiringOrExpired: number };

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** "3 JUN" as the design writes it; the year is added when it is not today's. */
export function formatDay(iso: string, today: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const year = iso.slice(0, 4) === today.slice(0, 4) ? "" : ` ${y}`;
  return `${d} ${MONTHS[m - 1]}${year}`;
}

/** "certificate_of_analysis" reads "Certificate of analysis". A plain label of the stored key, nothing more. */
export function typeLabel(docType: string): string {
  const words = docType.replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : docType;
}

/** The last segment of the storage path: the file the member or supplier uploaded. */
export function fileName(storagePath: string): string {
  const parts = storagePath.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : storagePath;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}

export function expiryOf(validTo: string | null, today: string): Expiry {
  if (!validTo) return { kind: "no_expiry" };
  const days = daysBetween(today, validTo);
  if (days < 0) return { kind: "expired", on: validTo };
  if (days <= EXPIRING_WITHIN_DAYS) return { kind: "expiring", on: validTo, days };
  return { kind: "current", on: validTo };
}

const EXPIRY_ORDER: Record<Expiry["kind"], number> = { expired: 0, expiring: 1, current: 2, no_expiry: 3 };

/** A document counts towards a requirement only when it is clean and not expired (question 5 on #68). */
function counts(d: DocumentRow, today: string): boolean {
  return d.scanStatus === "clean" && expiryOf(d.validTo, today).kind !== "expired";
}

export function buildLibrary(input: {
  documents: DocumentRow[];
  requirements: RequirementRow[];
  markets: MarketRow[];
  today: string;
}): Library {
  const { documents, requirements, markets, today } = input;
  const usable = new Set(documents.filter((d) => counts(d, today)).map((d) => d.docType));

  const cards: MarketCard[] = markets.map((m) => {
    const own = requirements.filter((r) => r.nodeId === m.nodeId);
    if (own.length === 0) return { nodeId: m.nodeId, name: m.name, kind: "not_encoded" };
    const matchable = own.filter((r) => r.productClass === ALL_PET_FOOD);
    const outstanding = matchable.filter((r) => !usable.has(r.docType)).map((r) => typeLabel(r.docType));
    return {
      nodeId: m.nodeId,
      name: m.name,
      kind: "assessed",
      met: matchable.length - outstanding.length,
      total: matchable.length,
      outstanding,
      notAssessed: own.length - matchable.length,
    };
  });

  const created = new Map(documents.map((d) => [d.id, d.createdAt]));
  const docs: LibraryDocument[] = documents
    .map((d) => ({
      id: d.id,
      title: fileName(d.storagePath),
      typeLabel: typeLabel(d.docType),
      supplier: d.supplierName,
      scanStatus: d.scanStatus,
      expiry: expiryOf(d.validTo, today),
    }))
    .sort((a, b) => {
      const k = EXPIRY_ORDER[a.expiry.kind] - EXPIRY_ORDER[b.expiry.kind];
      if (k !== 0) return k;
      const ao = "on" in a.expiry ? a.expiry.on : "";
      const bo = "on" in b.expiry ? b.expiry.on : "";
      if (ao !== bo) return ao < bo ? -1 : 1;
      const ac = created.get(a.id)!, bc = created.get(b.id)!;
      return ac < bc ? 1 : ac > bc ? -1 : a.id < b.id ? -1 : 1;
    });

  return {
    markets: cards,
    documents: docs,
    expiringOrExpired: docs.filter((d) => d.expiry.kind === "expired" || d.expiry.kind === "expiring").length,
  };
}

/**
 * H03 (T-802): a supplier upload is scanned and its result is a NEW row (promoted_from = the quarantine row), so the
 * quarantine row stays as history (insert-only). The library lists each document once: by its latest row.
 */
export function withoutSuperseded<T extends { id: string; promoted_from: string | null }>(rows: T[]): T[] {
  const superseded = new Set(rows.map((r) => r.promoted_from).filter((p): p is string => p !== null));
  return rows.filter((r) => !superseded.has(r.id));
}

/** Today's date (UTC) as YYYY-MM-DD. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Reads everything the screen shows, under RLS; a failed read throws to the workspace error boundary. */
export async function readLibrary(db: Client, workspaceId: string, today: string = todayUtc()): Promise<Library> {
  const app = db.schema("app");
  const [docs, nodes] = await Promise.all([
    app
      .from("supplier_documents")
      .select("id, doc_type, storage_path, valid_to, scan_status, created_at, product_id, promoted_from, suppliers(name)")
      .eq("workspace_id", workspaceId),
    app.from("product_nodes").select("node_id, product_id, products!inner(stage)").eq("workspace_id", workspaceId),
  ]);
  if (docs.error) throw new ShellReadError("documents", docs.error);
  if (nodes.error) throw new ShellReadError("markets", nodes.error);

  type DocRow = {
    id: string;
    doc_type: string;
    storage_path: string;
    valid_to: string | null;
    scan_status: string;
    created_at: string;
    product_id: string | null;
    promoted_from: string | null;
    suppliers: { name: string } | null;
  };
  const rows = withoutSuperseded((docs.data ?? []) as unknown as DocRow[]);
  type NodeRow = { node_id: string; product_id: string; products: { stage: string } | null };
  const live = ((nodes.data ?? []) as unknown as NodeRow[]).filter((n) => n.products?.stage !== "discontinued");

  // A product document shows only when the viewer can see its product (their scope), as product_nodes already is.
  const productIds = [...new Set(rows.map((r) => r.product_id).filter((p): p is string => p !== null))];
  const visible = new Set<string>();
  if (productIds.length) {
    const seen = await app.from("products").select("id").in("id", productIds);
    if (seen.error) throw new ShellReadError("products", seen.error);
    for (const p of seen.data ?? []) visible.add(p.id);
  }

  const nodeIds = [...new Set(live.map((n) => n.node_id))];
  const ref = db.schema("ref");
  const [names, reqs] = await Promise.all([
    nodeIds.length ? ref.from("jurisdictions").select("id, name").in("id", nodeIds) : Promise.resolve({ data: [], error: null }),
    nodeIds.length
      ? ref.from("document_requirements").select("node_id, product_class, doc_type").in("node_id", nodeIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (names.error) throw new ShellReadError("markets", names.error);
  if (reqs.error) throw new ShellReadError("document requirements", reqs.error);
  const nameOf = new Map((names.data ?? []).map((j) => [j.id, j.name]));

  // Markets in order of how many of the viewer's products are sold there, then by id.
  const products = new Map<string, number>();
  for (const n of live) products.set(n.node_id, (products.get(n.node_id) ?? 0) + 1);
  const markets = nodeIds
    .sort((a, b) => (products.get(b)! - products.get(a)!) || (a < b ? -1 : 1))
    .map((id) => ({ nodeId: id, name: nameOf.get(id) ?? id }));

  return buildLibrary({
    today,
    markets,
    requirements: (reqs.data ?? []).map((r) => ({ nodeId: r.node_id, productClass: r.product_class, docType: r.doc_type })),
    documents: rows
      .filter((r) => r.product_id === null || visible.has(r.product_id))
      .map((r) => ({
        id: r.id,
        docType: r.doc_type,
        storagePath: r.storage_path,
        validTo: r.valid_to,
        scanStatus: r.scan_status,
        supplierName: r.suppliers?.name ?? null,
        createdAt: r.created_at,
      })),
  });
}
