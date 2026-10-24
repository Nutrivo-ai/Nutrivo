"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { WorkspaceMembership } from "@/lib/workspace/memberships";

export type ShellValue = { current: WorkspaceMembership; memberships: WorkspaceMembership[] };

const ShellContext = createContext<ShellValue | null>(null);

export function ShellProvider({ value, children }: { value: ShellValue; children: ReactNode }) {
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

/** The shell's value, or null outside it (the kit's stories render the header on its own). */
export function useOptionalShell(): ShellValue | null {
  return useContext(ShellContext);
}

/** The workspace the route is in and the person's other memberships. Only inside the shell. */
export function useShell(): ShellValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell is only available inside the workspace shell");
  return value;
}
