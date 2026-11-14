"use server";

// H02 (T-802): an editor asks a supplier for a document. The only write is app.request_document, under the editor's
// own session; it upserts the supplier, stores the request without a token and queues the email job, whose worker
// mints the link and stores only its hash (H02.must.1). Failures go to Sentry by error code only, never the address
// or the text of the request.
import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { REQUEST_ID_HEADER } from "@/lib/observability/request-id";
import { createClient } from "@/lib/supabase/server";
import { isRateLimited, rateLimitMessage } from "@/lib/rate-limit";

export type RequestFormState =
  | { status: "idle" }
  | { status: "sent"; supplier: string }
  | { status: "problem"; problem: string };

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The form's own checks, before the database repeats them. */
export async function checkRequest(form: FormData): Promise<string | null> {
  const supplier = text(form, "supplier");
  if (!text(form, "title")) return "Say what you need, in a line the supplier will read.";
  if (text(form, "title").length > 200) return "Keep what you need to 200 characters.";
  if (!text(form, "doc_type")) return "Pick the type of document.";
  if (supplier === "new" || supplier === "") {
    if (!text(form, "supplier_name")) return "Name the supplier.";
    if (!EMAIL.test(text(form, "supplier_email"))) return "Type the supplier's email address.";
  } else if (!UUID.test(supplier)) {
    return "Pick a supplier.";
  }
  const product = text(form, "product");
  if (product && !UUID.test(product)) return "Pick a product, or none for a workspace document.";
  return null;
}

export async function requestDocument(_: RequestFormState, form: FormData): Promise<RequestFormState> {
  const workspace = text(form, "workspace");
  const problem = UUID.test(workspace) ? await checkRequest(form) : "This workspace could not be found.";
  if (problem) return { status: "problem", problem };
  const existing = text(form, "supplier");
  const isNew = existing === "new" || existing === "";
  const requestId = (await headers()).get(REQUEST_ID_HEADER);
  const supabase = await createClient();
  const { error } = await supabase.schema("app").rpc("request_document", {
    p_ws: workspace,
    p_title: text(form, "title"),
    p_doc_type: text(form, "doc_type"),
    p_supplier: isNew ? undefined : existing,
    p_supplier_name: isNew ? text(form, "supplier_name") : undefined,
    p_supplier_email: isNew ? text(form, "supplier_email") : undefined,
    p_product: text(form, "product") || undefined,
    p_request_id: requestId ?? undefined,
  });
  if (error) {
    if (error.code === "42501") return { status: "problem", problem: "Only an editor of this product can ask for its documents." };
    if (error.code === "22023") return { status: "problem", problem: "Check the request: " + plain(error.message) };
    if (isRateLimited(error)) return { status: "problem", problem: rateLimitMessage(error, "Nothing was sent.").body };
    Sentry.captureMessage(`request_document failed: ${error.code ?? "error"}`, {
      level: "error",
      tags: { area: "suppliers", request_id: requestId ?? "" },
    });
    return { status: "problem", problem: "The request could not be sent just now. Nothing was sent; try again." };
  }
  revalidatePath(`/w/${workspace}/library/suppliers`);
  return { status: "sent", supplier: isNew ? text(form, "supplier_name") : "the supplier" };
}

/** The database's own 22023 messages are written for people ("a supplier needs one valid email address"). */
function plain(message: string): string {
  const m = message.trim();
  return m ? m[0].toLowerCase() + m.slice(1) + (m.endsWith(".") ? "" : ".") : "a field is not valid.";
}
