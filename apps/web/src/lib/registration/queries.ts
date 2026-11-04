// T-504: the reads behind S-NV2-008 Obligations and S-NV2-020 Registration pack, under the person's own session
// (RLS decides what any of them returns; never the service role). A failed read throws to the workspace error boundary.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { ShellReadError } from "@/lib/workspace/memberships";
import { eligibleObligations, type ObligationRow } from "./model";

type Client = SupabaseClient<Database>;

const OBLIGATION_COLUMNS =
  "id, node_id, kind, authority, legal_basis, route, evidence_list, fee, lead_time_days, renewal_cycle, submission_language, source_url, last_verified_at";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NODE = /^[A-Z]{2,3}(-[A-Z0-9]{2,3})?$/;

export type ObligationMarket = { nodeId: string; name: string; products: number; obligations: ObligationRow[] };

/** G01: the workspace's markets (its live products' nodes) and the eligible obligations held for each. */
export async function readObligations(db: Client, workspaceId: string): Promise<ObligationMarket[]> {
  const nodes = await db
    .schema("app")
    .from("product_nodes")
    .select("node_id, product_id, products!inner(stage)")
    .eq("workspace_id", workspaceId);
  if (nodes.error) throw new ShellReadError("markets", nodes.error);
  type NodeRow = { node_id: string; products: { stage: string } | null };
  const live = ((nodes.data ?? []) as unknown as NodeRow[]).filter((n) => n.products?.stage !== "discontinued");
  const counts = new Map<string, number>();
  for (const n of live) counts.set(n.node_id, (counts.get(n.node_id) ?? 0) + 1);
  const nodeIds = [...counts.keys()];
  if (!nodeIds.length) return [];

  const ref = db.schema("ref");
  const [names, obligations] = await Promise.all([
    ref.from("jurisdictions").select("id, name").in("id", nodeIds),
    ref.from("obligations").select(OBLIGATION_COLUMNS).in("node_id", nodeIds),
  ]);
  if (names.error) throw new ShellReadError("markets", names.error);
  if (obligations.error) throw new ShellReadError("obligations", obligations.error);
  const nameOf = new Map((names.data ?? []).map((j) => [j.id, j.name]));
  const eligible = eligibleObligations((obligations.data ?? []) as ObligationRow[]);

  // Markets in order of how many of the viewer's products are sold there, then by id (as Documents orders them).
  return nodeIds
    .sort((a, b) => counts.get(b)! - counts.get(a)! || (a < b ? -1 : 1))
    .map((id) => ({ nodeId: id, name: nameOf.get(id) ?? id, products: counts.get(id)!, obligations: eligible.filter((o) => o.node_id === id) }));
}

export type RecordedRegistration = {
  id: string;
  number: string | null;
  registeredOn: string | null;
  expiresAt: string | null;
  evidenceDocType: string | null;
  createdAt: string;
};

export type EvidenceDocument = { id: string; docType: string; fileName: string };

export type RegistrationPage =
  | { kind: "not-found" }
  | {
      kind: "loaded";
      product: { id: string; name: string };
      market: { nodeId: string; name: string };
      displayState: string | null;
      registrationState: string;
      latest: RecordedRegistration | null;
      obligation: ObligationRow | null;
      documents: EvidenceDocument[];
    };

/** G02, G03: one product in one market: its states, the latest recorded registration and the documents to cite. */
export async function readRegistrationPage(db: Client, workspaceId: string, productId: string, nodeId: string): Promise<RegistrationPage> {
  if (!UUID.test(workspaceId) || !UUID.test(productId) || !NODE.test(nodeId)) return { kind: "not-found" };
  const app = db.schema("app");
  const ref = db.schema("ref");
  const [product, node, jurisdiction] = await Promise.all([
    app.from("products").select("id, name").eq("id", productId).eq("workspace_id", workspaceId).maybeSingle(),
    app.from("product_nodes").select("display_state, registration_state").eq("product_id", productId).eq("node_id", nodeId).maybeSingle(),
    ref.from("jurisdictions").select("id, name").eq("id", nodeId).maybeSingle(),
  ]);
  if (product.error) throw new ShellReadError("the product", product.error);
  if (node.error) throw new ShellReadError("the market", node.error);
  if (jurisdiction.error) throw new ShellReadError("the market", jurisdiction.error);
  if (!product.data || !node.data || !jurisdiction.data) return { kind: "not-found" };

  const [latest, obligations, docs] = await Promise.all([
    app
      .from("registrations")
      .select("id, number, registered_on, expires_at, evidence_doc_id, created_at")
      .eq("product_id", productId)
      .eq("node_id", nodeId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle(),
    ref.from("obligations").select(OBLIGATION_COLUMNS).eq("node_id", nodeId),
    app.from("supplier_documents").select("id, doc_type, storage_path, scan_status, product_id").eq("workspace_id", workspaceId),
  ]);
  if (latest.error) throw new ShellReadError("registrations", latest.error);
  if (obligations.error) throw new ShellReadError("obligations", obligations.error);
  if (docs.error) throw new ShellReadError("documents", docs.error);

  // Only a clean document can be cited, and only one of this product or the workspace's own (as Documents counts them).
  const documents = (docs.data ?? [])
    .filter((d) => d.scan_status === "clean" && (d.product_id === null || d.product_id === productId))
    .map((d) => ({ id: d.id, docType: d.doc_type, fileName: d.storage_path.split("/").filter(Boolean).pop() ?? d.storage_path }))
    .sort((a, b) => a.fileName.localeCompare(b.fileName, "en") || (a.id < b.id ? -1 : 1));

  const r = latest.data;
  let evidenceDocType: string | null = null;
  if (r?.evidence_doc_id) {
    const doc = (docs.data ?? []).find((d) => d.id === r.evidence_doc_id);
    evidenceDocType = doc?.doc_type ?? null;
  }

  return {
    kind: "loaded",
    product: product.data,
    market: { nodeId, name: jurisdiction.data.name },
    displayState: node.data.display_state,
    registrationState: node.data.registration_state,
    latest: r
      ? { id: r.id, number: r.number, registeredOn: r.registered_on, expiresAt: r.expires_at, evidenceDocType, createdAt: r.created_at }
      : null,
    obligation: eligibleObligations((obligations.data ?? []) as ObligationRow[])[0] ?? null,
    documents,
  };
}

/** Each market's registration coverage gap (seeded not_encoded for every market), for the not-assessed link. */
export async function readRegistrationGaps(db: Client, workspaceId: string, nodeIds: string[]): Promise<Map<string, { gapId: string; href: string }>> {
  const gaps = new Map<string, { gapId: string; href: string }>();
  if (!nodeIds.length) return gaps;
  const { data, error } = await db.schema("ref").from("coverage_gaps").select("gap_id, node_id").eq("domain", "registration").in("node_id", nodeIds);
  if (error) throw new ShellReadError("coverage gaps", error);
  for (const g of [...(data ?? [])].sort((a, b) => (a.gap_id < b.gap_id ? -1 : 1))) {
    if (!gaps.has(g.node_id)) {
      gaps.set(g.node_id, {
        gapId: g.gap_id,
        href: `/w/${workspaceId}/library/coverage/${encodeURIComponent(g.node_id)}#${encodeURIComponent(g.gap_id)}`,
      });
    }
  }
  return gaps;
}
