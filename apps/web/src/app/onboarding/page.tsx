import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Onboarding } from "@/components/onboarding/Onboarding";
import { CONTINUE } from "@/lib/auth/rules";
import { sessionGate } from "@/lib/auth/session";
import { ONBOARDING, regionCards } from "@/lib/onboarding/rules";
import { pickStep } from "@/lib/onboarding/state";
import { createClient } from "@/lib/supabase/server";
import { ShellReadError } from "@/lib/workspace/memberships";

export const metadata: Metadata = { title: "Create your workspace · Nutrivo" };

// A01 (T-106): one route, the step read from the session. Signed out is step 01 (the account); a confirmed account
// without a workspace is step 02 (where you sell, then app.create_workspace); the workspace the person just created,
// still without an operator, is step 03 (app.set_default_operator). Anyone past that goes on to their workspace.
export default async function OnboardingPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return <Onboarding step={1} />;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return <Onboarding step={1} />;
  if ((await sessionGate(supabase, data.user.id)) !== "ok") redirect(`/auth/mfa?next=${encodeURIComponent(ONBOARDING)}`);

  const picked = await pickStep(supabase, data.user.id);
  if (picked.step === "done") redirect(CONTINUE);
  if (picked.step === 3) return <Onboarding step={3} workspaceId={picked.workspaceId} workspaceName={picked.workspaceName} />;

  const { data: rows, error } = await supabase.schema("ref").from("jurisdictions").select("id, parent_id, node_type, languages");
  if (error) throw new ShellReadError("the regions", error);
  return <Onboarding step={2} regions={regionCards(rows ?? [])} />;
}
