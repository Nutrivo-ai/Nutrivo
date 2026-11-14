"use client";

import Link from "next/link";
import { Blueprint, EmptyState, NoPermissionState, cx } from "@/components/kit";
import { useShell } from "@/components/shell/context";
import { FILTERS, countLine, type AuditPage, type FilterKey, type KindTone } from "@/lib/settings/audit";
import { ROLE_LABEL, hrefFor, roleAllows, routeFor } from "@/lib/shell/routes";
import { SettingsHeader, SettingsMain } from "./SettingsFrame";

// S-WSS-005 Audit log (design: product/Nutrivo Workspace Settings.dc.html, screen "audit"). O02: app.audit_events read
// under RLS, newest first, with the design's filters as links (?show=) and older pages (?before=). The table is
// insert-only, so the screen offers nothing to edit. The design's EXPORT control has no contract yet (issue #30,
// question 2), so it is left out rather than drawn dead. Who may open it follows spec/screens.yaml (admin; question 1).

const TONE: Record<KindTone, string> = {
  accent: "text-accent",
  n600: "text-n600",
  action: "text-action",
  clear: "text-clear",
};

// The design's three notes under the table, word for word.
const NOTES: { k: string; v: string; bar: string }[] = [
  {
    k: "Every check records the rules it applied",
    v: "Applied, passed and withheld. That is what makes “which recipes does this rule change affect” a query rather than a re-run of the whole portfolio.",
    bar: "border-t-accent",
  },
  {
    k: "A revoked grant does not rewrite the past",
    v: "A certificate signed under a grant stays signed by the person who held it at the time, with the grant date on the record. Removing somebody changes their access, never the history.",
    bar: "border-t-na",
  },
  {
    k: "Export it for an audit",
    v: "The full event stream as a file, with the ruleset version on every row. An auditor asking what you knew and when should not need our help to answer it.",
    bar: "border-t-clear",
  },
];

const GRID = "grid grid-cols-[148px_128px_minmax(0,1fr)_minmax(0,0.7fr)]";
const HEAD = ["When", "Kind", "What happened", "Who"];

