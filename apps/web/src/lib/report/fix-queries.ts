// S-FIX-001 · the label report as Fix mode: the reads, under the person's own session (RLS decides what any of them
// returns). The product's markets name their latest check job (app.product_nodes.last_check_job_id), so each market
// shows one job's checks and never mixes an older one in; ?job=<id> reads an older job of the product, read-only.
// Reference data: the market's languages (ref.jurisdictions), the coverage gaps, and for Copy required term the rule
// versions the findings applied and the accepted term register entries they link to (ref.term_entries, D-31; RLS
// returns only accepted entries to a customer, and the read asks for accepted ones besides).
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { inPlan, readPlan, regionName } from "@/lib/plan/regions";
import { buildFix, type ActiveJobRow, type FixModel, type FixRows } from "./fix";
import { ReportReadError } from "./queries";

export type FixPage =
  | { kind: "not-found" }
  | {
      kind: "loaded";
      product: { id: string; name: string };
      model: FixModel;
      currentRuleset: string | null;
      activeJob: ActiveJobRow | null;
      /** Whether any check has ever run on the product's markets in this plan. */
      checked: boolean;
      /** The product's latest artwork version, for Run check on a product never checked. */
      hasArtwork: boolean;
      /** J04.must.1 (T-902): markets whose region the plan does not hold; their checks are not read. */
      outsidePlan: { nodeId: string; name: string; regionName: string }[];
    };

type Client = SupabaseClient<Database>;

