// T-106: where /onboarding picks up for the signed-in person. Reads only, under their own session (RLS).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { ShellReadError } from "@/lib/workspace/memberships";

type Client = SupabaseClient<Database>;

export type Picked =
  | { step: 2 }
  | { step: 3; workspaceId: string; workspaceName: string }
  | { step: "done" };

/**
 * No workspace yet → step 02. The workspace this person created and administers, with no operator yet → step 03.
 * Anything else (an operator set, or a person who only joined others' workspaces) is past onboarding.
 */
export async function pickStep(supabase: Client, userId: string): Promise<Picked> {
  const { data: person, error } = await supabase
    .schema("app")
    .from("people")
    .select("id")
    .eq("user_id", userId)
    .is("tombstoned_at", null)
    .maybeSingle();
  if (error) throw new ShellReadError("the person", error);
  if (!person) return { step: 2 };
  const { data, error: read } = await supabase
    .schema("app")
    .from("memberships")
    .select("workspace_id, role, workspaces!inner(name, default_operator, created_by)")
    .eq("person_id", person.id)
    .is("ended_at", null);
  if (read) throw new ShellReadError("memberships", read);
  if (!data || data.length === 0) return { step: 2 };
  const own = data.find((m) => m.role === "admin" && m.workspaces.created_by === person.id && m.workspaces.default_operator === null);
  return own ? { step: 3, workspaceId: own.workspace_id, workspaceName: own.workspaces.name } : { step: "done" };
}
