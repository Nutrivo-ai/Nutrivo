// S-NV2-014 Suppliers (T-802; H02). The workspace's suppliers and their document requests, read under the member's
// session (RLS), and what the request form may offer. Nothing here writes: a request is made by app.request_document
// (actions.ts). The design's "Materials supplied", "Specs current" and "Portal" columns have no source and are left
// out (#69 question 2); the screen shows each supplier's address, documents received against requested, and the state
// of its latest request.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { ShellReadError } from "@/lib/workspace/memberships";

type Client = SupabaseClient<Database>;

/** Where a request stands, from its own row, its upload's scan result and its email job. */
export type RequestState = "sending" | "email_failed" | "sent" | "expired" | "scanning" | "received" | "rejected";

export const REQUEST_STATE_LABEL: Record<RequestState, string> = {
  sending: "Sending",
  email_failed: "Email not sent",
  sent: "Awaiting upload",
  expired: "Link expired",
  scanning: "Uploaded · scanning",
  received: "Received",
  rejected: "Rejected by scan",
};

export type RequestRow = {
  id: string;
  supplierId: string;
  title: string | null;
  docType: string;
  createdAt: string;
  expiresAt: string;
  issued: boolean;          // the worker stored the link's hash, i.e. the email went out
  consumedAt: string | null;
  fulfilledAt: string | null;
};

export type SupplierRow = {
  id: string;
  name: string;
  email: string | null;
  requested: number;
  received: number;
  latest: { title: string; state: RequestState } | null;
};

export type SupplierScreen = {
  suppliers: SupplierRow[];
  openRequests: number;
  docTypes: string[];
  products: { id: string; name: string }[];
};

export function requestState(
  r: RequestRow,
  { rejected, emailFailed, now }: { rejected: boolean; emailFailed: boolean; now: number },
): RequestState {
  if (r.fulfilledAt) return "received";
  if (r.consumedAt) return rejected ? "rejected" : "scanning";
  if (Date.parse(r.expiresAt) <= now) return "expired";
  if (!r.issued) return emailFailed ? "email_failed" : "sending";
  return "sent";
}

const OPEN: RequestState[] = ["sending", "sent", "scanning"];

export function buildSuppliers(input: {
  suppliers: { id: string; name: string; email: string | null }[];
  requests: RequestRow[];
  rejectedRequests: Set<string>;
  failedEmails: Set<string>;
  now: number;
}): { suppliers: SupplierRow[]; openRequests: number } {
  const bySupplier = new Map<string, { r: RequestRow; state: RequestState }[]>();
  for (const r of input.requests) {
    const state = requestState(r, { rejected: input.rejectedRequests.has(r.id), emailFailed: input.failedEmails.has(r.id), now: input.now });
    bySupplier.set(r.supplierId, [...(bySupplier.get(r.supplierId) ?? []), { r, state }]);
  }
  let openRequests = 0;
  const suppliers = input.suppliers.map((s) => {
    const own = (bySupplier.get(s.id) ?? []).sort((a, b) => (a.r.createdAt < b.r.createdAt ? 1 : a.r.createdAt > b.r.createdAt ? -1 : 0));
    openRequests += own.filter((x) => OPEN.includes(x.state)).length;
    const latest = own[0];
    return {
      id: s.id,
      name: s.name,
      email: s.email,
      requested: own.length,
      received: own.filter((x) => x.state === "received").length,
      latest: latest ? { title: latest.r.title ?? latest.r.docType, state: latest.state } : null,
    };
  });
  suppliers.sort((a, b) => a.name.localeCompare(b.name, "en") || (a.id < b.id ? -1 : 1));
  return { suppliers, openRequests };
}

/** Reads everything the screen shows, under RLS; a failed read throws to the workspace error boundary. */
export async function readSuppliers(db: Client, workspaceId: string, now: number = Date.now()): Promise<SupplierScreen> {
  const app = db.schema("app");
  const [suppliers, requests, results, jobs, types, products] = await Promise.all([
    app.from("suppliers").select("id, name, email").eq("workspace_id", workspaceId),
    app
      .from("document_requests")
      .select("id, supplier_id, title, doc_type, created_at, expires_at, token_hash, consumed_at, fulfilled_at")
      .eq("workspace_id", workspaceId),
    app.from("supplier_documents").select("request_id, scan_status").eq("workspace_id", workspaceId).not("promoted_from", "is", null),
    app.from("jobs").select("idempotency_key, status").eq("workspace_id", workspaceId).eq("kind", "notify").like("idempotency_key", "docreq:%"),
    db.schema("ref").from("document_requirements").select("doc_type"),
    app.from("products").select("id, name").eq("workspace_id", workspaceId).order("name"),
  ]);
  if (suppliers.error) throw new ShellReadError("suppliers", suppliers.error);
  if (requests.error) throw new ShellReadError("document requests", requests.error);
  if (results.error) throw new ShellReadError("documents", results.error);
  if (jobs.error) throw new ShellReadError("jobs", jobs.error);
  if (types.error) throw new ShellReadError("document requirements", types.error);
  if (products.error) throw new ShellReadError("products", products.error);

  const rejectedRequests = new Set(
    (results.data ?? []).filter((d) => d.scan_status === "rejected" && d.request_id).map((d) => d.request_id as string),
  );
  const failedEmails = new Set(
    (jobs.data ?? []).filter((j) => j.status === "failed").map((j) => j.idempotency_key.slice("docreq:".length)),
  );
  const built = buildSuppliers({
    suppliers: (suppliers.data ?? []).map((s) => ({ id: s.id, name: s.name, email: (s.email as string | null) ?? null })),
    requests: (requests.data ?? []).map((r) => ({
      id: r.id,
      supplierId: r.supplier_id,
      title: r.title,
      docType: r.doc_type,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      issued: r.token_hash !== null,
      consumedAt: r.consumed_at,
      fulfilledAt: r.fulfilled_at,
    })),
    rejectedRequests,
    failedEmails,
    now,
  });
  return {
    ...built,
    docTypes: [...new Set((types.data ?? []).map((t) => t.doc_type))].sort(),
    products: (products.data ?? []).map((p) => ({ id: p.id, name: p.name })),
  };
}
