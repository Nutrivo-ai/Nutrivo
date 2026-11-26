import Link from "next/link";
import type { ReactNode } from "react";
import { Blueprint, EmptyState, SectionHeading, cx } from "@/components/kit";
import { hrefFor } from "@/lib/shell/routes";
import type { PersonLine, WorkspaceLine } from "@/lib/settings/overview";

// S-NV2-017 Settings & roles (design: product/Nutrivo 2.0.dc.html, screen "settings"). The summary of Workspace
// Settings: who is here, with what role and which signing authority; the workspace facts that have data and a
// decision behind them; the plan as D-03 sells it (issue 352). The design draws no controls, so the page adds only links,
// each to the page already built that changes what this one shows (People and roles, Workspace, Audit log, Your
// account, Plan and allowance). Role names are the four roles (the design's job titles are not stored anywhere).

const TONE = { clear: "text-clear", action: "text-action", none: "text-n600" } as const; // n500, as the design draws "None", fails AA contrast at 11px
const LINK = "font-mono text-[10.5px] tracking-[0.08em] uppercase text-accent-700 hover:underline whitespace-nowrap";
const HEAD = "text-left font-mono text-[9.5px] tracking-[0.1em] uppercase font-normal text-n600 border-b border-rule py-[9px] pr-[10px]";
const CELL = "border-b border-rule";

export type OverviewView = {
  workspaceId: string;
  people: PersonLine[];
  /** Pending invitations, counted under the table: People and roles lists them. */
  invitations: number;
  workspace: WorkspaceLine[];
  plan: { kind: "read"; lines: { k: string; v: string }[] } | { kind: "no-billing" };
};

function Heading({ children, note, href, link }: { children: ReactNode; note?: string; href: string; link: string }) {
  return (
    <div className="flex flex-wrap items-end gap-x-[12px]">
      <div className="flex-1 min-w-[min(100%,486px)]">
        <SectionHeading note={note}>{children}</SectionHeading>
      </div>
      <Link href={href} className={cx(LINK, "pb-[8px]")}>
        {link} →
      </Link>
    </div>
  );
}

