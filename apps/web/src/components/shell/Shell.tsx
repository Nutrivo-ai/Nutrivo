"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Dialog, cx } from "@/components/kit";
import { SettingsLinks, SettingsNav, settingsKey, type SettingsKey } from "@/components/settings/SettingsFrame";
import { MOBILE_TABS, NAV, hrefFor, matchRoute, type NavGroup } from "@/lib/shell/routes";
import type { WorkspaceMembership } from "@/lib/workspace/memberships";
import { ShellProvider, useOptionalShell } from "./context";
import { Rail, RailNav, railGroups, type RailGroup } from "./Rail";
import { Wordmark } from "./Wordmark";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

/** The rail item for a route: the route itself, else the deepest rail route it sits under (Home only for itself). */
export function activeNavRoute(route: string | null, nav: NavGroup[] = NAV): string | null {
  if (!route) return null;
  const routes = nav.flatMap((g) => g.items.map((i) => i.route));
  if (routes.includes(route)) return route;
  const parents = routes.filter((r) => r !== "/w/[workspace]" && route.startsWith(`${r}/`));
  return parents.sort((a, b) => b.length - a.length)[0] ?? null;
}

/**
 * The workspace shell (T-102): Nutrivo 2.0's 216 px rail beside the page at desktop widths; below 768 px the Mobile
 * file's chrome, a top bar and a bottom tab bar whose More opens the rail. Pages render their own ScreenHeader.
 * Under /settings/ the Workspace Settings nav takes the rail's place (T-107), and More lists it above the rail.
 */
export function Shell({
  current,
  memberships,
  children,
}: {
  current: WorkspaceMembership;
  memberships: WorkspaceMembership[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const matched = matchRoute(pathname);
  const groups = railGroups(NAV, current.workspaceId, activeNavRoute(matched?.route ?? null));
  const settings = settingsKey(pathname);
  return (
    <ShellProvider value={{ current, memberships }}>
      <ShellFrame
        groups={groups}
        regions={current.regions}
        matchedRoute={matched?.route ?? null}
        workspaceId={current.workspaceId}
        settings={settings}
      >
        {children}
      </ShellFrame>
    </ShellProvider>
  );
}

/** The frame without data: what Shell renders, and what the /kit/shell story renders with the design's own rail. */
export function ShellFrame({
  groups,
  regions,
  matchedRoute,
  workspaceId,
  settings = null,
  children,
}: {
  groups: RailGroup[];
  regions: string[];
  matchedRoute: string | null;
  workspaceId: string;
  /** The Workspace Settings section the page is in, if any: its nav replaces the rail. */
  settings?: SettingsKey | null;
  children: ReactNode;
}) {
  const [more, setMore] = useState(false);
  return (
    <div className="min-h-screen md:grid md:grid-cols-[216px_minmax(0,1fr)] text-[14px] text-ink bg-paper">
      {settings ? (
        <SettingsNav ws={workspaceId} active={settings} className="hidden md:block" />
      ) : (
        <Rail groups={groups} regions={regions} className="hidden md:block" />
      )}
      <div className="flex flex-col min-w-0 min-h-screen pb-[60px] md:pb-0">{children}</div>
      <nav
        aria-label="Workspace sections"
        className="md:hidden fixed bottom-0 inset-x-0 z-20 flex border-t border-rule bg-paper"
      >
        {MOBILE_TABS.map((tab) => {
          const active = matchedRoute === tab.route;
          return (
            <Link
              key={tab.route}
              href={hrefFor(tab.route, workspaceId)}
              aria-current={active ? "page" : undefined}
              className={cx(
                "flex-1 flex items-center justify-center min-h-[48px] text-[12.5px] no-underline border-r border-n200",
                active ? "bg-accent-100 text-accent-700 font-semibold" : "text-n600 hover:text-accent-700",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMore(true)}
          aria-haspopup="dialog"
          className="flex-1 min-h-[48px] text-[12.5px] text-n600 bg-transparent border-0 cursor-pointer hover:text-accent-700"
        >
          More
        </button>
      </nav>
      <Dialog open={more} onClose={() => setMore(false)} title="Every section" kicker="Workspace">
        <div className="-mx-[12px] -mt-[16px]">
          {settings ? (
            <nav aria-label="Settings">
              <SettingsLinks ws={workspaceId} active={settings} onNavigate={() => setMore(false)} />
            </nav>
          ) : null}
          <RailNav groups={groups} onNavigate={() => setMore(false)} />
        </div>
      </Dialog>
    </div>
  );
}

/**
 * The page header: Nutrivo 2.0's mono crumb in the accent over a 22 px title, on a 1 px ink rule, with the workspace
 * switcher where the design draws the Compliance Worker button (LATER; question (a) on issue #24). Below 768 px the
 * Mobile file's top bar comes first, and the eyebrow names the workspace as the phones do.
 */
export function ScreenHeader({
  crumb,
  title,
  current,
  memberships,
}: {
  crumb: string;
  title: string;
  current?: WorkspaceMembership;
  memberships?: WorkspaceMembership[];
}) {
  const shell = useOptionalShell();
  current ??= shell?.current;
  memberships ??= shell?.memberships;
  return (
    <>
      <div className="md:hidden flex items-center gap-[9px] py-[6px] px-[16px] border-b border-ink bg-paper">
        <Wordmark size="phone" />
        <div className="flex-1" />
        {current && memberships ? <WorkspaceSwitcher current={current} memberships={memberships} compact /> : null}
      </div>
      <header className="flex items-center gap-[18px] border-b border-rule md:border-ink py-[12px] px-[16px] md:px-[26px] bg-paper">
        <div className="flex-1 min-w-0">
          <p className="m-0 font-mono text-[10px] tracking-[0.1em] uppercase text-accent-700 md:text-accent">
            <span className="md:hidden">{current?.name ?? crumb}</span>
            <span className="hidden md:inline">{crumb}</span>
          </p>
          <h1 className="mt-[2px] mb-0 font-head text-[19px] md:text-[22px] font-semibold leading-[1.1] tracking-[-0.01em]">{title}</h1>
        </div>
        {current && memberships ? (
          <div className="hidden md:flex items-center gap-[10px] flex-none">
            <WorkspaceSwitcher current={current} memberships={memberships} />
          </div>
        ) : null}
      </header>
    </>
  );
}
