"use client";

import Link from "next/link";
import { cx } from "@/components/kit";
import type { NavGroup } from "@/lib/shell/routes";
import { Wordmark } from "./Wordmark";

export type RailItem = { label: string; href: string; active: boolean; badge?: string };
export type RailGroup = { label: string; items: RailItem[] };

const REGION_LABEL: Record<string, string> = { EU: "EU", UK: "UK", US: "USA" };

/** "Feed law · EU · USA": the workspace's purchased regions, as the rail's line under the wordmark draws them. */
export function regionsLine(regions: string[]) {
  return ["Feed law", ...regions.map((r) => REGION_LABEL[r] ?? r)].join(" · ");
}

/** Nutrivo 2.0's rail groups with each item's href in this workspace, marking the page the person is on. */
export function railGroups(nav: NavGroup[], workspaceId: string, activeRoute: string | null): RailGroup[] {
  return nav.map((group) => ({
    label: group.label,
    items: group.items.map((item) => ({
      label: item.label,
      href: item.route.replace("[workspace]", workspaceId),
      active: activeRoute === item.route,
    })),
  }));
}

/** The groups and links of the rail, without its frame: the desktop rail and the phone's More dialog share them. */
export function RailNav({ groups, onNavigate }: { groups: RailGroup[]; onNavigate?: () => void }) {
  return (
    <div className="pt-[16px] px-[12px]">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="m-0 mb-[6px] px-[6px] font-mono text-[9.5px] tracking-[0.13em] uppercase text-n600">{group.label}</p>
          <ul className="list-none m-0 p-0 flex flex-col gap-[1px] mb-[18px]">
            {group.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={item.active ? "page" : undefined}
                  className={cx(
                    "kit-transition flex items-center gap-[8px] w-full py-[7px] px-[8px] text-[13.5px] no-underline",
                    item.active ? "bg-accent text-paper hover:text-paper" : "text-ink hover:bg-accent-100 hover:text-ink",
                  )}
                >
                  <span className="flex-1 text-left">{item.label}</span>
                  {item.badge ? (
                    <span className={cx("font-mono text-[10px]", item.active ? "text-accent-200" : "text-n600")}>
                      {item.badge}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** The left rail of Nutrivo 2.0: the wordmark and the workspace's regions, then the grouped navigation. */
export function Rail({ groups, regions, className }: { groups: RailGroup[]; regions: string[]; className?: string }) {
  return (
    <nav aria-label="Workspace" className={cx("border-r border-rule pb-[28px] bg-panel", className)}>
      <div className="pt-[18px] px-[18px] pb-[16px] border-b border-rule">
        <Wordmark />
        <p className="mt-[3px] mb-0 font-mono text-[10px] tracking-[0.06em] text-n600">{regionsLine(regions)}</p>
      </div>
      <RailNav groups={groups} />
    </nav>
  );
}
