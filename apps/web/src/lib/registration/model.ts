// T-504 · D06, G01, G02, G03: what the obligations view (S-NV2-008) and the registration pack (S-NV2-020) show, as
// pure functions over rows read under RLS. Registration state is separate from label state (non-negotiable 8): the
// verdict shown is app.product_nodes.display_state, never label_state, and an unknown registration is never Clear.
// Nothing here holds obligation text, authority names or evidence lists (non-negotiable 7): they come only from
// ref.obligations rows, and no such row is eligible yet (#54 Q4).
import type { VerdictState } from "@/components/kit/states";

export const REGISTRATION_STATES = ["unknown", "registered", "not_registered", "expired", "not_required"] as const;
export type RegistrationState = (typeof REGISTRATION_STATES)[number];

/** registration_state in words. Never "Clear": a registration state is not a verdict (D06.must.1). */
export const REGISTRATION_WORDS: Record<RegistrationState, string> = {
  unknown: "Unknown",
  registered: "Registered",
  not_registered: "Not registered",
  expired: "Expired",
  not_required: "Not required",
};

export function registrationWords(state: string | null | undefined): string {
  return (REGISTRATION_STATES as readonly string[]).includes(state ?? "") ? REGISTRATION_WORDS[state as RegistrationState] : REGISTRATION_WORDS.unknown;
}

/** What each registration state means on this screen, in a sentence. */
export const REGISTRATION_NOTE: Record<RegistrationState, string> = {
  unknown: "No registration is recorded and no sourced obligation is held for this market, so registration is not assessed.",
  registered: "Registered as you recorded it. We record what you tell us and date it; we do not confirm that a registration is valid.",
  not_registered: "A sourced registration obligation is held for this market and no registration is recorded.",
  expired: "The latest recorded registration has passed its expiry date.",
  not_required: "Registration is recorded as not required for this market.",
};

/**
 * The verdict badge for a market: app.product_nodes.display_state only (generated in the database, BE-14). A value the
 * vocabulary does not know, or none, is withheld (not_assessed), never Clear. label_state is never read here.
 */
export function displayBadge(displayState: string | null | undefined): VerdictState {
  if (displayState === "clear" || displayState === "action" || displayState === "not_assessed" || displayState === "blocked") return displayState;
  return "not_assessed";
}

export type ObligationRow = {
  id: string;
  node_id: string;
  kind: string;
  authority: string | null;
  legal_basis: string | null;
  route: string | null;
  evidence_list: unknown;
  fee: string | null;
  lead_time_days: number | null;
  renewal_cycle: string | null;
  submission_language: string | null;
  source_url: string | null;
  last_verified_at: string | null;
};

/**
 * Whether ref.obligations can say a row was accepted by a person. It cannot yet: there is no status, accepted_by or
 * source column (#54 Q4). Until an expand migration adds acceptance, no row is accepted.
 */
function isAccepted(row: ObligationRow): boolean {
  void row;
  return false;
}

/**
 * The one eligibility filter of the web, the same as private.compute_registration_state's (migration
 * 20261103110902_registration_state.sql): kind registration, sourced (source_url) and dated (last_verified_at), and
 * accepted, which no column expresses yet (#54 Q4), so today nothing is eligible (G01.must.1).
 */
export function eligibleObligations<T extends ObligationRow>(rows: T[]): T[] {
  return rows.filter((o) => o.kind === "registration" && !!o.source_url && !!o.last_verified_at && isAccepted(o));
}

export const NOT_HELD = "not held";

/** BE-12's fields, in order, plus the source and the date it was last verified. */
export const OBLIGATION_FIELDS = [
  ["authority", "Authority"],
  ["legal_basis", "Legal basis"],
  ["route", "Route"],
  ["evidence_list", "Evidence"],
  ["fee", "Fee"],
  ["lead_time_days", "Lead time"],
  ["renewal_cycle", "Renewal cycle"],
  ["submission_language", "Submission language"],
  ["source_url", "Source"],
  ["last_verified_at", "Last verified"],
] as const satisfies readonly (readonly [keyof ObligationRow, string])[];

