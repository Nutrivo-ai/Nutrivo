// S-WSS-005 Audit log (T-108; O02). app.audit_events read under the person's own session: RLS (`read_managers`) lets
// only admins and portfolio managers of the workspace read it, and the table is insert-only (BE-05), so nothing here
// writes. Each row is shown from what was stored when it was written. In particular "external" is the
// actor_is_external flag stamped at write time (contract 7), never the person's membership today, so external work
// reads as external forever (O02.must.1).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { isRole } from "@/lib/shell/routes";
import { ROLE_TITLE } from "./people";

type Client = SupabaseClient<Database>;

export const PAGE_SIZE = 50;

/** The design's filters, in its order. The mapping to kinds is the one stated on issue #30 (question 3). */
export const FILTERS = [
  { key: "all", label: "All events", prefixes: [] },
  { key: "checks", label: "Checks", prefixes: ["check."] },
  { key: "documents", label: "Documents", prefixes: ["document.", "supplier_document."] },
  { key: "access", label: "People and access", prefixes: ["membership.", "invitation.", "session.", "access."] },
  { key: "certificates", label: "Certificates", prefixes: ["certificate."] },
] as const;

export type FilterKey = (typeof FILTERS)[number]["key"];

export function filterKey(value: string | string[] | undefined): FilterKey {
  const v = Array.isArray(value) ? value[0] : value;
  return FILTERS.find((f) => f.key === v)?.key ?? "all";
}

/** A positive event id to read below, or null for the newest page. */
export function cursor(value: string | string[] | undefined): number | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v && /^[1-9][0-9]{0,17}$/.test(v) ? Number(v) : null;
}

export type KindTone = "accent" | "n600" | "action" | "clear";

/** The design's KIND column: a word per family of kinds, coloured as the design colours it. */
const KIND_LABEL: [prefix: string, label: string, tone: KindTone][] = [
  ["check.", "CHECK", "accent"],
  ["report.", "REPORT", "accent"],
  ["certificate.", "CERTIFICATE", "clear"],
  ["artwork.", "ARTWORK", "n600"],
  ["allowance.", "ARTWORK", "n600"],
  ["classification.", "CLASSIFICATION", "n600"],
  ["document.", "DOCUMENT", "n600"],
  ["supplier_document.", "DOCUMENT", "n600"],
  ["product.", "RECIPE", "n600"],
  ["family.", "RECIPE", "n600"],
  ["membership.", "ACCESS", "action"],
  ["invitation.", "ACCESS", "action"],
  ["session.", "ACCESS", "action"],
  ["access.", "ACCESS", "action"],
  ["ruleset.", "RULESET", "action"],
  ["workspace.", "WORKSPACE", "n600"],
  ["export.", "EXPORT", "n600"],
  ["billing.", "BILLING", "n600"],
];

export function kindLabel(kind: string): { label: string; tone: KindTone } {
  const hit = KIND_LABEL.find(([prefix]) => kind.startsWith(prefix));
  return hit ? { label: hit[1], tone: hit[2] } : { label: (kind.split(".")[0] || kind).toUpperCase(), tone: "n600" };
}

export type AuditRow = {
  id: number;
  at: string;
  kind: string;
  objectType: string | null;
  objectId: string | null;
  before: Json | null;
  after: Json | null;
  rulesetVersion: string | null;
  actorId: string | null;
  /** The person's name as they appear in this workspace, or null when no person (the system) or none is readable. */
  actorName: string | null;
  /** Stamped when the event was written (contract 7). */
  actorIsExternal: boolean;
};

export type AuditEvent = {
  id: number;
  at: string;
  when: string;
  kind: string;
  label: string;
  tone: KindTone;
  what: string;
  who: string;
  external: boolean;
};

export type AuditPage = {
  filter: FilterKey;
  events: AuditEvent[];
  /** Events under the filter, all pages. */
  total: number;
  /** The earliest event under the filter, or null when there is none. */
  since: string | null;
  /** The id to read below for the next (older) page, or null when this is the last. */
  older: number | null;
  /** True when this is not the newest page. */
  paged: boolean;
};

export class AuditReadError extends Error {
  constructor(what: string, cause: { message: string; code?: string }) {
    super(`could not read ${what}: ${cause.code ?? "error"} ${cause.message}`);
    this.name = "AuditReadError";
  }
}

