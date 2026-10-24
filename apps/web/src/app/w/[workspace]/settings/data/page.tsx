import { exportState, readLatestExport } from "@/lib/exports/exports";
import { createClient } from "@/lib/supabase/server";
import { DataAndRetention } from "./DataAndRetention";

// S-WSS-004 Data and retention (spec/screens.yaml; design: product/Nutrivo Workspace Settings.dc.html, screen "data").
// O03: the full export, free on every plan (BE-44). The latest export job is read under RLS; a read failure goes to
// the workspace error boundary, and loading.tsx covers the wait.
export default async function Page({ params }: PageProps<"/w/[workspace]/settings/data">) {
  const { workspace } = await params;
  const row = await readLatestExport(await createClient(), workspace);
  return <DataAndRetention workspaceId={workspace} initial={exportState(row, workspace)} />;
}
