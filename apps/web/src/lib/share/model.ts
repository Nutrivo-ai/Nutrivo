// S-NV2-026 Export, send, share (I01, I02): what the screen shows, without any I/O. The reads are in queries.ts and the
// writes (app.create_share, app.revoke_share) in actions.ts.

export type ShareRow = {
  id: string;
  channel: "link" | "email";
  recipient: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type ShareStatus = "live" | "expired" | "revoked";

/** Revoked wins over expired: a revoked share was stopped by a person, whatever its date. */
export function shareStatus(row: Pick<ShareRow, "expires_at" | "revoked_at">, now: Date = new Date()): ShareStatus {
  if (row.revoked_at) return "revoked";
  if (row.expires_at && Date.parse(row.expires_at) <= now.getTime()) return "expired";
  return "live";
}

/** Expiry choices. 30 days is the design's (U09 "Link settings"); none is allowed because BE-27 makes expiry optional. */
export const EXPIRY_CHOICES: { days: number | null; label: string }[] = [
  { days: 7, label: "7 DAYS" },
  { days: 30, label: "30 DAYS" },
  { days: 90, label: "90 DAYS" },
  { days: null, label: "NEVER" },
];
export const DEFAULT_EXPIRY_DAYS = 30;

export function expiryLabel(days: number | null): string {
  return EXPIRY_CHOICES.find((c) => c.days === days)?.label ?? `${days} DAYS`;
}

/** The same loose shape app.create_share accepts; the database is the judge. */
export function looksLikeEmail(value: string): boolean {
  const v = value.trim();
  return v.length > 0 && v.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
}

/** "2026-08-25 14:08 UTC", as the design prints times. */
export function formatUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
}

/** "sha256 4f1c…9ab2", as the design abbreviates the artwork hash. */
export function shortHash(sha: string): string {
  return sha.length > 12 ? `sha256 ${sha.slice(0, 4)}…${sha.slice(-4)}` : `sha256 ${sha}`;
}

export type PinnedReport = {
  id: string;
  ref: string;
  issuedAt: string;
  rulesetVersion: string;
  artworkSha: string;
  hasNotAssessed: boolean;
  market: string | null;
  languages: string[];
  hasPdf: boolean;
};

/** The design's eight pinned facts (Nutrivo 2.0 `pinFacts`), from the report row: nothing is invented. */
export function pinFacts(r: PinnedReport): { k: string; v: string }[] {
  return [
    { k: "Reference", v: r.ref },
    { k: "Issued", v: formatUtc(r.issuedAt) },
    { k: "Ruleset", v: r.rulesetVersion },
    { k: "Artwork hash", v: shortHash(r.artworkSha) },
    { k: "Nodes reported", v: r.market ?? "—" },
    { k: "Languages", v: r.languages.length ? r.languages.map((l) => l.toUpperCase()).join(" · ") : "—" },
    { k: "Not assessed", v: r.hasNotAssessed ? "Items listed in the report" : "None" },
    { k: "Attested by", v: "Nobody" },
  ];
}

/** One line per share under "Link settings". */
export function shareLine(row: ShareRow, now: Date = new Date()): { who: string; when: string; status: ShareStatus } {
  const status = shareStatus(row, now);
  const who = row.channel === "email" ? (row.recipient ?? "Email") : "Link";
  const when =
    status === "revoked"
      ? `REVOKED ${formatUtc(row.revoked_at!).slice(0, 10)}`
      : status === "expired"
        ? `EXPIRED ${formatUtc(row.expires_at!).slice(0, 10)}`
        : row.expires_at
          ? `UNTIL ${formatUtc(row.expires_at).slice(0, 10)}`
          : "NO EXPIRY";
  return { who, when, status };
}
