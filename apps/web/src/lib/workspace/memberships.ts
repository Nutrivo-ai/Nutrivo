// N02: the person's active memberships, read under their own session (RLS). Nothing here writes, so switching
// workspace changes the route, and with it the context, and nothing else.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { isRole, type Role } from "@/lib/shell/routes";

export type WorkspaceMembership = {
  workspaceId: string;
  name: string;
  role: Role;
  /** Purchased regulatory regions (EU, UK, US), shown under the wordmark. */
  regions: string[];
};

export type ShellContext =
  | { kind: "signed-out" }
  | { kind: "member"; person: { id: string; name: string }; memberships: WorkspaceMembership[]; current: WorkspaceMembership }
  /**
   * The workspace is not one of the person's. RLS returns nothing for a workspace that exists and for one that does
   * not, so the two read the same and the screen never tells a stranger whether a workspace exists.
   */
  | { kind: "no-access"; person: { id: string; name: string }; memberships: WorkspaceMembership[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ShellReadError extends Error {
  constructor(what: string, cause: { message: string; code?: string }) {
    super(`could not read ${what}: ${cause.code ?? "error"} ${cause.message}`);
    this.name = "ShellReadError";
  }
}

type Client = SupabaseClient<Database>;

/**
 * The person's active memberships, sorted by workspace name. Ended memberships are filtered here; memberships past
 * access_ends_at are already invisible through RLS (private.is_member).
 */
export async function readMemberships(supabase: Client, personId: string): Promise<WorkspaceMembership[]> {
  const { data, error } = await supabase
    .schema("app")
    .from("memberships")
    .select("workspace_id, role, workspaces(name, entitled_regions)")
    .eq("person_id", personId)
    .is("ended_at", null);
  if (error) throw new ShellReadError("memberships", error);
  return (data ?? [])
    .flatMap((row) => {
      const workspace = row.workspaces;
      if (!workspace || !isRole(row.role)) return [];
      return [{ workspaceId: row.workspace_id, name: workspace.name, role: row.role, regions: workspace.entitled_regions }];
    })
    .sort((a, b) => a.name.localeCompare(b.name, "en") || a.workspaceId.localeCompare(b.workspaceId));
}

/** Everything the shell needs for /w/<workspaceId>, in two reads. Throws ShellReadError when a read fails. */
export async function loadShellContext(supabase: Client, workspaceId: string): Promise<ShellContext> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return { kind: "signed-out" };

  const { data: person, error } = await supabase
    .schema("app")
    .from("people")
    .select("id, display_name")
    .eq("user_id", auth.user.id)
    .is("tombstoned_at", null)
    .maybeSingle();
  if (error) throw new ShellReadError("the person", error);
  // Signed in, but no person yet: nobody has created or joined a workspace with this account.
  if (!person) return { kind: "no-access", person: { id: "", name: auth.user.email ?? "" }, memberships: [] };

  const who = { id: person.id, name: person.display_name };
  const memberships = await readMemberships(supabase, person.id);
  const current = UUID.test(workspaceId)
    ? memberships.find((m) => m.workspaceId === workspaceId.toLowerCase())
    : undefined;
  return current ? { kind: "member", person: who, memberships, current } : { kind: "no-access", person: who, memberships };
}
