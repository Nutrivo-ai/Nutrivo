import { ShellLoading } from "@/components/shell";

// Before the shell exists: while the workspace layout reads the person's memberships.
export default function Loading() {
  return (
    <div className="min-h-screen bg-panel">
      <ShellLoading />
    </div>
  );
}
