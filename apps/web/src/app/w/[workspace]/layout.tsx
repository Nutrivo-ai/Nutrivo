import { notFound } from "next/navigation";
import { NoAccess, Shell } from "@/components/shell";
import { createClient } from "@/lib/supabase/server";
import { loadShellContext } from "@/lib/workspace/memberships";

// Every workspace route renders inside this layout (T-102). The membership is read under the person's own session, so
// RLS alone decides which workspace they can be in; the route only says which of theirs they are looking at.
export default async function WorkspaceLayout({ children, params }: LayoutProps<"/w/[workspace]">) {
  const { workspace } = await params;
  const context = await loadShellContext(await createClient(), workspace);
  // Sign-in arrives with T-103; until then a visitor without a session finds nothing here.
  if (context.kind === "signed-out") notFound();
  if (context.kind === "no-access") return <NoAccess memberships={context.memberships} pathname="" />;
  return (
    <Shell current={context.current} memberships={context.memberships}>
      {children}
    </Shell>
  );
}
