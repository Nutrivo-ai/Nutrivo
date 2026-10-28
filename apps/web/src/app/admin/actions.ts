"use server";

// T-205: every /admin change is one of the T-204 staff RPCs, called under the person's own session, so the database
// checks staff (private.require_staff), stamps the person as the decider and audits it. Nothing here uses the service
// role or writes a table directly, and nothing sets 'accepted' except the person's click on app.accept_candidate or
// app.decide_term. A refusal comes back with the database's reason; anything else goes to Sentry with its code only.
import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import type { Database, Json } from "@/lib/database.types";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/observability/request-id";
import { createClient } from "@/lib/supabase/server";
import { staffGate } from "@/lib/admin/server";
import { refusal, type ActionResult, type RpcFailure } from "@/lib/admin/staff";

type Call = (db: Awaited<ReturnType<typeof createClient>>) => PromiseLike<{ data: unknown; error: RpcFailure | null }>;

async function run<T>(name: string, call: Call, paths: string[]): Promise<ActionResult<T>> {
  const requestId = resolveRequestId((await headers()).get(REQUEST_ID_HEADER));
  return Sentry.withScope(async (scope) => {
    scope.setTag("request_id", requestId);
    scope.setTag("rpc", name);
    // Staff and aal2 again here: an action can be called without the layout rendering again (#35 Q6).
    const gate = await staffGate();
    if (gate.kind === "step-up") {
      return { ok: false, kind: "no-permission", message: "Two-step sign-in is needed first. Prove your code on the two-step page, then try again." } as const;
    }
    if (gate.kind !== "staff") return { ok: false, kind: "no-permission", message: "Only Nutrivo staff can do this." } as const;
    const db = await createClient();
    const { data, error } = await call(db);
    if (error) {
      const r = refusal(error);
      if (r.kind === "error") Sentry.captureException(new Error(`${name} failed: ${error.code ?? "error"}`));
      return { ok: false, ...r };
    }
    for (const p of paths) revalidatePath(p);
    return { ok: true, value: data as T };
  });
}

type Fns = Database["app"]["Functions"];
type AcceptArgs = Fns["accept_candidate"]["Args"];
// A null version removes the rule from the draft.
type MemberArgs = Fns["set_draft_member"]["Args"];

const text = (v: FormDataEntryValue | null) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

// ─── K03 ──────────────────────────────────────────────────────────────────────────────────────────
export async function decideTerm(entryId: string, decision: "accept" | "reject", note: string | null) {
  return run<string>(
    "decide_term",
    (db) => db.schema("app").rpc("decide_term", { p_term_entry: entryId, p_decision: decision, p_note: note ?? undefined }),
    ["/admin/terms"],
  );
}

// ─── Rule candidates (K01/K02 → J02) ──────────────────────────────────────────────────────────────
export async function acceptCandidate(candidateId: string, form: FormData): Promise<ActionResult<Json>> {
  let applicability: Json;
  try {
    applicability = JSON.parse(text(form.get("applicability")) ?? "") as Json;
  } catch {
    return { ok: false, kind: "refused", message: "Refused: applicability is not JSON (docs/05 predicate)." };
  }
  const use = text(form.get("use"));
  if (use !== "first" && use !== "second") return { ok: false, kind: "refused", message: "Refused: choose the extraction you checked against the text." };
  return run<Json>(
    "accept_candidate",
    (db) =>
      db.schema("app").rpc("accept_candidate", {
        p_candidate: candidateId,
        p_use: use,
        p_title: text(form.get("title")) ?? undefined,
        p_shape: text(form.get("shape")) ?? undefined,
        p_domain: text(form.get("domain")) ?? undefined,
        p_node: text(form.get("node")) ?? undefined,
        p_applicability: applicability,
        p_effect_type: text(form.get("effect_type")) ?? undefined,
        p_effective_from: text(form.get("effective_from")) ?? undefined,
        p_sell_through_until: text(form.get("sell_through_until")) ?? undefined,
        // Null for a rule that already exists: it keeps its shape, domain and node (the generated types say string).
      } as unknown as AcceptArgs),
    ["/admin/rules", "/admin/coverage"],
  );
}

export async function rejectCandidate(candidateId: string, note: string | null) {
  return run<null>(
    "reject_candidate",
    (db) => db.schema("app").rpc("reject_candidate", { p_candidate: candidateId, p_note: note ?? undefined }),
    ["/admin/rules"],
  );
}

// ─── K04 / K05 ────────────────────────────────────────────────────────────────────────────────────
export async function openGap(form: FormData) {
  return run<string>(
    "open_coverage_gap",
    (db) =>
      db.schema("app").rpc("open_coverage_gap", {
        p_gap_id: text(form.get("gap_id")) ?? "",
        p_node: text(form.get("node")) ?? "",
        p_domain: text(form.get("domain")) ?? "",
        p_reason_code: text(form.get("reason_code")) ?? "",
        p_description: text(form.get("description")) ?? "",
      }),
    ["/admin/coverage"],
  );
}

export async function createDraft(form: FormData) {
  return run<string>(
    "create_ruleset_draft",
    (db) => db.schema("app").rpc("create_ruleset_draft", { p_id: text(form.get("id")) ?? "", p_notes: text(form.get("notes")) ?? "" }),
    ["/admin/coverage"],
  );
}

export async function setDraftMember(draftId: string, ruleKey: string, version: number | null) {
  return run<null>(
    "set_draft_member",
    (db) => db.schema("app").rpc("set_draft_member", { p_draft: draftId, p_rule_key: ruleKey, p_version: version } as unknown as MemberArgs),
    ["/admin/coverage"],
  );
}

export async function setDraftCoverage(draftId: string, nodeId: string, domain: string, form: FormData) {
  return run<null>(
    "set_draft_coverage",
    (db) =>
      db.schema("app").rpc("set_draft_coverage", {
        p_draft: draftId,
        p_node: nodeId,
        p_domain: domain,
        p_state: text(form.get("state")) ?? "",
        p_method: text(form.get("method")) ?? undefined,
        p_last_checked_at: text(form.get("last_checked_at")) ?? undefined,
        p_gap_id: text(form.get("gap_id")) ?? undefined,
      }),
    ["/admin/coverage"],
  );
}

export async function releaseRuleset(draftId: string) {
  return run<Json>(
    "release_ruleset",
    (db) => db.schema("app").rpc("release_ruleset", { p_draft: draftId }),
    ["/admin/coverage", "/admin/glossary"],
  );
}
