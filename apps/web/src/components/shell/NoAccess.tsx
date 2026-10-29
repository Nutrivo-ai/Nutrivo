import { EmptyState, NoPermissionState } from "@/components/kit";
import { ONBOARDING } from "@/lib/onboarding/rules";
import type { WorkspaceMembership } from "@/lib/workspace/memberships";
import { Wordmark } from "./Wordmark";
import { WorkspaceList } from "./WorkspaceSwitcher";

/**
 * /w/<id> for a workspace that is not one of the person's. It reads the same whether the workspace exists or not
 * (RLS returns nothing either way), so it never tells anybody that a workspace exists. It is never a dead end: it
 * lists the person's own workspaces, or says how a person gets into one.
 */
export function NoAccess({ memberships, pathname }: { memberships: WorkspaceMembership[]; pathname: string }) {
  return (
    <div className="min-h-screen bg-panel text-ink">
      <div className="flex items-center gap-[18px] py-[16px] px-[16px] md:px-[30px] bg-paper border-b border-rule">
        <Wordmark />
        <span className="font-mono text-[10px] tracking-[0.1em] uppercase text-n600">Workspace</span>
      </div>
      <main className="max-w-[560px] mx-auto py-[40px] px-[16px] flex flex-col gap-[28px]">
        <h1 className="sr-only">No access to this workspace</h1>
        <NoPermissionState
          where="NO ACCESS · WORKSPACE"
          title="This workspace is not open to you"
          body="Either it does not exist, or your account is not a member of it. Nutrivo does not say which."
          aside="A workspace admin can invite you."
        />
        {memberships.length > 0 ? (
          <section aria-label="Your workspaces" className="py-[18px] px-[20px] border border-rule bg-paper">
            <WorkspaceList memberships={memberships} pathname={pathname} label="Your workspaces" />
          </section>
        ) : (
          <EmptyState
            where="NO WORKSPACE YET"
            title="Your account is not in a workspace yet"
            body="A workspace is created at onboarding, or opened to you by an invitation from its admin."
            action={{ label: "Create your workspace", href: ONBOARDING, variant: "primary" }}
            aside="Or ask the admin of your company's workspace to invite you."
          />
        )}
      </main>
    </div>
  );
}
