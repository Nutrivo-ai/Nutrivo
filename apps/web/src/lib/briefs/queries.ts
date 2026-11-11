// T-1001 reads for Brief & formula (S-NV2-004), under the person's own session (RLS): the product, its formula lines
// with the register rows they name, its intended claims per language, and its latest classification's product class
// (#76 Q6). Another workspace's product reads as absent.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { isUuid } from "@/lib/artwork/queries";
import { ShellReadError } from "@/lib/workspace/memberships";
import type { EnvelopeItemRow, EnvelopeNodeRow } from "./envelope";
import type { FormulaLineInput, RegisterRow } from "./rules";

type Db = SupabaseClient<Database>;

export type BriefLine = FormulaLineInput & { id: string; registerName: string | null };

export type Brief = {
  id: string;
  name: string;
  stage: string;
  species: string | null;
  lifeStage: string | null;
  productClass: string | null;
  nodes: string[];
  lines: BriefLine[];
  claims: Record<string, string[]>;
  languages: string[];
};

const num = (v: number | string | null) => (v === null ? null : Number(v));

/** The English name of a feed material when the register holds one, else its first name. */
export function materialName(names: unknown): string | null {
  if (!names || typeof names !== "object") return null;
  const n = names as Record<string, unknown>;
  const v = typeof n.en === "string" ? n.en : Object.values(n).find((x) => typeof x === "string");
  return typeof v === "string" ? v : null;
}

