"use server";

// G03 (T-504): an editor records a registration they hold, through app.record_registration under their own session.
// The RPC checks the role and the market scope first, writes the row and its audit event and recomputes
// registration_state in one transaction. Nothing here, or anywhere, submits to an authority (G02.must.1). An
// unexpected failure reaches Sentry by its error code and request id only, never with the values.
import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/observability/request-id";
import { createClient } from "@/lib/supabase/server";
import { readRecordInput, recordRefusal, type RecordRefusal } from "./model";

export type RecordFormState = { status: "idle" } | { status: "recorded"; id: string } | { status: "refused"; refusal: RecordRefusal };

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
};

export async function recordRegistration(_: RecordFormState, form: FormData): Promise<RecordFormState> {
  const workspaceId = text(form, "workspaceId");
  const productId = text(form, "productId");
  const nodeId = text(form, "nodeId");
  const input = readRecordInput({
    number: text(form, "number"),
    registeredOn: text(form, "registeredOn"),
    expiresAt: text(form, "expiresAt"),
    evidenceDoc: text(form, "evidenceDoc"),
  });
  if (!input) return { status: "refused", refusal: "invalid" };
  const requestId = resolveRequestId((await headers()).get(REQUEST_ID_HEADER));
  return Sentry.withScope(async (scope) => {
    scope.setTag("request_id", requestId);
    scope.setTag("area", "registration");
    const db = await createClient();
    const { data, error } = await db
      .schema("app")
      .rpc("record_registration", {
        p_product: productId,
        p_node: nodeId,
        p_number: input.number,
        p_registered_on: input.registeredOn,
        p_expires_at: input.expiresAt ?? undefined,
        p_evidence_doc: input.evidenceDoc ?? undefined,
      })
      .setHeader(REQUEST_ID_HEADER, requestId);
    if (error || !data) {
      const refusal = recordRefusal(error?.code);
      if (refusal === "error") Sentry.captureException(new Error(`record_registration failed: ${error?.code ?? "no id"}`));
      return { status: "refused", refusal } as const;
    }
    revalidatePath(`/w/${workspaceId}`, "layout");
    return { status: "recorded", id: String(data) } as const;
  });
}
