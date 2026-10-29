"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/kit";
import { Wordmark } from "@/components/shell/Wordmark";
import { WorkspaceSwitcher } from "@/components/shell/WorkspaceSwitcher";
import { useOptionalShell } from "@/components/shell/context";
import { hrefFor } from "@/lib/shell/routes";
import type { WorkspaceMembership } from "@/lib/workspace/memberships";

// The frame of Nutrivo Workspace Settings (T-107): its own 216 px side nav in place of the Nutrivo 2.0 rail, a header
// naming the workspace with a chip on the right, and the panel-grey page the cards sit on. Signing authority
// (S-WSS-002) is LATER and has no route yet, so the nav leaves it out rather than drawing a dead link. The billing
// entries are plain text in the design; here they link to their routes. The wordmark goes back to the workspace.

export type SettingsKey =
  | "people"
  | "workspace"
  | "data"
  | "audit"
  | "billing"
  | "invoices"
  | "payment"
  | "details"
  | "account";

type Entry = { key: SettingsKey; label: string; href: (ws: string) => string };

const WORKSPACE: Entry[] = [
  { key: "people", label: "People and roles", href: (ws) => hrefFor("/w/[workspace]/settings/people", ws) },
  { key: "workspace", label: "Workspace", href: (ws) => hrefFor("/w/[workspace]/settings/workspace", ws) },
  { key: "data", label: "Data and retention", href: (ws) => hrefFor("/w/[workspace]/settings/data", ws) },
  { key: "audit", label: "Audit log", href: (ws) => hrefFor("/w/[workspace]/settings/audit", ws) },
];
const BILLING: Entry[] = [
  { key: "billing", label: "Plan and allowance", href: (ws) => hrefFor("/w/[workspace]/settings/billing", ws) },
  { key: "invoices", label: "Invoices", href: (ws) => hrefFor("/w/[workspace]/settings/billing/invoices", ws) },
  { key: "payment", label: "Payment method", href: (ws) => hrefFor("/w/[workspace]/settings/billing/payment", ws) },
  { key: "details", label: "Billing details", href: (ws) => hrefFor("/w/[workspace]/settings/billing/details", ws) },
];

/** "/account", carrying the workspace whose settings the person came from. */
export const accountHref = (ws: string | null) => (ws ? `/account?w=${ws}` : "/account");

/** The settings section a pathname belongs to, or null outside the settings frame. */
export function settingsKey(pathname: string): SettingsKey | null {
  if (pathname === "/account") return "account";
  const m = /^\/w\/[^/]+\/settings\/(.+?)\/?$/.exec(pathname);
  if (!m) return null;
  const rest = m[1];
  if (rest === "billing") return "billing";
  if (rest.startsWith("billing/")) {
    const sub = rest.slice("billing/".length);
    return sub === "invoices" || sub === "payment" || sub === "details" ? sub : null;
  }
  return rest === "people" || rest === "workspace" || rest === "data" || rest === "audit" ? rest : null;
}

const ITEM = "kit-transition flex items-center gap-[8px] w-full text-left border-0 border-l-2 p-[8px] text-[13px] no-underline";
const GROUP = "m-0 mb-[6px] px-[8px] font-mono text-[9.5px] tracking-[0.13em] uppercase";

