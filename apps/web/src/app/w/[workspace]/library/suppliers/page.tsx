import { Screen } from "@/components/shell";
import { Suppliers } from "@/components/suppliers/Suppliers";
import { roleAllows, routeFor } from "@/lib/shell/routes";
import { readSuppliers } from "@/lib/suppliers/requests";
import { createClient } from "@/lib/supabase/server";
import { loadShellContext } from "@/lib/workspace/memberships";

// S-NV2-014 Suppliers (spec/screens.yaml), T-802, H02: the workspace's suppliers and their document requests, read
// under the person's session (RLS), and the request form. Anybody the screen does not allow gets the no-permission
// state from Screen; a failed read goes to the workspace error boundary, and loading.tsx covers the wait. Only an
// editor-class role is offered the form (app.request_document checks it again).
export default async function Page({ params }: PageProps<"/w/[workspace]/library/suppliers">) {
  const { workspace } = await params;
  const db = await createClient();
  const context = await loadShellContext(db, workspace);
  const allowed = context.kind === "member" && roleAllows(context.current.role, routeFor("/w/[workspace]/library/suppliers").role);
  const screen = allowed ? await readSuppliers(db, context.current.workspaceId) : null;
  const canRequest = context.kind === "member" && roleAllows(context.current.role, "editor");
  return (
    <Screen route="/w/[workspace]/library/suppliers" crumb="Library · Suppliers" title="Specifications, expiry and requests">
      {screen && context.kind === "member" ? (
        <Suppliers screen={screen} workspaceId={context.current.workspaceId} canRequest={canRequest} />
      ) : null}
    </Screen>
  );
}
