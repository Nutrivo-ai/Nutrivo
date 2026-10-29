import { People } from "@/components/settings/People";
import { readPeople } from "@/lib/settings/people";
import { createClient } from "@/lib/supabase/server";

// S-WSS-001 People and roles (spec/screens.yaml; design: product/Nutrivo Workspace Settings.dc.html, screen "people").
// A03, A05, A06 (T-107). Every read is under the person's session; a failed read goes to the workspace error
// boundary, and loading.tsx covers the wait. A person below admin gets the no-permission state from the screen.
export default async function Page({ params }: PageProps<"/w/[workspace]/settings/people">) {
  const { workspace } = await params;
  const supabase = await createClient();
  const { data: ws } = await supabase.schema("app").from("workspaces").select("entitled_regions").eq("id", workspace).maybeSingle();
  const data = await readPeople(supabase, workspace, ws?.entitled_regions ?? []);
  return <People workspaceId={workspace} data={data} now={new Date().toISOString()} />;
}
