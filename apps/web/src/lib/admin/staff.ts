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
  P0048: "Refused: a linked term lacks one of the node's languages (D-31)",
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

// ─── D-31 · term links (T-211) ────────────────────────────────────────────────────────────────────
// A rule judges printed text only through accepted register terms, linked by the person who accepts it. Which link
// fields each shape takes mirrors private.term_link_fields (T-209); the database checks them again.
export const SCOPES = ["each_panel_in_node_language", "any_panel"] as const;
export const MATCHES = ["case_folded", "exact"] as const;
export type LinkKind = "detect" | "wording" | "none";

export function linkKind(shape: string | null | undefined): LinkKind {
  if (shape === "prescribed_wording") return "wording";
  if (shape === "mandatory_particular" || shape === "threshold" || shape === "character_height") return "detect";
  return "none";
}

/** Every link field of any shape: what an extraction never holds, and what a re-link replaces. */
const LINK_FIELDS = ["detect", "scope", "term_key", "alternative_term_keys", "match"];

export type Links = Record<string, unknown>;
export type CurrentLinks = { detect: string[]; scope: string | null; termKey: string | null; alternatives: string[]; match: string | null };

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : []);

/** The links a stored rule version carries, read back from its params. */
export function currentLinks(params: unknown): CurrentLinks {
  const p = params && typeof params === "object" && !Array.isArray(params) ? (params as Record<string, unknown>) : {};
  const detect = p.detect && typeof p.detect === "object" && !Array.isArray(p.detect) ? (p.detect as Record<string, unknown>) : {};
  return {
    detect: strings(detect.term_keys),
    scope: typeof p.scope === "string" ? p.scope : null,
    termKey: typeof p.term_key === "string" && p.term_key !== "" ? p.term_key : null,
    alternatives: strings(p.alternative_term_keys),
    match: typeof p.match === "string" ? p.match : null,
  };
}

export function hasLinks(params: unknown): boolean {
  const p = params && typeof params === "object" && !Array.isArray(params) ? (params as Record<string, unknown>) : {};
  return LINK_FIELDS.some((f) => f in p);
}

/**
 * The links the person chose in a form: `link_detect` (several), `link_scope`, `link_term_key`, `link_alternatives`
 * (several) and `link_match`. No key chosen means no links (the rule stays withheld until re-linked); a mode is sent
 * only with its key, and the default mode is left out, as the engine assumes it.
 */
export function linksFromForm(shape: string | null | undefined, form: { getAll(name: string): FormDataEntryValue[] }):
  { ok: true; links: Links | null } | { ok: false; message: string } {
  const all = (name: string) => [...new Set(form.getAll(name).filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim()))];
  const one = (name: string) => all(name)[0] ?? null;
  const kind = linkKind(shape);
  if (kind === "detect") {
    const keys = all("link_detect");
    if (keys.length === 0) return { ok: true, links: null };
    const links: Links = { detect: { term_keys: keys } };
    const scope = one("link_scope");
    if (shape === "mandatory_particular" && scope && scope !== SCOPES[0]) links.scope = scope;
    return { ok: true, links };
  }
  if (kind === "wording") {
    const termKey = one("link_term_key");
    const alternatives = all("link_alternatives").filter((k) => k !== termKey);
    if (!termKey) {
      return alternatives.length
        ? { ok: false, message: "Refused: choose the prescribed term before the wordings also permitted." }
        : { ok: true, links: null };
    }
    const links: Links = { term_key: termKey };
    if (alternatives.length) links.alternative_term_keys = alternatives;
    const match = one("link_match");
    if (match && match !== MATCHES[0]) links.match = match;
    return { ok: true, links };
  }
  return { ok: true, links: null };
}
