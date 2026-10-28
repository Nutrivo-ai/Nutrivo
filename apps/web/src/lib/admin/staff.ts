// T-205: the rules /admin applies before anything is read, and how a staff RPC's refusal is put to the person. Pure
// functions, so they are unit-tested without a stack.
import { mfaGate, type Assurance, type MfaGate } from "@/lib/auth/rules";

/** Staff status comes only from app_metadata.nutrivo_staff, which only the Supabase admin API can set (docs/09). */
export function isStaff(user: { app_metadata?: Record<string, unknown> | null } | null | undefined): boolean {
  return user?.app_metadata?.nutrivo_staff === true;
}

/**
 * #35 Q6 (founder): staff work at aal2 only. A staff member is gated as a signer is (T-103): with a verified factor
 * they prove it (challenge), without one they enrol first.
 */
export function staffMfa(assurance: Assurance): MfaGate {
  return mfaGate(assurance, true);
}

/** /auth/mfa, coming back to the console afterwards. */
export const ADMIN_MFA = `/auth/mfa?next=${encodeURIComponent("/admin")}`;

export type RpcFailure = { code?: string | null; message?: string | null };

export type Refusal = {
  kind: "no-permission" | "refused" | "error";
  /** What the person reads. A refusal carries the database's own reason; it never holds content or a secret. */
  message: string;
};

// The codes a staff RPC refuses with on purpose (T-204, docs/03): the reason is the database's message, shown as is.
const REFUSALS: Record<string, string> = {
  "22023": "Refused",
  P0008: "Refused: an accepted version is never changed",
  P0010: "Refused by BE-10",
  P0038: "Refused: a ruleset holds accepted rule versions only",
  P0039: "Refused by the release gate (K05)",
};

export function refusal(error: RpcFailure): Refusal {
  const code = error.code ?? "";
  if (code === "42501") return { kind: "no-permission", message: "Only Nutrivo staff can do this." };
  if (code in REFUSALS) {
    const reason = (error.message ?? "").trim();
    return { kind: "refused", message: reason ? `${REFUSALS[code]}: ${reason}` : REFUSALS[code] };
  }
  return { kind: "error", message: "The change was not saved. Nothing was written; try again." };
}

export type ActionResult<T = null> = { ok: true; value: T } | ({ ok: false } & Refusal);

/** The coverage domains (ref.coverage_nodes.domain), in the order the coverage page lists them. */
export const DOMAINS = [
  "mandatory_particulars",
  "composition",
  "claims_wording",
  "type_geometry",
  "language",
  "registration",
] as const;
export const COVERAGE_STATES = ["complete", "partial", "not_encoded"] as const;
export const REASON_CODES = ["not_encoded", "partially_encoded", "data_missing", "out_of_scope", "pending_acceptance"] as const;
export const SHAPES = [
  "threshold",
  "mandatory_particular",
  "prescribed_wording",
  "character_height",
  "additive_condition",
  "claim_judgement",
] as const;
export const EFFECT_TYPES = [
  "new_obligation",
  "tightened_threshold",
  "withdrawn_authorisation",
  "prescribed_wording",
  "editorial",
] as const;

export const label = (key: string) => key.replace(/_/g, " ");

/** A draft id as app.create_ruleset_draft accepts it: '2026.11-a'. */
export const DRAFT_ID = /^[0-9]{4}\.[0-9]{2}-[a-z0-9]+$/;
/** A gap id as app.open_coverage_gap accepts it: 'GAP-EU-SE-TYPE_GEOMETRY'. */
export const GAP_ID = /^GAP-[A-Z0-9_-]+$/;