function ok<T>(what: string, r: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (r.error) throw new ReportReadError(what, r.error);
  return r.data as T;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const none = { data: [], error: null };

export async function readFix(supabase: Client, workspaceId: string, productId: string, job: string | null): Promise<FixPage> {
  if (!UUID.test(workspaceId) || !UUID.test(productId)) return { kind: "not-found" };
  const viewedJob = job && UUID.test(job) ? job : null;
  const app = supabase.schema("app");
  const ref = supabase.schema("ref");

  const product = ok(
    "product",
    await app.from("products").select("id, name").eq("id", productId).eq("workspace_id", workspaceId).maybeSingle(),
  );
  if (!product) return { kind: "not-found" };

  const [nodes, current, plan, active, artwork] = await Promise.all([
    app.from("product_nodes").select("node_id, last_check_job_id").eq("product_id", productId),
    ref.from("ruleset_versions").select("id").not("released_at", "is", null).order("released_at", { ascending: false }).limit(1),
    readPlan(supabase, workspaceId),
    app
      .from("jobs")
      .select("id, status, payload")
      .eq("product_id", productId)
      .eq("kind", "check")
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: false })
      .limit(1),
    app.from("artwork_versions").select("id").eq("product_id", productId).limit(1),
  ]);
  if (!plan) return { kind: "not-found" };
  const allMarkets = ok("markets", nodes) ?? [];
  const marketRows = allMarkets.filter((m) => inPlan(plan, m.node_id));
  const outside = allMarkets.filter((m) => !inPlan(plan, m.node_id)).map((m) => m.node_id);
  const currentRuleset = ok("ruleset", current)?.[0]?.id ?? null;
  const activeRow = ok("jobs", active)?.[0];
  const activePayload = (activeRow?.payload ?? {}) as { artwork_version_id?: unknown };
  const activeJob: ActiveJobRow | null = activeRow
    ? {
        id: activeRow.id,
        status: activeRow.status,
        artwork_version_id: typeof activePayload.artwork_version_id === "string" ? activePayload.artwork_version_id : null,
      }
    : null;
  const nodeIds = marketRows.map((m) => m.node_id);
  const jobIds = [
    ...new Set([...marketRows.map((m) => m.last_check_job_id), viewedJob].filter((j): j is string => !!j)),
  ];

  const [jurisdictions, checkRows] = await Promise.all([
    nodeIds.length || outside.length
      ? ref.from("jurisdictions").select("id, name, languages").in("id", [...nodeIds, ...outside])
      : Promise.resolve(none),
    jobIds.length
      ? app
          .from("checks")
          .select("id, job_id, node_id, panel_id, language, label_state, ruleset_version, artwork_version_id, artwork_sha, at")
          .eq("product_id", productId)
          .in("job_id", jobIds)
      : Promise.resolve(none),
  ]);
  const places = ok("markets", jurisdictions) ?? [];
  const placeOf = new Map(places.map((j) => [j.id, j]));
  const checks = (ok("checks", checkRows) ?? []).filter((c) => nodeIds.includes(c.node_id));
  const checkIds = checks.map((c) => c.id);
  const panelIds = [...new Set(checks.map((c) => c.panel_id).filter((p): p is string => !!p))];
  const rulesets = [...new Set(checks.map((c) => c.ruleset_version))];

  const [findingRows, panelRows, objectRows] = await Promise.all([
    checkIds.length
      ? app
          .from("check_findings")
          .select(
            "id, check_id, node_id, rule_key, rule_version, gap_id, state, provenance, citation, message, recommended_action, panel_id, language, text_object_id, bbox_mm, measured_mm, required_mm, reason_code, confidence, created_at",
          )
          .in("check_id", checkIds)
      : Promise.resolve(none),
    panelIds.length
      ? app.from("artwork_panels").select("id, page, panel_index, bbox_mm, language, status, failure_code").in("id", panelIds)
      : Promise.resolve(none),
    panelIds.length
      ? app.from("text_objects").select("id, panel_id, text, bbox_mm, is_ocr, reading_order").in("panel_id", panelIds)
      : Promise.resolve(none),
  ]);
  const findings = ok("findings", findingRows) ?? [];
  const gapIds = [...new Set(findings.map((f) => f.gap_id).filter((g): g is string => !!g))];
  const ruleKeys = [...new Set(findings.filter((f) => f.state === "action").map((f) => f.rule_key).filter((k): k is string => !!k))];

  const [gapRows, ruleRows, versionRows, memberRows] = await Promise.all([
    gapIds.length
      ? ref.from("coverage_gaps").select("gap_id, node_id, domain, reason_code, description").in("gap_id", gapIds)
      : Promise.resolve(none),
    ruleKeys.length ? ref.from("rules").select("rule_key, shape").in("rule_key", ruleKeys) : Promise.resolve(none),
    ruleKeys.length
      ? ref.from("rule_versions").select("rule_key, version, params").in("rule_key", ruleKeys).eq("status", "accepted")
      : Promise.resolve(none),
    ruleKeys.length && rulesets.length
      ? ref.from("ruleset_members").select("ruleset_version, rule_key, version").in("rule_key", ruleKeys).in("ruleset_version", rulesets)
      : Promise.resolve(none),
  ]);
  const versions = ok("rule versions", versionRows) ?? [];
  // Every key the findings' rules link to; the register entries are read for those keys only.
  const termKeys = [
    ...new Set(
      versions.flatMap((v) => {
        const p = (v.params ?? {}) as { term_key?: unknown; detect?: { term_keys?: unknown } };
        const detected = p.detect?.term_keys;
        const keys: unknown[] = [p.term_key, ...(Array.isArray(detected) ? detected : [])];
        return keys.filter((k): k is string => typeof k === "string" && k.length > 0);
      }),
    ),
  ];
  const termRows = termKeys.length
    ? await ref.from("term_entries").select("term_key, language, term, ruleset_version, status").in("term_key", termKeys).eq("status", "accepted")
    : none;

  const rows: FixRows = {
    workspaceId,
    productId,
    markets: marketRows.map((m) => ({
      node_id: m.node_id,
      name: placeOf.get(m.node_id)?.name ?? m.node_id,
      languages: placeOf.get(m.node_id)?.languages ?? [],
      last_check_job_id: m.last_check_job_id,
    })),
    checks,
    findings: findings.map((f) => ({
      ...f,
      bbox_mm: f.bbox_mm ? f.bbox_mm.map(Number) : null,
      confidence: f.confidence == null ? null : Number(f.confidence),
    })),
    panels: ok("panels", panelRows) ?? [],
    textObjects: ok("text", objectRows) ?? [],
    gaps: ok("gaps", gapRows) ?? [],
    rules: ok("rules", ruleRows) ?? [],
    ruleVersions: versions,
    members: ok("ruleset members", memberRows) ?? [],
    terms: ok("terms", termRows) ?? [],
    currentRuleset,
    activeJob,
    viewedJob,
  };
  const model = buildFix(rows);
  const outsidePlan = outside.map((nodeId) => ({ nodeId, name: placeOf.get(nodeId)?.name ?? nodeId, regionName: regionName(plan, nodeId) }));
  return {
    kind: "loaded",
    product,
    model,
    currentRuleset,
    activeJob,
    checked: checks.length > 0,
    hasArtwork: (ok("artwork", artwork) ?? []).length > 0,
    outsidePlan,
  };
}
