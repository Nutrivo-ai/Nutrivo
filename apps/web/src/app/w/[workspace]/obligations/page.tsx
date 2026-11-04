import { Obligations } from "@/components/registration/Obligations";
import { Screen } from "@/components/shell";
import { readObligations, readRegistrationGaps } from "@/lib/registration/queries";
import { roleAllows, routeFor } from "@/lib/shell/routes";
import { createClient } from "@/lib/supabase/server";
import { loadShellContext } from "@/lib/workspace/memberships";

// S-NV2-008 Obligations (spec/screens.yaml), T-504, G01: the workspace's markets and the sourced obligations held for
// each, read under the person's session (RLS). Only a role the screen allows reads anything; anybody else gets the
// no-permission state from Screen. A failed read goes to the workspace error boundary, and loading.tsx covers the wait.
export default async function Page({ params }: PageProps<"/w/[workspace]/obligations">) {
  const { workspace } = await params;
  const db = await createClient();
  const context = await loadShellContext(db, workspace);
  const allowed = context.kind === "member" && roleAllows(context.current.role, routeFor("/w/[workspace]/obligations").role);
  const markets = allowed ? await readObligations(db, context.current.workspaceId) : null;
  const gaps = markets ? await readRegistrationGaps(db, workspace, markets.map((m) => m.nodeId)) : null;
  return (
    <Screen route="/w/[workspace]/obligations" crumb="Portfolio · Obligation register" title="Who must be told, of what, by when">
      {markets && gaps ? (
        <Obligations workspaceId={workspace} markets={markets.map((m) => ({ ...m, gap: gaps.get(m.nodeId) ?? null }))} />
      ) : null}
    </Screen>
  );
}