function Group({ label, entries, ws, active, accent, quiet, onNavigate }: {
  label: string;
  entries: Entry[];
  ws: string;
  active: SettingsKey | null;
  accent?: boolean;
  quiet?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <>
      <p className={cx(GROUP, accent ? "text-accent" : "text-n600")}>{label}</p>
      <ul className="list-none m-0 p-0 flex flex-col gap-[1px] mb-[16px]">
        {entries.map((e) => {
          const on = e.key === active;
          return (
            <li key={e.key}>
              <Link
                href={e.href(ws)}
                onClick={onNavigate}
                aria-current={on ? "page" : undefined}
                className={cx(
                  ITEM,
                  on
                    ? "border-l-accent bg-accent-100 font-semibold text-ink hover:text-ink"
                    : cx("border-l-transparent hover:bg-accent-100", quiet ? "text-n600 hover:text-n700" : "text-ink hover:text-ink"),
                )}
              >
                <span className="flex-1">{e.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** The groups of the settings nav, without its frame: the desktop nav and the phone's More dialog share them. */
export function SettingsLinks({ ws, active, onNavigate }: { ws: string | null; active: SettingsKey | null; onNavigate?: () => void }) {
  return (
    <div className="pt-[14px] px-[10px]">
      {ws ? (
        <>
          <Group label="Workspace" entries={WORKSPACE} ws={ws} active={active} accent onNavigate={onNavigate} />
          <Group label="Billing" entries={BILLING} ws={ws} active={active} quiet onNavigate={onNavigate} />
        </>
      ) : null}
      <Group
        label="You"
        entries={[{ key: "account", label: "Your account", href: () => accountHref(ws) }]}
        ws={ws ?? ""}
        active={active}
        onNavigate={onNavigate}
      />
    </div>
  );
}

/** The side nav of Workspace Settings. */
export function SettingsNav({ ws, active, className }: { ws: string | null; active: SettingsKey | null; className?: string }) {
  return (
    <nav aria-label="Settings" className={cx("border-r border-rule bg-paper pb-[30px]", className)}>
      <div className="py-[16px] px-[18px] border-b border-ink">
        {ws ? (
          <Link href={hrefFor("/w/[workspace]", ws)} className="inline-block no-underline">
            <Wordmark size="settings" />
            <span className="sr-only"> · back to the workspace</span>
          </Link>
        ) : (
          <Link href="/auth/continue" className="inline-block no-underline">
            <Wordmark size="settings" />
            <span className="sr-only"> · home</span>
          </Link>
        )}
        <p className="mt-[4px] mb-0 font-mono text-[10px] tracking-[0.05em] text-n600">Settings</p>
      </div>
      <SettingsLinks ws={ws} active={active} />
    </nav>
  );
}

export type ChipTone = "n600" | "clear" | "accent" | "blocked";
const CHIP: Record<ChipTone, string> = {
  n600: "border-n600 text-n600",
  clear: "border-clear text-clear",
  accent: "border-accent text-accent-700",
  blocked: "border-blocked text-blocked",
};

/**
 * The settings header: the workspace's name in the accent over a 21 px title on a 1 px ink rule, and the design's
 * chip on the right. Below 768 px the Mobile file's top bar comes first, with the workspace switcher.
 */
export function SettingsHeader({
  title,
  chip,
  tone = "n600",
  current,
  memberships,
}: {
  title: string;
  chip?: string;
  tone?: ChipTone;
  current?: WorkspaceMembership | null;
  memberships?: WorkspaceMembership[];
}) {
  const shell = useOptionalShell();
  current = current === undefined ? shell?.current : current;
  memberships ??= shell?.memberships;
  return (
    <>
      <div className="md:hidden flex items-center gap-[9px] py-[6px] px-[16px] border-b border-ink bg-paper">
        <Wordmark size="phone" />
        <div className="flex-1" />
        {current && memberships ? <WorkspaceSwitcher current={current} memberships={memberships} compact /> : null}
      </div>
      <header className="flex items-center gap-[18px] border-b border-ink bg-paper py-[13px] px-[16px] md:px-[28px]">
        <div className="flex-1 min-w-0">
          <p className="m-0 font-mono text-[10px] tracking-[0.11em] uppercase text-accent-700 md:text-accent">
            {current?.name ?? "Your account"}
          </p>
          <h1 className="mt-[3px] mb-0 font-head text-[21px] font-semibold leading-[1.1]">{title}</h1>
        </div>
        {chip ? (
          <span className={cx("hidden sm:inline font-mono text-[10.5px] tracking-[0.05em] whitespace-nowrap border py-[5px] px-[9px]", CHIP[tone])}>
            {chip}
          </span>
        ) : null}
      </header>
    </>
  );
}

/** The page under the header: the design's 26 / 28 px padding on --panel. */
export function SettingsMain({ children }: { children: ReactNode }) {
  return <main className="flex-1 min-w-0 bg-panel pt-[26px] px-[16px] md:px-[28px] pb-[60px]">{children}</main>;
}
