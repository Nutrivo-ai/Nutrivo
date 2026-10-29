// S-WSS-001 People and roles (T-107; A03, A05, A06). Everything the screen shows, read under the admin's own session
// (RLS: memberships and people to members, invitations to admins), and the pure wording of each row. Nothing here
// writes: changes go through the RPCs in actions.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { isRole, type Role } from "@/lib/shell/routes";

type Client = SupabaseClient<Database>;

/** The design's role names, as the People table and the "Four roles" card write them. */
export const ROLE_TITLE: Record<Role, string> = {
  admin: "Admin",
  portfolio_manager: "Portfolio manager",
  editor: "Editor",
  viewer: "Viewer",
};

/** Admin first, as the design lists them. */
export const ROLES_DESC: Role[] = ["admin", "portfolio_manager", "editor", "viewer"];

/** BE-33: admins, portfolio managers and editors use an editor seat; viewers never do, external or not (A03.must.3). */
export const usesSeat = (role: Role) => role !== "viewer";

export type Scope = {
  familyIds: string[] | null;
  nodeIds: string[] | null;
  endsAt: string | null;
};

export type MemberRow = {
  kind: "member";
  id: string;
  personId: string;
  name: string;
  email: string | null;
  role: Role;
  external: boolean;
  scope: Scope;
  since: string;
  lastActive: string | null;
};

export type InvitationRow = {
  kind: "invitation";
  id: string;
  email: string;
  role: Role;
  external: boolean;
  scope: Scope;
  sentAt: string;
  expiresAt: string;
};

export type Family = { id: string; name: string };
export type Market = { id: string; name: string; parentId: string | null };

export type PeopleData = {
  members: MemberRow[];
  invitations: InvitationRow[];
  /** app.subscriptions.editor_seats; null means no seat check on this plan. */
  editorSeats: number | null;
  families: Family[];
  markets: Market[];
  /** The workspace's purchased regions: the markets a scope can name. */
  regions: string[];
};

export class PeopleReadError extends Error {
  constructor(what: string, cause: { message: string; code?: string }) {
    super(`could not read ${what}: ${cause.code ?? "error"} ${cause.message}`);
    this.name = "PeopleReadError";
  }
}

/** True while the membership still gives access: not ended, and its end date (if any) not passed. */
export function isActive(scope: Scope, now: Date = new Date()) {
  return scope.endsAt === null || new Date(scope.endsAt) > now;
}

