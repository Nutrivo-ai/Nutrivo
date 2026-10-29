import { DPA } from "./dpa";
import { PRIVACY } from "./privacy";
import { TERMS } from "./terms";
import type { LegalDoc } from "./types";

// The three documents of the Legal design file, in the order its header tabs draw them (const DOCS and ORDER there).
export const LEGAL_DOCS = { terms: TERMS, dpa: DPA, privacy: PRIVACY } as const satisfies Record<string, LegalDoc>;
export type LegalKey = keyof typeof LEGAL_DOCS;
export const LEGAL_ORDER: LegalKey[] = ["terms", "dpa", "privacy"];

export const isLegalKey = (key: string): key is LegalKey => Object.hasOwn(LEGAL_DOCS, key);

export type { LegalDoc } from "./types";
