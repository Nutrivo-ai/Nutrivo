"use client";

import type { ReactNode } from "react";
import { NoPermissionState } from "@/components/kit";
import { ROLE_LABEL, roleAllows, routeFor } from "@/lib/shell/routes";
import { useShell } from "./context";
import { ScreenHeader } from "./Shell";

/**
 * A built workspace screen: its header and main column, with the route's role from spec/screens.yaml applied as the
 * ScreenPlaceholder applies it. A person below that role sees the no-permission state instead of the screen; that is
 * presentation only, because RLS and the RPCs decide what any read or write does.
 */
export function Screen({
  route,
  title,
  crumb,
  children,
}: {
  route: string;
  /** The page's own title (a product name); the design's screen title otherwise. */
  title?: string;
  crumb?: string;
  children: ReactNode;
}) {
  const screen = routeFor(route);
  const { current } = useShell();
  const allowed = roleAllows(current.role, screen.role);
  return (
    <>
      <ScreenHeader crumb={crumb ?? screen.crumb} title={allowed ? (title ?? screen.title) : screen.title} />
      <main className="flex-1 min-w-0 pt-[24px] px-[16px] md:px-[26px] pb-[48px]" data-screen={screen.screens[0]}>
        {allowed ? (
          children
        ) : (
          <div className="max-w-[640px]">
            <NoPermissionState
              where={`NO PERMISSION · ${screen.crumb.toUpperCase()}`}
              title={`Your role cannot open ${screen.title}`}
              body={`You are ${article(ROLE_LABEL[current.role])} ${ROLE_LABEL[current.role]} in ${current.name}. ${screen.title} needs ${article(ROLE_LABEL[screen.role])} ${ROLE_LABEL[screen.role]}${screen.role === "admin" ? "" : " or a role above it"}.`}
              aside={`An admin of ${current.name} can change your role.`}
            />
          </div>
        )}
      </main>
    </>
  );
}

function article(word: string) {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}
