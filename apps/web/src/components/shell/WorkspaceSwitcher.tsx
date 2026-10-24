"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Blueprint, cx } from "@/components/kit";
import { ROLE_LABEL, switchHref } from "@/lib/shell/routes";
import type { WorkspaceMembership } from "@/lib/workspace/memberships";

/**
 * The person's workspaces as Partner Tier's client switcher (S-PRT-002) lists them: mono caps over the list, the
 * workspace being worked in on --accent-100 with a 2px accent edge. Each row carries what app.memberships and
 * app.workspaces say (the name and the person's role); the design's roll-up glyph and recipe count read other tables
 * and wait for a founder (question (b) on issue #24).
 */
export function WorkspaceList({
  memberships,
  currentId,
  pathname,
  label = "Workspaces",
  onNavigate,
}: {
  memberships: WorkspaceMembership[];
  currentId?: string;
  pathname: string;
  label?: string;
  onNavigate?: () => void;
}) {
  const headingId = useId();
  return (
    <div data-workspace-list="">
      <div className="flex items-baseline justify-between mb-[10px] font-mono text-[9.5px] tracking-[0.13em] uppercase text-n600">
        <span id={headingId}>{label}</span>
        <span>{memberships.length}</span>
      </div>
      <ul aria-labelledby={headingId} className="list-none m-0 p-0 flex flex-col gap-[4px]">
        {memberships.map((m) => {
          const current = m.workspaceId === currentId;
          return (
            <li key={m.workspaceId}>
              <Link
                href={switchHref(pathname, m.workspaceId)}
                onClick={onNavigate}
                aria-current={current ? "true" : undefined}
                data-workspace-id={m.workspaceId}
                className={cx(
                  "kit-transition block py-[9px] pr-[10px] pl-[12px] border-l-2 no-underline text-ink hover:text-ink",
                  current ? "bg-accent-100 border-l-accent" : "border-l-transparent hover:bg-panel",
                )}
              >
                <span className={cx("block text-[13.5px] leading-[1.35]", current ? "font-semibold" : "font-normal")}>
                  {m.name}
                </span>
                {/* --n700 on the accent tint: --n600 falls short of 4.5:1 there. */}
                <span className={cx("block mt-[2px] font-mono text-[10px] tracking-[0.04em]", current ? "text-n700" : "text-n600")}>
                  {ROLE_LABEL[m.role]}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * N02: the header control that names the workspace being worked in and opens the list of the person's workspaces.
 * Choosing one navigates to the same section of that workspace; nothing is written and nothing is remembered, so
 * switching changes the context and nothing else (N02.must.1).
 */
export function WorkspaceSwitcher({
  current,
  memberships,
  compact = false,
}: {
  current: WorkspaceMembership;
  memberships: WorkspaceMembership[];
  /** The phone's top bar: the name only, in mono. */
  compact?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  // Close on navigation, on Escape (focus back on the button) and on a click outside.
  const [shownFor, setShownFor] = useState(pathname);
  if (shownFor !== pathname) {
    setShownFor(pathname);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div ref={root} className="relative" data-workspace-switcher="">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          "kit-transition flex items-center gap-[8px] cursor-pointer bg-paper border border-rule rounded-control",
          "hover:border-accent max-w-[320px]",
          compact ? "min-h-[44px] py-[4px] px-[8px]" : "py-[5px] px-[9px]",
        )}
      >
        {compact ? null : (
          <span className="font-mono text-[10px] tracking-[0.1em] uppercase text-n600">Workspace</span>
        )}
        <span
          className={cx(
            "truncate",
            compact ? "font-mono text-[10px] tracking-[0.05em] uppercase text-n700" : "text-[13px] font-medium text-ink",
          )}
        >
          {current.name}
        </span>
        <span aria-hidden="true" className="font-mono text-[10px] text-n600">
          {open ? "▴" : "▾"}
        </span>
      </button>
      <div id={panelId} hidden={!open} className="absolute right-0 top-full mt-[10px] z-30 w-[300px] max-w-[calc(100vw-32px)]">
        <Blueprint className="py-[16px] px-[16px] shadow-modal">
          <WorkspaceList
            memberships={memberships}
            currentId={current.workspaceId}
            pathname={pathname}
            onNavigate={() => setOpen(false)}
          />
        </Blueprint>
      </div>
    </div>
  );
}