export async function readBrief(db: Db, workspaceId: string, productId: string): Promise<Brief | null> {
  if (!isUuid(productId)) return null;
  const app = db.schema("app");
  const { data: product, error } = await app
    .from("products")
    .select("id, name, stage, species, life_stage, product_nodes(node_id)")
    .eq("id", productId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new ShellReadError("brief", error);
  if (!product) return null;

  const [lines, claims, classification, jurisdictions] = await Promise.all([
    app
      .from("formula_lines")
      .select("id, position, ingredient, percent, feed_material_ref, additive_ref, amount, unit")
      .eq("product_id", productId)
      .order("position"),
    app.from("intended_claims").select("language, claim_text, created_at").eq("product_id", productId).order("created_at"),
    app
      .from("classifications")
      .select("product_class")
      .eq("product_id", productId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.schema("ref").from("jurisdictions").select("languages"),
  ]);
  for (const r of [lines, claims, classification, jurisdictions]) if (r.error) throw new ShellReadError("brief", r.error);

  const rows = lines.data ?? [];
  const materials = [...new Set(rows.map((r) => r.feed_material_ref).filter((x): x is string => Boolean(x)))];
  const additives = [...new Set(rows.map((r) => r.additive_ref).filter((x): x is string => Boolean(x)))];
  const [fm, fa] = await Promise.all([
    materials.length
      ? db.schema("ref").from("feed_materials").select("number, names").in("number", materials)
      : Promise.resolve({ data: [], error: null }),
    additives.length
      ? db.schema("ref").from("feed_additives").select("id, name").in("id", additives)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (fm.error) throw new ShellReadError("brief", fm.error);
  if (fa.error) throw new ShellReadError("brief", fa.error);
  const fmName = new Map((fm.data ?? []).map((m) => [m.number, materialName(m.names)]));
  const faName = new Map((fa.data ?? []).map((a) => [a.id, a.name]));

  const byLanguage: Record<string, string[]> = {};
  for (const c of claims.data ?? []) (byLanguage[c.language] ??= []).push(c.claim_text);

  return {
    id: product.id,
    name: product.name,
    stage: product.stage,
    species: product.species,
    lifeStage: product.life_stage,
    productClass: classification.data?.product_class ?? null,
    nodes: (product.product_nodes ?? []).map((n) => n.node_id).sort(),
    lines: rows.map((r) => ({
      id: r.id,
      ingredient: r.ingredient,
      percent: num(r.percent),
      feed_material_ref: r.feed_material_ref,
      additive_ref: r.additive_ref,
      amount: num(r.amount),
      unit: r.unit,
      registerName: r.feed_material_ref
        ? (fmName.get(r.feed_material_ref) ?? null)
        : r.additive_ref
          ? (faName.get(r.additive_ref) ?? null)
          : null,
    })),
    claims: byLanguage,
    languages: [...new Set((jurisdictions.data ?? []).flatMap((j) => j.languages ?? []))].sort(),
  };
}

/** PostgREST filter text is built from the person's query: keep letters, digits, spaces, dots and hyphens only. */
export function registerQuery(q: string) {
  return q.replace(/[^\p{L}\p{N} .\-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

/** Register rows matching a typed name or number, for the person to pick from (#76 Q3); never a match by itself. */
export async function searchRegister(db: Db, q: string): Promise<RegisterRow[]> {
  const term = registerQuery(q);
  if (term.length < 2) return [];
  const ref = db.schema("ref");
  const [fm, fa] = await Promise.all([
    ref.from("feed_materials").select("number, names").or(`number.ilike.${term}%,names->>en.ilike.%${term}%`).limit(10),
    ref.from("feed_additives").select("id, name").or(`id.ilike.${term}%,name.ilike.%${term}%`).limit(10),
  ]);
  if (fm.error) throw new ShellReadError("register", fm.error);
  if (fa.error) throw new ShellReadError("register", fa.error);
  return [
    ...(fm.data ?? []).map((m) => ({ kind: "feed_material" as const, ref: m.number, name: materialName(m.names) ?? m.number })),
    ...(fa.data ?? []).map((a) => ({ kind: "additive" as const, ref: a.id, name: a.name })),
  ];
}

/** T-1002 · E02: the latest envelope of a brief and the latest envelope job, read under RLS (S-NV2-005). */
export type EnvelopeRead = {
  product: { id: string; name: string; stage: string; nodes: string[] };
  envelope: {
    id: string;
    rulesetVersion: string;
    createdAt: string;
    outOfScope: string[];
    nodes: EnvelopeNodeRow[];
    items: EnvelopeItemRow[];
  } | null;
  /** The newest envelope job, when it is newer than the envelope shown (queued, running, failed or superseded). */
  job: { id: string; status: string; outcome: string | null; createdAt: string } | null;
};

export async function readEnvelope(db: Db, workspaceId: string, productId: string): Promise<EnvelopeRead | null> {
  if (!isUuid(productId)) return null;
  const app = db.schema("app");
  const { data: product, error } = await app
    .from("products")
    .select("id, name, stage, product_nodes(node_id)")
    .eq("id", productId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new ShellReadError("envelope", error);
  if (!product) return null;

  const [env, job] = await Promise.all([
    app
      .from("envelopes")
      .select("id, ruleset_version, created_at, out_of_scope, job_id")
      .eq("product_id", productId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    app
      .from("jobs")
      .select("id, status, progress, created_at")
      .eq("kind", "envelope")
      .eq("payload->>product_id", productId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (env.error) throw new ShellReadError("envelope", env.error);
  if (job.error) throw new ShellReadError("envelope job", job.error);

  let envelope: EnvelopeRead["envelope"] = null;
  if (env.data) {
    const [nodes, items] = await Promise.all([
      app.from("envelope_nodes").select("node_id, state, open_items, withheld").eq("envelope_id", env.data.id),
      app
        .from("envelope_items")
        .select("id, node_id, language, kind, rule_key, rule_version, gap_id, provenance, reason_code, citation, payload")
        .eq("envelope_id", env.data.id),
    ]);
    if (nodes.error) throw new ShellReadError("envelope", nodes.error);
    if (items.error) throw new ShellReadError("envelope", items.error);
    envelope = {
      id: env.data.id,
      rulesetVersion: env.data.ruleset_version,
      createdAt: env.data.created_at,
      outOfScope: env.data.out_of_scope,
      nodes: nodes.data ?? [],
      items: (items.data ?? []) as EnvelopeItemRow[],
    };
  }
  const j = job.data;
  const outcome = j && j.progress && typeof j.progress === "object" && !Array.isArray(j.progress)
    ? ((j.progress as Record<string, unknown>).outcome as string | undefined) ?? null
    : null;
  const shownJob = j && j.id !== env.data?.job_id && !(j.status === "succeeded" && outcome !== "superseded")
    ? { id: j.id, status: j.status, outcome, createdAt: j.created_at }
    : null;
  return {
    product: {
      id: product.id,
      name: product.name,
      stage: product.stage,
      nodes: (product.product_nodes ?? []).map((n) => n.node_id).sort(),
    },
    envelope,
    job: shownJob,
  };
}
