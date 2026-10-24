"use client";

import type { ReactNode } from "react";
import { Blueprint } from "@/components/kit";
import { NoAccess, ShellError, ShellLoading, WorkspaceList } from "@/components/shell";
import type { WorkspaceMembership } from "@/lib/workspace/memberships";

// The shell's states and the workspace switcher's list, each on its own so tests/e2e/shell.spec.ts can hold them to
// their images and run axe over them. The workspace names are Partner Tier's own (S-PRT-002).
const MEMBERSHIPS: WorkspaceMembership[] = [
  { workspaceId: "00000000-0000-4000-8000-000000000001", name: "Halden Pet Nutrition AB", role: "admin", regions: ["EU"] },
  { workspaceId: "00000000-0000-4000-8000-000000000002", name: "Vasa Djurfoder AB", role: "editor", regions: ["EU"] },
  { workspaceId: "00000000-0000-4000-8000-000000000003", name: "Brindle & Bark Ltd", role: "portfolio_manager", regions: ["UK"] },
  { workspaceId: "00000000-0000-4000-8000-000000000004", name: "Nordwild Feeds GmbH", role: "viewer", regions: ["EU"] },
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section data-testid={`shell-${id}`} aria-labelledby={`shell-${id}-title`} className="py-[24px] px-[26px] border-b border-rule">
      <h2 id={`shell-${id}-title`} className="m-0 mb-[16px] font-mono text-[10px] tracking-[0.1em] uppercase font-normal text-n600">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function ShellStatesStory() {
  return (
    <div className="bg-paper text-ink">
      <h1 className="sr-only">Kit: the shell&apos;s states</h1>
      <Section id="switcher" title="Workspace switcher">
        <div className="w-[300px]">
          <Blueprint className="py-[16px] px-[16px]">
            <WorkspaceList memberships={MEMBERSHIPS} currentId={MEMBERSHIPS[0].workspaceId} pathname="/w/x/board" />
          </Blueprint>
        </div>
      </Section>
      <Section id="loading" title="Loading">
        <ShellLoading />
      </Section>
      <Section id="error" title="Error">
        <ShellError error={Object.assign(new Error("story"), { digest: "1234567890" })} retry={() => undefined} />
      </Section>
      <Section id="no-access" title="Not one of your workspaces">
        <NoAccess memberships={MEMBERSHIPS.slice(0, 2)} pathname="" />
      </Section>
      <Section id="no-workspace" title="No workspace yet">
        <NoAccess memberships={[]} pathname="" />
      </Section>
    </div>
  );
}