/** Every read the screen needs. The person's last activity is their latest audit event here (sign-ins are audited). */
export async function readPeople(supabase: Client, workspaceId: string, regions: string[]): Promise<PeopleData> {
  const app = supabase.schema("app");
  const [members, invitations, subscription, families, markets] = await Promise.all([
    app
      .from("memberships")
      .select("id, person_id, role, is_external, scope_family_ids, scope_node_ids, access_ends_at, created_at, people(display_name, email)")
      .eq("workspace_id", workspaceId)
      .is("ended_at", null)
      .order("created_at"),
    app
      .from("invitations")
      .select("id, email, role, is_external, scope_family_ids, scope_node_ids, access_ends_at, expires_at, created_at")
      .eq("workspace_id", workspaceId)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .order("created_at"),
    app.from("subscriptions").select("editor_seats").eq("workspace_id", workspaceId).maybeSingle(),
    app.from("families").select("id, name").eq("workspace_id", workspaceId).is("discontinued_at", null).order("name"),
    supabase.schema("ref").from("jurisdictions").select("id, name, parent_id").order("id"),
  ]);
  if (members.error) throw new PeopleReadError("memberships", members.error);
  if (invitations.error) throw new PeopleReadError("invitations", invitations.error);
  if (subscription.error) throw new PeopleReadError("the subscription", subscription.error);
  if (families.error) throw new PeopleReadError("families", families.error);
  if (markets.error) throw new PeopleReadError("markets", markets.error);

  const personIds = [...new Set(members.data.map((m) => m.person_id))];
  const last = await Promise.all(
    personIds.map(async (id) => {
      const { data, error } = await app
        .from("audit_events")
        .select("at")
        .eq("workspace_id", workspaceId)
        .eq("actor_id", id)
        .order("at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new PeopleReadError("activity", error);
      return [id, data?.at ?? null] as const;
    }),
  );
  const lastActive = new Map(last);

  return {
    members: members.data.flatMap((m) =>
      isRole(m.role)
        ? [
            {
              kind: "member" as const,
              id: m.id,
              personId: m.person_id,
              name: m.people?.display_name ?? m.people?.email ?? "",
              email: m.people?.email ?? null,
              role: m.role,
              external: m.is_external,
              scope: { familyIds: m.scope_family_ids, nodeIds: m.scope_node_ids, endsAt: m.access_ends_at },
              since: m.created_at,
              lastActive: lastActive.get(m.person_id) ?? null,
            },
          ]
        : [],
    ),
    invitations: invitations.data.flatMap((i) =>
      isRole(i.role)
        ? [
            {
              kind: "invitation" as const,
              id: i.id,
              email: i.email,
              role: i.role,
              external: i.is_external,
              scope: { familyIds: i.scope_family_ids, nodeIds: i.scope_node_ids, endsAt: i.access_ends_at },
              sentAt: i.created_at,
              expiresAt: i.expires_at,
            },
          ]
        : [],
    ),
    editorSeats: subscription.data?.editor_seats ?? null,
    families: families.data,
    markets: markets.data
      .map((j) => ({ id: j.id, name: j.name, parentId: j.parent_id }))
      .filter((j) => regions.includes(j.parentId ?? j.id)),
    regions,
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export type SeatCount = { used: number; seats: number | null; viewers: number; external: number };

/** Who counts against the plan: active members only; a pending invitation claims no seat until it is accepted. */
export function seatCount(members: MemberRow[], editorSeats: number | null, now: Date = new Date()): SeatCount {
  const active = members.filter((m) => isActive(m.scope, now));
  return {
    used: active.filter((m) => usesSeat(m.role)).length,
    seats: editorSeats,
    viewers: active.filter((m) => !usesSeat(m.role)).length,
    external: active.filter((m) => m.external).length,
  };
}

/** "4 OF 5 EDITOR SEATS USED · 2 VIEWERS, FREE · 2 EXTERNAL", as the table's heading writes it. */
export function seatLine(c: SeatCount): string {
  const used =
    c.seats === null ? `${plural(c.used, "EDITOR SEAT").toUpperCase()} USED · NO SEAT LIMIT` : `${c.used} OF ${c.seats} EDITOR SEATS USED`;
  return [used, `${plural(c.viewers, "VIEWER")}, FREE`.toUpperCase(), `${c.external} EXTERNAL`].join(" · ");
}

/** The header chip: "4 OF 5 EDITOR SEATS". */
export function seatChip(c: SeatCount): string {
  return c.seats === null ? plural(c.used, "EDITOR SEAT").toUpperCase() : `${c.used} OF ${c.seats} EDITOR SEATS`;
}

// Written out rather than Intl: ICU's en-GB writes "Sept", the design writes "Sep".
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "31 Dec 2026", in UTC. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * The scope column: "The whole workspace" for an unscoped admin, "Every recipe and market" for an unscoped portfolio
 * manager or editor, "Reads answers and reports" for an unscoped viewer; a scope names its recipes and markets, and an
 * end date ("until 31 Dec 2026"). An external person without one reads "no end date", as the design writes it.
 */
export function scopeText(
  role: Role,
  external: boolean,
  scope: Scope,
  families: Family[],
  markets: Market[],
  now: Date = new Date(),
): string {
  const parts: string[] = [];
  if (scope.familyIds) {
    const names = scope.familyIds.map((id) => families.find((f) => f.id === id)?.name).filter(Boolean) as string[];
    parts.push(scope.familyIds.length === 1 && names.length === 1 ? names[0] : plural(scope.familyIds.length, "recipe"));
  }
  if (scope.nodeIds) {
    // A region id has no parent ("EU"); a market under it reads as the design writes nodes ("EU · DE").
    const isRegion = (id: string) => (markets.find((m) => m.id === id)?.parentId ?? null) === null && !id.includes("-");
    const ids = scope.nodeIds;
    if (ids.length <= 2 && ids.every(isRegion)) parts.push(`${ids.join(" and ")} markets only`);
    else if (ids.length <= 2) parts.push(ids.map((id) => id.replace("-", " · ")).join(", "));
    else parts.push(plural(ids.length, "market"));
  }
  if (parts.length === 0) {
    parts.push(
      role === "admin" ? "The whole workspace" : role === "viewer" ? "Reads answers and reports" : "Every recipe and market",
    );
  }
  if (scope.endsAt) {
    parts.push(new Date(scope.endsAt) > now ? `until ${formatDate(scope.endsAt)}` : `access ended ${formatDate(scope.endsAt)}`);
  } else if (external) {
    parts.push("no end date");
  }
  return parts.join(" · ");
}

/** "Just now", "12 min ago", "5 hours ago", "Yesterday", "3 days ago", "2 weeks ago", then the date. */
export function relativeTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "Not yet";
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 2) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${plural(hours, "hour")} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return formatDate(iso);
}

/** The last admin can never be removed or demoted (A05.must.1): true when `member` is the only active admin. */
export function isLastAdmin(member: MemberRow, members: MemberRow[], now: Date = new Date()): boolean {
  if (member.role !== "admin" || !isActive(member.scope, now)) return false;
  return !members.some((m) => m.id !== member.id && m.role === "admin" && m.scope.endsAt === null);
}