export type ObligationField = { key: (typeof OBLIGATION_FIELDS)[number][0]; label: string; value: string; held: boolean };

/** The evidence list's items as stored: strings, or a short JSON of anything else. Nothing is interpreted. */
export function evidenceItems(list: unknown): string[] | null {
  if (list === null || list === undefined) return null;
  if (!Array.isArray(list)) return [typeof list === "string" ? list : JSON.stringify(list)];
  return list.map((i) => (typeof i === "string" ? i : JSON.stringify(i)));
}

function blank(v: string | null | undefined): boolean {
  return v === null || v === undefined || v.trim() === "";
}

/** Every field, with "not held" for a missing one rather than a blank (BE-12, G01.main). */
export function obligationFields(o: ObligationRow): ObligationField[] {
  return OBLIGATION_FIELDS.map(([key, label]) => {
    let value: string | null;
    if (key === "evidence_list") {
      const items = evidenceItems(o.evidence_list);
      value = items && items.length ? items.join("; ") : null;
    } else if (key === "lead_time_days") {
      value = o.lead_time_days === null ? null : `${o.lead_time_days} day${o.lead_time_days === 1 ? "" : "s"}`;
    } else {
      value = o[key];
    }
    return blank(value) ? { key, label, value: NOT_HELD, held: false } : { key, label, value: value!, held: true };
  });
}

export type Checklist =
  | { kind: "not_assessed" }
  /**
   * Items from the obligation's stored evidence list. How an item matches a workspace document is not specified
   * (#54 Q6), so no item is ever marked as met: each one names itself and says it was not matched.
   */
  | { kind: "listed"; items: string[] };

/** G02: a read-only checklist, computed on read. No eligible obligation, or no stored list: not assessed. */
export function checklist(obligation: ObligationRow | null): Checklist {
  const items = obligation ? evidenceItems(obligation.evidence_list) : null;
  if (!obligation || !items || items.length === 0) return { kind: "not_assessed" };
  return { kind: "listed", items };
}

// G03: recording a registration through app.record_registration.

export type RecordRefusal = "no-permission" | "no-market" | "invalid" | "error";

const CODES: Record<string, RecordRefusal> = { "42501": "no-permission", P0002: "no-market", "22023": "invalid" };

/** The RPC's error code as a refusal; anything else is an unexpected error (reported to Sentry by the action). */
export function recordRefusal(code: string | null | undefined): RecordRefusal {
  return (code && CODES[code]) || "error";
}

export const RECORD_REFUSAL: Record<RecordRefusal, string> = {
  "no-permission": "Your role cannot record a registration for this market. An editor with this market in scope, or an admin, can.",
  "no-market": "This product is not sold in this market, so no registration can be recorded for it here.",
  invalid: "The registration was not recorded: it needs its number and its date, an expiry date (if any) on or after that date, and an evidence document from this workspace.",
  error: "The registration was not recorded. Nothing was changed; try again.",
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RecordInput = { number: string; registeredOn: string; expiresAt: string | null; evidenceDoc: string | null };

/** The form's values, checked before the RPC sees them (the RPC checks again). null when they cannot be recorded. */
export function readRecordInput(v: { number: string; registeredOn: string; expiresAt: string; evidenceDoc: string }): RecordInput | null {
  const number = v.number.trim();
  const registeredOn = v.registeredOn.trim();
  const expiresAt = v.expiresAt.trim() || null;
  const evidenceDoc = v.evidenceDoc.trim() || null;
  if (!number || number.length > 200 || !DAY.test(registeredOn) || Number.isNaN(Date.parse(registeredOn))) return null;
  if (expiresAt !== null && (!DAY.test(expiresAt) || Number.isNaN(Date.parse(expiresAt)) || expiresAt < registeredOn)) return null;
  if (evidenceDoc !== null && !UUID.test(evidenceDoc)) return null;
  return { number, registeredOn, expiresAt, evidenceDoc };
}
