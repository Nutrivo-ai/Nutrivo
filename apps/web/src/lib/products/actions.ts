"use server";

// T-401: the product writes, as Server Actions under the person's own session. Each goes through one RPC
// (app.create_product, app.set_product_stage, app.add_product_markets): permissions, the recipe cap and the markets
// are the database's to decide. An unexpected failure reaches Sentry by its code and request id only (docs/17).
import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { REQUEST_ID_HEADER } from "@/lib/observability/request-id";
import { readOperator } from "@/lib/onboarding/rules";
import {
  INPUT_PROBLEM,
  checkProduct,
  isStage,
  productRefusal,
  type Refusal,
  type Species,
} from "./rules";

export type ProductFormState =
  | { status: "idle" }
  | { status: "problem"; problem: string }
  | { status: "refused"; refusal: Refusal };

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
};

async function requestId() {
  return (await headers()).get(REQUEST_ID_HEADER) ?? undefined;
}

async function report(where: string, code: string | undefined) {
  Sentry.captureMessage(`products ${where} failed: ${code ?? "unknown"}`, {
    level: "error",
    tags: { area: "products", products_step: where, error_code: code ?? "none", request_id: await requestId() },
  });
}

const EXPECTED = new Set(["P0032", "P0034", "P0036", "42501", "22023"]);

/** S-NV2-022 (C01, C03): create the product, its family unless one is picked, and its markets, in one RPC. */
export async function createProduct(_: ProductFormState, form: FormData): Promise<ProductFormState> {
  const workspaceId = text(form, "workspaceId");
  const familyChoice = text(form, "family");
  const stage = text(form, "stage");
  const species = text(form, "species");
  const input = {
    name: text(form, "name"),
    familyId: familyChoice && familyChoice !== "new" ? familyChoice : null,
    familyName: text(form, "familyName"),
    stage: isStage(stage) ? stage : ("" as never),
    species: (species || null) as Species | null,
    lifeStage: text(form, "lifeStage").trim(),
    format: text(form, "format").trim(),
    nodes: form.getAll("nodes").filter((v): v is string => typeof v === "string"),
  };
  const problem = checkProduct(input);
  if (problem) return { status: "problem", problem: INPUT_PROBLEM[problem] };

  // The responsible operator: blank keeps the workspace default (B01); typed, it is read as onboarding reads it.
  const operatorName = text(form, "operatorName").trim();
  const operatorAddress = text(form, "operatorAddress").trim();
  let operator: Record<string, string> | null = null;
  if (operatorName || operatorAddress) {
    const read = readOperator({ name: operatorName, address: operatorAddress, approval: text(form, "operatorApproval") });
    if (!read.ok) return { status: "problem", problem: "Give the operator's name and address exactly as printed, ending with the country (for example SE)." };
    operator = read.operator;
  }

  const db = await createClient();
  const rid = await requestId();
  const call = db.schema("app").rpc("create_product", {
    p_ws: workspaceId,
    p_name: input.name.trim(),
    p_family: input.familyId ?? undefined,
    p_family_name: input.familyId ? undefined : input.familyName.trim() || undefined,
    p_stage: input.stage,
    p_species: input.species ?? undefined,
    p_life_stage: input.lifeStage || undefined,
    p_format: input.format || undefined,
    p_operator: operator ?? undefined,
    p_nodes: input.nodes,
  });
  const { data, error } = await (rid ? call.setHeader(REQUEST_ID_HEADER, rid) : call);
  if (error || !data) {
    if (!EXPECTED.has(error?.code ?? "")) await report("create_product", error?.code);
    return { status: "refused", refusal: productRefusal(error?.code, workspaceId, error?.hint) };
  }
  revalidatePath(`/w/${workspaceId}`, "layout");
  const next = text(form, "next") === "check" ? "check" : "created";
  redirect(next === "check" ? `/w/${workspaceId}/products/${data}/check` : `/w/${workspaceId}/products/${data}/check?created=1`);
}

export type StageFormState = { status: "idle" } | { status: "done"; stage: string } | { status: "refused"; refusal: Refusal };

/** C04: change a product's stage (reversible, audited); a discontinue can carry its reason. */
export async function setStage(_: StageFormState, form: FormData): Promise<StageFormState> {
  const workspaceId = text(form, "workspaceId");
  const productId = text(form, "productId");
  const stage = text(form, "stage");
  if (!isStage(stage)) return { status: "refused", refusal: productRefusal("22023", workspaceId) };
  const db = await createClient();
  const rid = await requestId();
  const call = db.schema("app").rpc("set_product_stage", {
    p_product: productId,
    p_stage: stage,
    p_reason: text(form, "reason").trim() || undefined,
  });
  const { error } = await (rid ? call.setHeader(REQUEST_ID_HEADER, rid) : call);
  if (error) {
    if (!EXPECTED.has(error.code ?? "")) await report("set_product_stage", error.code);
    return { status: "refused", refusal: stageRefusal(error.code, workspaceId, error.hint) };
  }
  revalidatePath(`/w/${workspaceId}`, "layout");
  return { status: "done", stage };
}

function stageRefusal(code: string | undefined, workspaceId: string, hint?: string | null): Refusal {
  if (code === "42501") {
    return { code, title: "Your role cannot change this product's stage", body: "Changing a stage needs an editor or a role above it. An admin of this workspace can change your role." };
  }
  if (code === "P0034") {
    const r = productRefusal(code, workspaceId, hint);
    return { ...r, body: r.body.replace("a new recipe needs", "making this recipe live again needs") };
  }
  return productRefusal(code, workspaceId, hint);
}

export type MarketsFormState = { status: "idle" } | { status: "done"; added: number } | { status: "refused"; refusal: Refusal };

/** C01 step 3 after creation: add markets. Never counts against the free allowance (B02.must.1). */
export async function addMarkets(_: MarketsFormState, form: FormData): Promise<MarketsFormState> {
  const workspaceId = text(form, "workspaceId");
  const productId = text(form, "productId");
  const nodes = form.getAll("nodes").filter((v): v is string => typeof v === "string");
  if (nodes.length === 0) return { status: "done", added: 0 };
  const db = await createClient();
  const rid = await requestId();
  const call = db.schema("app").rpc("add_product_markets", { p_product: productId, p_nodes: nodes });
  const { data, error } = await (rid ? call.setHeader(REQUEST_ID_HEADER, rid) : call);
  if (error) {
    if (!EXPECTED.has(error.code ?? "")) await report("add_product_markets", error.code);
    const refusal =
      error.code === "42501"
        ? { code: error.code, title: "Your role cannot add these markets", body: "Adding a market needs an editor whose scope holds it. An admin of this workspace can change your scope." }
        : productRefusal(error.code, workspaceId);
    return { status: "refused", refusal };
  }
  revalidatePath(`/w/${workspaceId}/products/${productId}/check`);
  return { status: "done", added: data ?? 0 };
}
