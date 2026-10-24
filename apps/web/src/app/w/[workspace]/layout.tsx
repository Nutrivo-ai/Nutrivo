import { redirect } from "next/navigation";
import { AccessRemoved, type EndedAccess } from "@/components/auth/AccessRemoved";
import { NoAccess, Shell } from "@/components/shell";
import { sessionGate } from "@/lib/auth/session";
import { signInHref } from "@/lib/auth/rules";
import { createClient } from "@/lib/supabase/server";
import { loadShellContext, ShellReadError } from "@/lib/workspace/memberships";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Every workspace route renders inside this layout (T-102). The membership is read under the person's own session, so
// RLS alone decides which workspace they can be in; the route only says which of theirs they are looking at.
// T-103: no session goes to /sign-in (the proxy does it first); a session that must prove or enrol two-step goes to
// /auth/mfa (A02 step 4); a membership that ended shows Access removed (S-REC-004), anything else NoAccess.
export default async function WorkspaceLayout({ children, params }: LayoutProps<"/w/[workspace]">) {
  const { workspace } = await params;
  const supabase = await createClient();
  const context = await loadShellContext(supabase, workspace);
  if (context.kind === "signed-out") redirect(signInHref(`/w/${workspace}`));
  if (context.kind === "no-access") {
    if (UUID.test(workspace)) {
      const { data, error } = await supabase.schema("app").rpc("my_ended_access", { p_ws: workspace.toLowerCase() });
      if (error) throw new ShellReadError("ended access", error);
      if (data) return <AccessRemoved access={data as EndedAccess} />;
    }
    return <NoAccess memberships={context.memberships} pathname="" />;
  }
  if ((await sessionGate(supabase, context.userId)) !== "ok") {
    redirect(`/auth/mfa?next=${encodeURIComponent(`/w/${workspace}`)}`);
  }
  return (
    <Shell current={context.current} memberships={context.memberships}>
      {children}
    </Shell>
  );
}
