import { ProductNotFound } from "@/components/artwork/ProductNotFound";
import { RegistrationPack } from "@/components/registration/RegistrationPack";
import { Screen } from "@/components/shell";
import { readRegistrationGaps, readRegistrationPage } from "@/lib/registration/queries";
import { roleAllows, routeFor } from "@/lib/shell/routes";
import { createClient } from "@/lib/supabase/server";
import { loadShellContext } from "@/lib/workspace/memberships";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Registration pack · Nutrivo" };

// S-NV2-020 Registration pack (spec/screens.yaml), T-504, G02 and G03: one product in one market, read under the
// person's session (RLS). A viewer reads it; an editor also gets the G03 record form (app.record_registration decides
// the role and market scope again). A failed read goes to the workspace error boundary, and loading.tsx covers the wait.
export default async function Page({ params }: PageProps<"/w/[workspace]/products/[product]/nodes/[node]/registration">) {
  const { workspace, product, node } = await params;
  const nodeId = decodeURIComponent(node);
  const db = await createClient();
  const context = await loadShellContext(db, workspace);
  const allowed =
    context.kind === "member" &&
    roleAllows(context.current.role, routeFor("/w/[workspace]/products/[product]/nodes/[node]/registration").role);
  const page = allowed ? await readRegistrationPage(db, workspace, product, nodeId) : null;
  const gap = page?.kind === "loaded" ? ((await readRegistrationGaps(db, workspace, [nodeId])).get(nodeId) ?? null) : null;
  const canEdit = context.kind === "member" && roleAllows(context.current.role, "editor");
  return (
    <Screen
      route="/w/[workspace]/products/[product]/nodes/[node]/registration"
      crumb="Portfolio · Registration"
      title={page?.kind === "loaded" ? `Registration · ${page.market.name}` : "Registration action pack"}
    >
      {page?.kind === "loaded" ? (
        <RegistrationPack page={page} workspaceId={workspace} canEdit={canEdit} gap={gap} />
      ) : page ? (
        <ProductNotFound workspaceId={workspace} />
      ) : null}
    </Screen>
  );
}
