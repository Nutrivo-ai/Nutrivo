// T-103: what the server reads about the signed-in person to decide where they may go next. Reads only, under the
// person's own session (RLS); nothing here writes.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { ONBOARDING } from "@/lib/onboarding/rules";
import { readMemberships, ShellReadError } from "@/lib/workspace/memberships";
import { mfaGate, type MfaGate } from "./rules";

type Client = SupabaseClient<Database>;

/** The person row of the signed-in user, or null when they have not created or joined a workspace yet. */
async function personId(supabase: Client, userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .schema("app")
    .from("people")
    .select("id")
    .eq("user_id", userId)
    .is("tombstoned_at", null)
    .maybeSingle();
  if (error) throw new ShellReadError("the person", error);
  return data?.id ?? null;
}

/** True when the person holds an unrevoked signing grant in a workspace they are still in (RLS hides the rest). */
export async function holdsSigningGrant(supabase: Client, userId: string): Promise<boolean> {
  const person = await personId(supabase, userId);
  if (!person) return false;
  const { count, error } = await supabase
    .schema("app")
    .from("signing_grants")
    .select("id", { count: "exact", head: true })
    .eq("person_id", person)
    .is("revoked_at", null);
  if (error) throw new ShellReadError("signing grants", error);
  return (count ?? 0) > 0;
}

/** A02 step 4: whether this session must prove or enrol a second factor before it reaches a workspace. */
export async function sessionGate(supabase: Client, userId: string): Promise<MfaGate> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw new ShellReadError("the assurance level", { message: error.message, code: error.code });
  // With a verified factor the grant cannot change the answer, so it is read only for people without one.
  return mfaGate(data, data.nextLevel !== "aal2" && (await holdsSigningGrant(supabase, userId)));
}

/**
 * Where a signed-in person lands when no page was asked for: their first workspace by name. A person with no person
 * row or no live membership goes to /onboarding (A01 step 2: a confirmed account without a workspace creates one
 * there), which forwards anyone past onboarding back here, so the two never loop.
 */
export async function landingPath(supabase: Client, userId: string): Promise<string> {
  const person = await personId(supabase, userId);
  if (!person) return ONBOARDING;
  const memberships = await readMemberships(supabase, person);
  return memberships[0] ? `/w/${memberships[0].workspaceId}` : ONBOARDING;
}
