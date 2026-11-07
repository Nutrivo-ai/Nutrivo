"use server";

// T-1001 · E01: the brief's writes, as Server Actions under the person's own session. Each goes through one RPC
// (app.set_formula_lines, app.set_intended_claims): permissions, the register rows and the languages are the
// database's to decide. A failure goes to Sentry by its error code with the request id, never with the formula or the
// claim text (docs/17).
import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/observability/request-id";
import { createClient } from "@/lib/supabase/server";
import { searchRegister as search } from "./queries";
import { MAX_CLAIMS, cleanLines, formulaProblems, type FormulaLineInput, type RegisterRow } from "./rules";

export type BriefRefusal = "no-permission" | "invalid" | "error";
export type BriefResult = { ok: true; count: number } | { ok: false; reason: BriefRefusal };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODES: Record<string, BriefRefusal> = { "42501": "no-permission", "22023": "invalid" };

async function run(step: string, write: () => PromiseLike<{ data: unknown; error: { code?: string } | null }>): Promise<BriefResult> {
  const requestId = resolveRequestId((await headers()).get(REQUEST_ID_HEADER));
  return Sentry.withScope(async (scope) => {
    scope.setTag("request_id", requestId);
    scope.setTag("area", "briefs");
    scope.setTag("briefs_step", step);
    const { data, error } = await write();
    if (error) {
      const reason = (error.code && CODES[error.code]) || "error";
      if (reason === "error") Sentry.captureException(new Error(`${step} failed: ${error.code ?? "error"}`));
      return { ok: false, reason } as const;
    }
    return { ok: true, count: Number(data) } as const;
  });
}

/** The whole formula, replaced in one RPC; the person who saves it is applied_by. */
export async function saveFormula(workspaceId: string, productId: string, lines: FormulaLineInput[]): Promise<BriefResult> {
  if (!UUID.test(productId) || !Array.isArray(lines)) return { ok: false, reason: "invalid" };
  const clean = cleanLines(lines);
  if (formulaProblems(clean).length) return { ok: false, reason: "invalid" };
  const db = await createClient();
  const result = await run("set_formula_lines", () =>
    db.schema("app").rpc("set_formula_lines", { p_product: productId, p_lines: clean }),
  );
  if (result.ok) revalidatePath(`/w/${workspaceId}/briefs/${productId}`);
  return result;
}

/** One language's intended claims, as typed. */
export async function saveClaims(workspaceId: string, productId: string, language: string, claims: string[]): Promise<BriefResult> {
  if (!UUID.test(productId) || !/^[a-z]{2}$/.test(language) || !Array.isArray(claims) || claims.length > MAX_CLAIMS) {
    return { ok: false, reason: "invalid" };
  }
  const db = await createClient();
  const result = await run("set_intended_claims", () =>
    db.schema("app").rpc("set_intended_claims", { p_product: productId, p_language: language, p_claims: claims.map((c) => String(c)) }),
  );
  if (result.ok) revalidatePath(`/w/${workspaceId}/briefs/${productId}`);
  return result;
}

export type RegisterSearch = { ok: true; rows: RegisterRow[] } | { ok: false };

/** Register rows for the person to pick from; the pick is theirs, never automatic (#76 Q3). */
export async function findInRegister(q: string): Promise<RegisterSearch> {
  try {
    return { ok: true, rows: await search(await createClient(), String(q ?? "")) };
  } catch (error) {
    Sentry.captureException(error, { tags: { area: "briefs", briefs_step: "register_search" } });
    return { ok: false };
  }
}