export function Overview({ view }: { view: OverviewView }) {
  const ws = view.workspaceId;
  const alone = view.people.length <= 1 && view.invitations === 0;
  return (
    <div data-region="settings-overview" className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-[22px] items-start">
      <div>
        <section aria-labelledby="ov-people" data-region="people">
          <Heading
            href={hrefFor("/w/[workspace]/settings/people", ws)}
            link="People and roles"
            note="signing authority is granted per market, never globally"
          >
            <span id="ov-people">People and roles</span>
          </Heading>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse">
            <thead>
              <tr>
                <th scope="col" className={cx(HEAD, "w-[30%]")}>Person</th>
                <th scope="col" className={cx(HEAD, "w-[22%] pl-[10px]")}>Role</th>
                <th scope="col" className={cx(HEAD, "w-[26%] pl-[10px]")}>Signing authority</th>
                <th scope="col" className={cx(HEAD, "pl-[10px] pr-0")}>Last active</th>
              </tr>
            </thead>
            <tbody>
              {view.people.map((p) => (
                <tr key={p.id} data-person={p.email ?? p.name}>
                  <td className={cx(CELL, "py-[11px] pr-[10px]")}>
                    <span className="block text-[13.5px] font-medium">{p.name}</span>
                    {p.email ? <span className="block mt-[2px] font-mono text-[10px] text-n600">{p.email}</span> : null}
                  </td>
                  <td className={cx(CELL, "py-[11px] px-[10px] text-[13px]")}>{p.role}</td>
                  <td className={cx(CELL, "py-[11px] px-[10px] font-mono text-[11px]", TONE[p.signingTone])} data-signing>
                    {p.signing}
                  </td>
                  <td className={cx(CELL, "py-[11px] pl-[10px] font-mono text-[10px] text-n600")}>{p.last}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {view.invitations > 0 ? (
            <p className="mt-[8px] mb-0 font-mono text-[10.5px] text-n600" data-invitations>
              {view.invitations} PENDING INVITATION{view.invitations === 1 ? "" : "S"} · LISTED IN PEOPLE AND ROLES
            </p>
          ) : null}
          {alone ? (
            <div className="mt-[14px] max-w-[640px]">
              <EmptyState
                where="EMPTY · PEOPLE"
                title="Nobody else is in this workspace yet"
                body="Invite colleagues as editors or viewers, and external people with an end date. Viewers never use a seat."
                action={{ label: "Invite people", href: hrefFor("/w/[workspace]/settings/people", ws) }}
              />
            </div>
          ) : null}
        </section>

        <section aria-labelledby="ov-workspace" data-region="workspace" className="mt-[26px]">
          <Heading href={hrefFor("/w/[workspace]/settings/workspace", ws)} link="Workspace">
            <span id="ov-workspace">Workspace</span>
          </Heading>
          <dl className="m-0 flex flex-col">
            {view.workspace.map((w) => (
              <div key={w.k} className="grid grid-cols-1 gap-[4px] md:grid-cols-[220px_1fr_130px] md:gap-[16px] border-b border-rule py-[12px] px-[2px] items-baseline">
                <dt className="text-[13.5px] font-medium">{w.k}</dt>
                <dd className="m-0 text-[12.5px] leading-[1.5] text-n700">
                  {w.note}
                  {w.link ? (
                    <>
                      {" "}
                      <Link href={hrefFor(w.link.route, ws)} className="text-accent-700 underline">
                        {w.link.label}
                      </Link>
                    </>
                  ) : null}
                </dd>
                <dd className={cx("m-0 font-mono text-[11px] md:text-right", TONE[w.tone])}>{w.v}</dd>
              </div>
            ))}
          </dl>
          <nav aria-label="More settings" className="mt-[18px] flex flex-wrap gap-x-[22px] gap-y-[8px]">
            <Link href={hrefFor("/w/[workspace]/settings/audit", ws)} className={LINK}>
              Audit log →
            </Link>
            <Link href={hrefFor("/w/[workspace]/settings/data", ws)} className={LINK}>
              Data and retention →
            </Link>
            <Link href={`/account?w=${ws}`} className={LINK}>
              Your account →
            </Link>
          </nav>
        </section>
      </div>

      <section aria-labelledby="ov-plan" data-region="plan">
        <Blueprint className="p-[17px] bg-accent-100">
          <p className="m-0 font-mono text-[10px] tracking-[0.12em] uppercase text-accent">Plan</p>
          <h2 id="ov-plan" className="mt-[7px] mb-0 font-head text-[21px] font-semibold leading-[1.15]">
            Recipes, regions and seats
          </h2>
          {view.plan.kind === "read" ? (
            <dl className="mt-[14px] mb-0 flex flex-col">
              {view.plan.lines.map((l) => (
                <div key={l.k} className="border-t border-accent-200 py-[9px] flex gap-[10px] items-baseline">
                  <dt className="flex-1 text-[13px] text-accent-700">{l.k}</dt>
                  <dd className="m-0 font-mono text-[11.5px] text-accent-700 text-right">{l.v}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-[14px] mb-0 border-t border-accent-200 pt-[9px] text-[13px] leading-[1.55] text-accent-700" data-no-billing>
              The plan is managed by an internal admin of the whole workspace.
            </p>
          )}
          <p className="mt-[13px] mb-0 text-[12.5px] leading-[1.55] text-accent-700">
            Checks and re-checks are never metered. The plan prices recipes, regions and editor seats; viewers are free.
          </p>
          {view.plan.kind === "read" ? (
            <Link href={hrefFor("/w/[workspace]/settings/billing", ws)} className={cx(LINK, "inline-block mt-[13px]")}>
              Plan and allowance →
            </Link>
          ) : null}
        </Blueprint>
      </section>
    </div>
  );
}
