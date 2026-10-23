// The reserved verdict vocabulary (Cobalt specification §2, docs/10): four states, no fifth. Each state's colour
// serves its glyph and its label and appears nowhere else; the accent never stands for a state.
export const VERDICT_STATES = ["clear", "action", "not_assessed", "blocked"] as const;
export type VerdictState = (typeof VERDICT_STATES)[number];

export const STATE_LABEL: Record<VerdictState, string> = {
  clear: "Clear",
  action: "Action needed",
  not_assessed: "Not assessed",
  blocked: "Blocked",
};

// Literal class names, so Tailwind sees every one of them.
export const STATE_TEXT: Record<VerdictState, string> = {
  clear: "text-clear",
  action: "text-action",
  not_assessed: "text-na",
  blocked: "text-blocked",
};

export const STATE_TINT: Record<VerdictState, string> = {
  clear: "bg-clear-bg",
  action: "bg-action-bg",
  not_assessed: "bg-na-bg",
  blocked: "bg-blocked-bg",
};

export const STATE_BORDER: Record<VerdictState, string> = {
  clear: "border-clear",
  action: "border-action",
  not_assessed: "border-na",
  blocked: "border-blocked",
};

// check_findings.provenance (docs/03). Provenance stays typographic (Cobalt §6): mono labels, never tinted.
export const PROVENANCES = ["deterministic_rule", "model_judgement", "authored_definition", "not_assessed"] as const;
export type Provenance = (typeof PROVENANCES)[number];

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  deterministic_rule: "Deterministic rule",
  model_judgement: "Model judgement",
  authored_definition: "Authored definition",
  not_assessed: "Not assessed",
};

// Withheld reason codes (docs/03); every one resolves to a coverage gap (docs/04 contract 4).
export type WithheldReason =
  | "not_encoded"
  | "partially_encoded"
  | "out_of_scope"
  | "pending_acceptance"
  | "outlined_text"
  | "rasterised"
  | "missing_font"
  | "colour_space"
  | "no_true_scale"
  | "unreadable"
  | "data_missing"
  | "model_abstained"
  | "model_unavailable";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
