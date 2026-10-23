"use client";

import { ShellError } from "@/components/shell";

// Before the shell exists: when the workspace layout cannot read the person's memberships.
export default function WorkspaceError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="min-h-screen bg-panel">
      <ShellError error={error} retry={retry} />
    </div>
  );
}
