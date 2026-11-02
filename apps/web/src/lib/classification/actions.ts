"use server";

// D03 (T-402): a person confirms or edits the product's classification, through app.confirm_classification under the
// person's own session. The RPC writes a new insert-only row and its audit event; this action only passes values from
// the provisional vocabulary. A failure goes to Sentry by its error code with the request id, never with the values.
import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/observability/request-id";
import { createClient } from "@/lib/supabase/server";
import { cleanValues } from "./vocabulary";

export type ConfirmRefusal = "no-permission" | "stale" | "invalid" | "error";
export type ConfirmResult = { ok: true; id: string } | { ok: false; reason: ConfirmRefusal };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODES: Record<string, ConfirmRefusal> = { "42501": "no-permission", P0045: "stale", "22023": "invalid" };

export async function confirmClassification(
  productId: string,
  basisId: string | null,
  values: Record<string, unknown>,
): Promise<ConfirmResult> {
  if (!UUID.test(productId) || (basisId !== null && !UUID.test(basisId))) return { ok: false, reason: "invalid" };
  const v = cleanValues(values);
  const requestId = resolveRequestId((await headers()).get(REQUEST_ID_HEADER));
  return Sentry.withScope(async (scope) => {
    scope.setTag("request_id", requestId);
    scope.setTag("area", "classification");
    const db = await createClient();
    // Nullable arguments: the generated types cannot say so (a Postgres argument has no nullability).
    const args = {
      p_product: productId,
      p_basis: basisId,
      p_species: v.species,
      p_life_stage: v.life_stage,
      p_product_class: v.product_class,
      p_intended_use: v.intended_use,
      p_parnut_status: v.parnut_status,
    } as unknown as { p_product: string; p_basis: string; p_species: string; p_life_stage: string; p_product_class: string; p_intended_use: string; p_parnut_status: string };
    const { data, error } = await db.schema("app").rpc("confirm_classification", args);
    if (error) {
      const reason = (error.code && CODES[error.code]) || "error";
      if (reason === "error") Sentry.captureException(new Error(`confirm_classification failed: ${error.code ?? "error"}`));
      return { ok: false, reason } as const;
    }
    return { ok: true, id: String(data) } as const;
  });
}
