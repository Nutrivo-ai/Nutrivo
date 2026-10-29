import { WorkspaceSettings, type Operator } from "@/components/settings/WorkspaceSettings";
import { createClient } from "@/lib/supabase/server";
import { ShellReadError } from "@/lib/workspace/memberships";

// S-WSS-003 Workspace (spec/screens.yaml; design: product/Nutrivo Workspace Settings.dc.html, screen "workspace").
// B01 (T-107). Reads under the person's session; a failed read goes to the workspace error boundary.
export default async function Page({ params }: PageProps<"/w/[workspace]/settings/workspace">) {
  const { workspace } = await params;
  const supabase = await createClient();
  const [ws, markets, discontinued] = await Promise.all([
    supabase.schema("app").from("workspaces").select("id, name, entitled_regions, default_operator").eq("id", workspace).single(),
    supabase.schema("ref").from("jurisdictions").select("id, parent_id").not("parent_id", "is", null),
    supabase
      .schema("app")
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace)
      .eq("stage", "discontinued"),
  ]);
  if (ws.error) throw new ShellReadError("the workspace", ws.error);
  if (markets.error) throw new ShellReadError("markets", markets.error);
  if (discontinued.error) throw new ShellReadError("discontinued recipes", discontinued.error);
  const regions = ws.data.entitled_regions;
  return (
    <WorkspaceSettings
      route="/w/[workspace]/settings/workspace"
      view={{
        id: ws.data.id,
        name: ws.data.name,
        regions,
        operator: (ws.data.default_operator as Operator | null) ?? null,
        marketsInReach: markets.data.filter((m) => regions.includes(m.parent_id ?? "")).length,
        discontinued: discontinued.count ?? 0,
      }}
    />
  );
}
