import { DocumentLibrary } from "@/components/documents/DocumentLibrary";
import { Screen } from "@/components/shell";
import { readLibrary, todayUtc } from "@/lib/documents/library";
import { roleAllows, routeFor } from "@/lib/shell/routes";
import { createClient } from "@/lib/supabase/server";
import { loadShellContext } from "@/lib/workspace/memberships";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Documents · Nutrivo" };

// S-NV2-010 Documents (spec/screens.yaml), T-801, H01: the workspace's documents against ref.document_requirements per
// market, with expiry, read under the person's session (RLS). Only a role the screen allows reads anything; anybody
// else gets the no-permission state from Screen. A failed read goes to the workspace error boundary, and loading.tsx
// covers the wait.
export default async function Page({ params }: PageProps<"/w/[workspace]/documents">) {
  const { workspace } = await params;
  const db = await createClient();
  const context = await loadShellContext(db, workspace);
  const allowed = context.kind === "member" && roleAllows(context.current.role, routeFor("/w/[workspace]/documents").role);
  const today = todayUtc();
  const library = allowed ? await readLibrary(db, context.current.workspaceId, today) : null;
  return (
    <Screen route="/w/[workspace]/documents" crumb="Portfolio · Documents & dossiers" title="Completeness stated per market">
      {library ? <DocumentLibrary library={library} today={today} /> : null}
    </Screen>
  );
}
