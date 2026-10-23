"use client";

import { ShellError } from "@/components/shell";

// Inside the shell, when a workspace page's reads fail.
export default function WorkspacePageError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ShellError error={error} retry={retry} />;
}