// Written out rather than Intl: ICU's en-GB writes "Sept", the design writes "Sep".
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** "4 Sep · 09:41" as the design writes it, in UTC; the year is added when it is not the current one. */
export function formatWhen(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const year = d.getUTCFullYear() === now.getUTCFullYear() ? "" : ` ${d.getUTCFullYear()}`;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year} · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** "4 MAY 2026", for the count line. */
export function formatSince(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].toUpperCase()} ${d.getUTCFullYear()}`;
}

/** "2,418 EVENTS · SINCE 4 MAY 2026" */
export function countLine(total: number, since: string | null): string {
  const n = `${total.toLocaleString("en-GB")} ${total === 1 ? "EVENT" : "EVENTS"}`;
  return since ? `${n} · SINCE ${formatSince(since)}` : n;
}

/** "Johanna Holm" becomes "J. Holm", as the design's Who column writes people. */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2 || name.includes("@")) return name.trim();
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

/** The Who column: the actor, marked external when the event was stamped so, or System when no person acted. */
export function whoText(row: Pick<AuditRow, "actorId" | "actorName" | "actorIsExternal">): string {
  if (!row.actorId) return "System";
  const name = row.actorName ? shortName(row.actorName) : "A former member";
  return row.actorIsExternal ? `${name} (external)` : name;
}

type Obj = Record<string, Json | undefined>;
const obj = (v: Json | null | undefined): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: Json | undefined): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const list = (v: Json | undefined): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const node = (id: string) => id.replace("-", " · ");
const nodes = (ids: string[]) => (ids.length <= 3 ? ids.map(node).join(", ") : plural(ids.length, "market"));
const role = (v: Json | undefined) => {
  const r = str(v);
  return r && isRole(r) ? ROLE_TITLE[r].toLowerCase() : (r ?? "member");
};
const STAGE: Record<string, string> = {
  brief: "brief",
  in_development: "in development",
  active: "active",
  discontinued: "discontinued",
};
const stage = (v: Json | undefined) => STAGE[str(v) ?? ""] ?? str(v) ?? "unknown";
const date = (v: Json | undefined) => {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/** What changed in a membership, from the stored before and after (membership.changed). */
function membershipChange(before: Obj, after: Obj): string[] {
  const parts: string[] = [];
  if (before.role !== after.role) parts.push(`role ${role(before.role)} → ${role(after.role)}`);
  if (before.is_external !== after.is_external) parts.push(after.is_external ? "now external" : "now internal");
  const scope = (o: Obj) => JSON.stringify([o.scope_family_ids ?? null, o.scope_node_ids ?? null]);
  if (scope(before) !== scope(after)) parts.push("scope changed");
  if (before.access_ends_at !== after.access_ends_at) {
    const ends = date(after.access_ends_at);
    parts.push(ends ? `access ends ${ends}` : "no end date");
  }
  const revoked = typeof after.signing_grants_revoked === "number" ? after.signing_grants_revoked : 0;
  if (revoked > 0) parts.push(`${plural(revoked, "signing grant")} revoked`);
  return parts;
}

/**
 * The "What happened" sentence, from the stored row only: its kind, object, before and after, and ruleset version.
 * Nothing is looked up again, so a sentence reads the same however the records changed since. `names` gives the
 * readable names of people a membership event is about. An unknown kind reads as itself.
 */
export function whatText(row: Pick<AuditRow, "kind" | "before" | "after" | "rulesetVersion">, names: Map<string, string> = new Map()): string {
  const b = obj(row.before);
  const a = obj(row.after);
  const ruleset = row.rulesetVersion ? ` against ruleset ${row.rulesetVersion}` : "";
  const subject = (o: Obj) => {
    const id = str(o.person_id);
    return (id && names.get(id)) ?? "A member";
  };
  const ext = (v: Json | undefined) => (v === true ? " (external)" : "");
  switch (row.kind) {
    case "check.completed": {
      const markets = Object.keys(obj(a.label_states));
      const checks = list(a.check_ids).length;
      const scope = markets.length ? ` for ${nodes(markets)}` : "";
      return `Label checked${ruleset}${scope}${checks ? ` · ${plural(checks, "panel check")}` : ""}`;
    }
    case "report.generated":
      return `Report ${str(a.ref) ?? ""} generated${ruleset}`.replace("  ", " ");
    case "certificate.issued":
      return `Certificate of Check issued${str(a.node) ? ` for ${node(str(a.node)!)}` : ""}${ruleset}`;
    case "artwork.registered": {
      const v = typeof a.version === "number" ? ` v${a.version}` : "";
      return `Artwork${v} uploaded${a.is_new_artwork === true ? " · a new artwork" : ""}`;
    }
    case "allowance.consumed":
      return "One label of the plan's allowance used";
    case "classification.confirmed": {
      const edited = list(a.edited).length;
      return edited ? `Classification confirmed · ${plural(edited, "field")} edited` : "Classification confirmed as suggested";
    }
    case "product.created":
      return `Recipe ${str(a.name) ?? ""} created${a.source === "artwork" ? " from an artwork" : ""}`.replace("  ", " ");
    case "product.markets_added": {
      const added = list(a.nodes);
      return `${plural(added.length, "market")} added to a recipe${added.length ? `: ${nodes(added)}` : ""}`;
    }
    case "product.stage_changed": {
      const reason = str(a.reason);
      return `Recipe moved from ${stage(b.stage)} to ${stage(a.stage)}${reason ? ` · ${reason}` : ""}`;
    }
    case "family.created":
      return `Recipe family ${str(a.name) ?? ""} created`.replace("  ", " ");
    case "workspace.created":
      return `Workspace ${str(a.name) ?? ""} created`.replace("  ", " ");
    case "workspace.default_operator_set":
      return `Default responsible operator set to ${str(a.name) ?? "a new operator"}`;
    case "invitation.sent":
      return `${str(a.email) ?? "A person"}${ext(a.is_external)} invited as ${role(a.role)}`;
    case "invitation.resent":
      return `Invitation to ${str(a.email) ?? "a person"} sent again`;
    case "invitation.revoked":
      return `Invitation to ${str(b.email) ?? "a person"} revoked`;
    case "membership.created":
      return `Accepted an invitation as ${role(a.role)}${ext(a.is_external)}`;
    case "membership.changed": {
      const parts = membershipChange(b, a);
      return `${subject(a)}: ${parts.length ? parts.join(" · ") : "access saved unchanged"}`;
    }
    case "membership.ended": {
      const reason = str(a.ended_reason);
      return `${subject(b)} removed from the workspace${reason ? ` · ${reason}` : ""}`;
    }
    case "session.started":
      return a.aal === "aal2" ? "Signed in with two-step verification" : "Signed in";
    case "access.password_changed":
      return "Password changed";
    case "export.requested":
      return "Full export of the workspace requested";
    case "billing.event_received":
      return `Billing event received${str(a.type) ? ` · ${str(a.type)}` : ""}`;
    case "billing.subscription_synced": {
      const parts: string[] = [];
      if (b.plan !== a.plan) parts.push(`plan ${str(b.plan) ?? "none"} → ${str(a.plan) ?? "none"}`);
      if (b.subscription_status !== a.subscription_status) parts.push(`status ${str(a.subscription_status) ?? "none"}`);
      return `Subscription updated${parts.length ? ` · ${parts.join(" · ")}` : ""}`;
    }
    default:
      return row.kind;
  }
}

/** One row of the table. */
export function toEvent(row: AuditRow, names: Map<string, string>, now: Date = new Date()): AuditEvent {
  const { label, tone } = kindLabel(row.kind);
  return {
    id: row.id,
    at: row.at,
    when: formatWhen(row.at, now),
    kind: row.kind,
    label,
    tone,
    what: whatText(row, names),
    who: whoText(row),
    external: row.actorIsExternal,
  };
}

/** PostgREST `or` for a filter's prefixes, or null for every kind. */
export function kindFilter(filter: FilterKey): string | null {
  const prefixes = FILTERS.find((f) => f.key === filter)!.prefixes as readonly string[];
  return prefixes.length ? prefixes.map((p) => `kind.like.${p}*`).join(",") : null;
}

/** One page of the log, newest first, with the count line and the cursor for the next page. */
export async function readAudit(
  supabase: Client,
  workspaceId: string,
  filter: FilterKey,
  before: number | null,
  now: Date = new Date(),
): Promise<AuditPage> {
  const app = supabase.schema("app");
  const or = kindFilter(filter);

  let page = app
    .from("audit_events")
    .select("id, at, kind, object_type, object_id, before, after, ruleset_version, actor_id, actor_is_external, people(display_name, email)")
    .eq("workspace_id", workspaceId);
  let count = app.from("audit_events").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
  let first = app.from("audit_events").select("at").eq("workspace_id", workspaceId);
  if (or) {
    page = page.or(or);
    count = count.or(or);
    first = first.or(or);
  }
  if (before !== null) page = page.lt("id", before);

  const [rows, total, earliest] = await Promise.all([
    page.order("id", { ascending: false }).limit(PAGE_SIZE + 1),
    count,
    first.order("id", { ascending: true }).limit(1).maybeSingle(),
  ]);
  if (rows.error) throw new AuditReadError("audit events", rows.error);
  if (total.error) throw new AuditReadError("the event count", total.error);
  if (earliest.error) throw new AuditReadError("the first event", earliest.error);

  const shown = rows.data.slice(0, PAGE_SIZE);
  const audit: AuditRow[] = shown.map((r) => ({
    id: r.id,
    at: r.at,
    kind: r.kind,
    objectType: r.object_type,
    objectId: r.object_id,
    before: r.before,
    after: r.after,
    rulesetVersion: r.ruleset_version,
    actorId: r.actor_id,
    actorName: r.people?.display_name ?? r.people?.email ?? null,
    actorIsExternal: r.actor_is_external,
  }));

  // Membership events are about a person other than the actor: read the names RLS lets this admin read.
  const subjects = [
    ...new Set(
      audit
        .filter((r) => r.kind.startsWith("membership."))
        .flatMap((r) => [str(obj(r.after).person_id), str(obj(r.before).person_id)])
        .filter((id): id is string => id !== null),
    ),
  ];
  const names = new Map<string, string>();
  if (subjects.length) {
    const { data, error } = await app.from("people").select("id, display_name, email").in("id", subjects);
    if (error) throw new AuditReadError("people", error);
    for (const p of data) names.set(p.id, p.display_name ?? p.email ?? "A member");
  }

  return {
    filter,
    events: audit.map((r) => toEvent(r, names, now)),
    total: total.count ?? 0,
    since: earliest.data?.at ?? null,
    older: rows.data.length > PAGE_SIZE ? shown[shown.length - 1].id : null,
    paged: before !== null,
  };
}