function href(ws: string, filter: FilterKey, before?: number) {
  const base = hrefFor("/w/[workspace]/settings/audit", ws);
  const q = new URLSearchParams();
  if (filter !== "all") q.set("show", filter);
  if (before !== undefined) q.set("before", String(before));
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

export function AuditLog({ route, workspaceId, page }: { route: string; workspaceId: string; page: AuditPage | null }) {
  const screen = routeFor(route);
  const { current } = useShell();
  const allowed = roleAllows(current.role, screen.role) && page !== null;
  return (
    <>
      <SettingsHeader title={screen.title} chip="APPEND-ONLY · INSERTS ONLY" tone="accent" />
      <SettingsMain>
        {allowed ? (
          <AuditScreen workspaceId={workspaceId} page={page} />
        ) : (
          <div className="max-w-[640px]">
            <NoPermissionState
              where="NO PERMISSION · SETTINGS"
              title={`Your role cannot open ${screen.title}`}
              body={`You are ${/^[aeiou]/i.test(ROLE_LABEL[current.role]) ? "an" : "a"} ${ROLE_LABEL[current.role]} in ${current.name}. The audit log needs an ${ROLE_LABEL.admin}.`}
              aside={`An admin of ${current.name} can read it or change your role.`}
            />
          </div>
        )}
      </SettingsMain>
    </>
  );
}

function AuditScreen({ workspaceId, page }: { workspaceId: string; page: AuditPage }) {
  const filter = FILTERS.find((f) => f.key === page.filter)!;
  return (
    <div data-screen="S-WSS-005">
      <Blueprint edge="border-l-4 border-l-accent" className="bg-accent-100 py-[18px] px-[22px]">
        <div data-testid="audit-banner">
          <p className="m-0 text-[15px] font-semibold">Nothing on this screen can be edited or deleted, including by us</p>
          <p className="mt-[7px] mb-0 text-[13.5px] leading-[1.6] text-n800 max-w-[108ch]">
            The events and certificate tables accept inserts and nothing else. Update and delete are revoked from every
            application role, and a database trigger rejects them outright. If the application could rewrite this
            history, a Certificate of Check would be a claim rather than a record.
          </p>
        </div>
      </Blueprint>

      <div className="mt-[20px] flex flex-wrap gap-[8px] items-center">
        <nav aria-label="Filter events" className="contents">
          {FILTERS.map((f) => {
            const on = f.key === page.filter;
            return (
              <Link
                key={f.key}
                href={href(workspaceId, f.key)}
                aria-current={on ? "page" : undefined}
                className={cx(
                  "kit-transition border rounded-[3px] py-[7px] px-[13px] text-[12.5px] no-underline",
                  on
                    ? "border-accent bg-accent-100 text-accent-700 font-semibold hover:text-accent-700"
                    : "border-n400 bg-paper text-n700 hover:bg-accent-100 hover:text-n700",
                )}
              >
                {f.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex-1" />
        <span data-testid="audit-count" className="font-mono text-[10.5px] tracking-[0.05em] text-n600">
          {countLine(page.total, page.since)}
        </span>
      </div>

      <Blueprint className="mt-[16px]">
        <div className="relative overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse" aria-label={`Audit events · ${filter.label}`}>
          <thead>
            <tr className={cx(GRID, "bg-panel border-b border-ink")}>
              {HEAD.map((h) => (
                <th
                  key={h}
                  scope="col"
                  className="m-0 py-[10px] px-[15px] text-left font-mono text-[9.5px] font-normal tracking-[0.1em] uppercase text-n600"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.events.map((e, i) => (
              <tr
                key={e.id}
                data-kind={e.kind}
                data-external={e.external ? "true" : "false"}
                className={cx(GRID, i < page.events.length - 1 && "border-b border-n200", i % 2 === 1 && "bg-panel")}
              >
                <td className="py-[11px] px-[15px] font-mono text-[11px] text-n700">
                  <time dateTime={e.at}>{e.when}</time>
                </td>
                <td className={cx("py-[11px] px-[15px] font-mono text-[10px] tracking-[0.05em]", TONE[e.tone])}>{e.label}</td>
                <td className="py-[11px] px-[15px] text-[12.5px] leading-[1.45] break-words">{e.what}</td>
                <td className="py-[11px] px-[15px] text-[12px] text-n600">{e.who}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {page.events.length === 0 ? (
          <div className="p-[20px]">
            <EmptyState
              where={`AUDIT LOG · ${filter.label.toUpperCase()}`}
              title={page.filter === "all" ? "No events yet" : `No ${filter.label.toLowerCase()} events yet`}
              body={
                page.filter === "all"
                  ? "Every change in this workspace is recorded here as it happens, and stays."
                  : "Events of this kind appear here as they happen. Every other event is under All events."
              }
              action={page.filter === "all" ? undefined : { label: "Show all events", href: href(workspaceId, "all"), variant: "secondary" }}
              aside={page.filter === "all" ? "Nothing has been recorded in this workspace." : undefined}
            />
          </div>
        ) : null}
      </Blueprint>

      {page.paged || page.older !== null ? (
        <div className="mt-[12px] flex gap-[16px] items-center font-mono text-[10.5px] tracking-[0.05em]">
          {page.paged ? (
            <Link href={href(workspaceId, page.filter)} className="text-accent-700">
              NEWEST EVENTS
            </Link>
          ) : null}
          {page.older !== null ? (
            <Link href={href(workspaceId, page.filter, page.older)} className="text-accent-700">
              OLDER EVENTS
            </Link>
          ) : null}
        </div>
      ) : null}

      <div data-testid="audit-notes" className="mt-[20px] grid gap-[18px] grid-cols-1 md:grid-cols-3">
        {NOTES.map((n) => (
          <Blueprint key={n.k} edge={cx("border-t-4", n.bar)} className="py-[18px] px-[20px]">
            <p className="m-0 text-[13.5px] font-semibold leading-[1.25]">{n.k}</p>
            <p className="mt-[7px] mb-0 text-[12.5px] leading-[1.55] text-n700">{n.v}</p>
          </Blueprint>
        ))}
      </div>
    </div>
  );
}
