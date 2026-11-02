import { AuditLog } from "@/components/settings/AuditLog";
import { cursor, filterKey, readAudit } from "@/lib/settings/audit";
import { roleAllows, routeFor } from "@/lib/shell/routes";
import { createClient } from "@/lib/supabase/server";
import { loadShellContext } from "@/lib/workspace/memberships";

const ROUTE = "/w/[workspace]/settings/audit";

// S-WSS-005 Audit log (spec/screens.yaml; design: product/Nutrivo Workspace Settings.dc.html, screen "audit"). O02
// (T-108): app.audit_events read under the person's session (RLS), filtered by ?show= and paged by ?before=. Only a
// role the screen allows reads the log at all; anybody else gets the no-permission state. A failed read goes to the
// workspace error boundary, and loading.tsx covers the wait.
export default async function Page({ params, searchParams }: PageProps<"/w/[workspace]/settings/audit">) {
  const { workspace } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const context = await loadShellContext(supabase, workspace);
  const allowed = context.kind === "member" && roleAllows(context.current.role, routeFor(ROUTE).role);
  const page = allowed
    ? await readAudit(supabase, context.current.workspaceId, filterKey(query.show), cursor(query.before))
    : null;
  return <AuditLog route={ROUTE} workspaceId={workspace} page={page} />;
}
