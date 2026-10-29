"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type ReactNode } from "react";
import { Blueprint, Button, Dialog, EmptyState, NoPermissionState, cx } from "@/components/kit";
import { useShell } from "@/components/shell/context";
import { changeMember, inviteMember, removeMember, revokeInvitation, type Result } from "@/lib/settings/actions";
import {
  ROLE_TITLE,
  formatDate,
  isLastAdmin,
  relativeTime,
  scopeText,
  seatChip,
  seatCount,
  seatLine,
  usesSeat,
  type InvitationRow,
  type MemberRow,
  type PeopleData,
} from "@/lib/settings/people";
import { ROLE_LABEL, hrefFor } from "@/lib/shell/routes";
import { Field, HELP, INPUT, KICKER, ScopeFields, endsAt, type ScopeState } from "./fields";
import { SettingsHeader, SettingsMain } from "./SettingsFrame";

// S-WSS-001 People and roles (design: product/Nutrivo Workspace Settings.dc.html, screen "people"). A03 invite, A05
// change, A06 remove, through the RPCs only. The right-hand cards are the design's copy word for word. Each row has
// one control, "Manage", which opens what can be done to that person or invitation; the design draws no row action.

const COLS = "minmax(0,1.3fr) 156px minmax(0,1fr) 118px 96px 92px";

const FOUR_ROLES: { k: string; v: string; cost: string; free?: boolean }[] = [
  { k: "Admin", v: "Workspace, billing, people, and who holds signing authority.", cost: "SEAT" },
  { k: "Portfolio manager", v: "Every recipe and market, and can act on any finding.", cost: "SEAT" },
  { k: "Editor", v: "Runs checks and edits recipes in their scope.", cost: "SEAT" },
  { k: "Viewer", v: "Reads answers and reports. Changes nothing.", cost: "FREE", free: true },
];

const EXTERNAL: { k: string; v: string }[] = [
  {
    k: "Does not consume a seat differently",
    v: "An external editor takes an editor seat; an external viewer is free. The flag never changes what somebody costs — the role does that.",
  },
  {
    k: "Cannot be granted signing authority",
    v: "A Certificate of Check is attested by a person inside the company named on the label. The grant screen will not offer an external person.",
  },
  { k: "Can be given an end date", v: "Access ends on the date without anybody remembering to remove them. Optional, and the default is no end date." },
  {
    k: "Reads as external in the audit log",
    v: "Every event they generate carries the flag, so a reviewer can tell in-house work from delegated work without knowing the names.",
  },
];

type Open =
  | { kind: "invite" }
  | { kind: "member"; row: MemberRow }
  | { kind: "remove"; row: MemberRow }
  | { kind: "invitation"; row: InvitationRow };

type Notice = { text: string; tone: "done" | "problem"; upsell?: boolean };

const REFUSAL: Record<string, string> = {
  "no-permission": "Only an admin of this workspace can do that.",
  "no-seat": "Every editor seat on this plan is in use, so nothing was changed.",
  "last-admin": "The last admin cannot be removed, demoted or given an end date. Make somebody else admin first.",
  ended: "This person's membership has already ended. Nothing was changed.",
  accepted: "This invitation was accepted meanwhile. Remove the member instead.",
  invalid: "That was not saved: check the fields and try again.",
  error: "Nothing was changed. Try again.",
};

function noticeOf(result: Result, done: string): Notice {
  if (result.ok) return { text: done, tone: "done" };
  return { text: result.problem ?? REFUSAL[result.reason], tone: "problem", upsell: result.reason === "no-seat" };
}

export function People({ workspaceId, data, now }: { workspaceId: string; data: PeopleData; now: string }) {
  const { current } = useShell();
  const at = new Date(now);
  const count = seatCount(data.members, data.editorSeats, at);
  const admin = current.role === "admin";
  return (
    <>
      <SettingsHeader title="People and roles" chip={admin ? seatChip(count) : undefined} />
      <SettingsMain>
        {admin ? (
          <PeopleScreen workspaceId={workspaceId} data={data} at={at} line={seatLine(count)} />
        ) : (
          <div className="max-w-[640px]">
            <NoPermissionState
              where="NO PERMISSION · SETTINGS"
              title="Your role cannot open People and roles"
              body={`You are ${/^[aeiou]/i.test(ROLE_LABEL[current.role]) ? "an" : "a"} ${ROLE_LABEL[current.role]} in ${current.name}. Inviting people and changing roles need an ${ROLE_LABEL.admin}.`}
              aside={`An admin of ${current.name} can invite people or change your role.`}
            />
          </div>
        )}
      </SettingsMain>
    </>
  );
}

function PeopleScreen({ workspaceId, data, at, line }: { workspaceId: string; data: PeopleData; at: Date; line: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [dialog, setDialog] = useState<Open | null>(null);
  const open = (next: Open) => {
    setNotice(null);
    setDialog(next);
  };
  const { current } = useShell();

  /** Runs one write, closes the dialog when it succeeded, re-reads the screen, and says what happened. */
  function act(run: () => Promise<Result>, done: string) {
    setNotice(null);
    start(async () => {
      const result = await run();
      setNotice(noticeOf(result, done));
      if (result.ok) {
        setDialog(null);
        router.refresh();
      }
    });
  }

  const rows: (MemberRow | InvitationRow)[] = [...data.members, ...data.invitations];
  // A refusal while a dialog is open is said inside it, where the person is looking; the dialog stays open.
  const problem = dialog && notice ? <NoticeLine notice={notice} workspaceId={workspaceId} inDialog /> : null;
  const alone = data.members.length === 1 && data.invitations.length === 0;

  return (
    <div data-screen="S-WSS-001">
      <Blueprint as="section">
        <div className="flex flex-wrap items-center justify-between gap-[20px] py-[16px] px-[20px] border-b border-ink">
          <div>
            <h2 className="m-0 text-[16px] font-semibold tracking-normal">People in this workspace</h2>
            <p className="mt-[4px] mb-0 font-mono text-[10.5px] tracking-[0.05em] text-n600" data-testid="seat-line">
              {line}
            </p>
          </div>
          <Button variant="primary" size="md" onClick={() => open({ kind: "invite" })}>
            Invite a person
          </Button>
        </div>
        <div aria-live="polite">{notice && !dialog ? <NoticeLine notice={notice} workspaceId={workspaceId} /> : null}</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse table-fixed">
            <caption className="sr-only">People and pending invitations in {current.name}</caption>
            <colgroup>
              {COLS.split(" ").map((w, i) => (
                <col key={i} style={w.startsWith("minmax") ? undefined : { width: w }} />
              ))}
            </colgroup>
            <thead>
              <tr className="bg-panel border-b border-ink">
                {["Person", "Role", "Scope", "Seat", "Last active", "Actions"].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="py-[10px] px-[15px] text-left font-mono text-[9.5px] tracking-[0.1em] uppercase text-n600 font-normal"
                  >
                    {h === "Actions" ? <span className="sr-only">Actions</span> : h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <PersonRow
                  key={row.id}
                  row={row}
                  data={data}
                  at={at}
                  striped={i % 2 === 1}
                  last={i === rows.length - 1}
                  onManage={() => open(row.kind === "member" ? { kind: "member", row } : { kind: "invitation", row })}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Blueprint>

      {alone ? (
        <div className="mt-[20px] max-w-[640px]">
          <EmptyState
            where="PEOPLE · ONLY YOU"
            title="Nobody else is in this workspace yet"
            body="Invite the people who check labels with you. Viewers are free; admins, portfolio managers and editors each use an editor seat."
            action={{ label: "Invite a person", onClick: () => open({ kind: "invite" }) }}
          />
        </div>
      ) : null}

      <div className="mt-[20px] grid gap-[20px] items-start grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <Blueprint className="py-[20px] px-[22px]" as="section">
          <div data-testid="four-roles">
            <h2 className={cx(KICKER, "text-accent font-normal tracking-[0.12em]")}>Four roles</h2>
            <dl className="mt-[13px] mb-0 flex flex-col gap-[9px]">
              {FOUR_ROLES.map((r) => (
                <div
                  key={r.k}
                  className="grid grid-cols-[128px_minmax(0,1fr)_66px] gap-[12px] items-baseline border-b border-n200 pb-[9px]"
                >
                  <dt className="font-mono text-[11px] tracking-[0.04em]">{r.k}</dt>
                  <dd className="m-0 text-[12.5px] leading-[1.45] text-n700">{r.v}</dd>
                  <dd className={cx("m-0 font-mono text-[10px] tracking-[0.05em] text-right", r.free ? "text-clear" : "text-n600")}>
                    {r.cost}
                  </dd>
                </div>
              ))}
            </dl>
            <h3 className={cx(KICKER, "mt-[18px] pt-[14px] border-t border-ink text-accent font-normal")}>And one flag: external</h3>
            <p className="mt-[9px] mb-0 text-[13px] leading-[1.55] text-n700">
              A consultant is not a fifth role. They are an editor or a viewer, scoped, marked external. Being outside your
              company is a fact about the person, not a set of permissions, and it changes four things.
            </p>
            <ul className="mt-[13px] mb-0 p-0 list-none flex flex-col gap-[9px]">
              {EXTERNAL.map((x) => (
                <li key={x.k} className="border-l-[3px] border-accent pl-[13px]">
                  <p className="m-0 text-[13px] font-semibold">{x.k}</p>
                  <p className="mt-[4px] mb-0 text-[12.5px] leading-[1.45] text-n700">{x.v}</p>
                </li>
              ))}
            </ul>
          </div>
        </Blueprint>
        <div className="flex flex-col gap-[18px]" data-testid="people-notes">
          <Note edge="border-l-4 border-l-clear" title="A supplier is not a person here at all">
            Suppliers and contract manufacturers get a scoped upload link with no account, so they are not on this screen
            and not marked external. You are never charged for their access, and they never see anything but the request.
          </Note>
          <Note edge="border-l-4 border-l-blocked" title="Signer is not a role either">
            Signing authority attaches to a named person for named markets and is granted on its own screen. Changing
            somebody&apos;s role never grants or removes it, and an external person is never offered it.
          </Note>
          <Note quiet title="Removing somebody">
            Their access ends immediately. Their name stays on every check they ran and every document they signed,
            because the history is append-only and a record with a hole in it is not a record.
          </Note>
        </div>
      </div>

      {dialog?.kind === "invite" ? (
        <InviteDialog
          problem={problem}
          data={data}
          pending={pending}
          onClose={() => { setNotice(null); setDialog(null); }}
          onSend={(email, s) => {
            const resend = data.invitations.some((i) => i.email.toLowerCase() === email.trim().toLowerCase());
            act(
              () => inviteMember(workspaceId, { email, role: s.role, external: s.external, familyIds: s.familyIds, nodeIds: s.nodeIds, endsAt: endsAt(s.endsOn) }),
              resend
                ? `${email.trim()} already had a pending invitation, so it was sent again with a new link. Its role and scope stay as they were.`
                : `Invitation sent to ${email.trim()}.`,
            );
          }}
        />
      ) : null}
      {dialog?.kind === "member" ? (
        <MemberDialog
          problem={problem}
          row={dialog.row}
          data={data}
          pending={pending}
          lastAdmin={isLastAdmin(dialog.row, data.members, at)}
          onClose={() => { setNotice(null); setDialog(null); }}
          onSave={(s) =>
            act(
              () => changeMember(dialog.row.id, { role: s.role, external: s.external, familyIds: s.familyIds, nodeIds: s.nodeIds, endsAt: endsAt(s.endsOn) }),
              `${dialog.row.name} was updated.`,
            )
          }
          onRemove={() => open({ kind: "remove", row: dialog.row })}
        />
      ) : null}
      {dialog?.kind === "remove" ? (
        <RemoveDialog
          problem={problem}
          row={dialog.row}
          pending={pending}
          onClose={() => { setNotice(null); setDialog(null); }}
          onRemove={(reason) => act(() => removeMember(dialog.row.id, reason), `${dialog.row.name} was removed. Their access has ended.`)}
        />
      ) : null}
      {dialog?.kind === "invitation" ? (
        <InvitationDialog
          problem={problem}
          row={dialog.row}
          pending={pending}
          onClose={() => { setNotice(null); setDialog(null); }}
          onResend={() =>
            act(
              () =>
                inviteMember(workspaceId, {
                  email: dialog.row.email,
                  role: dialog.row.role,
                  external: dialog.row.external,
                  familyIds: dialog.row.scope.familyIds,
                  nodeIds: dialog.row.scope.nodeIds,
                  endsAt: dialog.row.scope.endsAt,
                }),
              `The invitation to ${dialog.row.email} was sent again with a new link.`,
            )
          }
          onRevoke={() => act(() => revokeInvitation(dialog.row.id), `The invitation to ${dialog.row.email} was revoked. Its link no longer works.`)}
        />
      ) : null}
    </div>
  );
}

function NoticeLine({ notice, workspaceId, inDialog }: { notice: Notice; workspaceId: string; inDialog?: boolean }) {
  return (
    <p
      role={notice.tone === "problem" ? "alert" : "status"}
      className={cx(
        "m-0 py-[10px] text-[12.5px] leading-[1.5]",
        inDialog ? "px-[12px] mb-[4px]" : "px-[20px] border-b border-n200",
        notice.tone === "problem" ? "text-blocked bg-blocked-bg" : "text-clear bg-clear-bg",
      )}
    >
      {notice.text}
      {notice.upsell ? (
        <>
          {" "}
          <Link href={hrefFor("/w/[workspace]/billing/plans", workspaceId)} className="font-medium">
            See the plans with more seats
          </Link>
        </>
      ) : null}
    </p>
  );
}

function Note({ title, children, edge, quiet }: { title: string; children: ReactNode; edge?: string; quiet?: boolean }) {
  return (
    <Blueprint edge={edge} className={cx("py-[18px] px-[20px]", quiet && "border-rule")}>
      <p className="m-0 text-[13.5px] font-semibold">{title}</p>
      <p className={cx("mt-[6px] mb-0 leading-[1.5] text-n700", quiet ? "text-[12.5px]" : "text-[13px]")}>{children}</p>
    </Blueprint>
  );
}

function PersonRow({
  row,
  data,
  at,
  striped,
  last,
  onManage,
}: {
  row: MemberRow | InvitationRow;
  data: PeopleData;
  at: Date;
  striped: boolean;
  last: boolean;
  onManage: () => void;
}) {
  const member = row.kind === "member";
  const name = member ? row.name : row.email;
  const lapsed = !member && new Date(row.expiresAt) <= at;
  return (
    <tr className={cx(striped && "bg-panel", !last && "border-b border-n200")} data-row={row.kind} data-email={member ? row.email ?? "" : row.email}>
      <td className="py-[12px] px-[15px] align-top">
        <p className="m-0 text-[13.5px] font-medium break-words">
          {name}
          {row.external ? (
            <span className="ml-[7px] border border-n400 text-n700 bg-paper py-[2px] px-[5px] font-mono text-[9px] tracking-[0.06em]">
              EXTERNAL
            </span>
          ) : null}
        </p>
        <p className="mt-[3px] mb-0 text-[11.5px] text-n600 break-words">
          {member ? row.email : lapsed ? "Invitation lapsed · not accepted" : "Invitation pending"}
        </p>
      </td>
      <td className="py-[12px] px-[15px] align-top font-mono text-[11px] tracking-[0.04em]">{ROLE_TITLE[row.role]}</td>
      <td className="py-[12px] px-[15px] align-top text-[12.5px] leading-[1.45] text-n700">
        {scopeText(row.role, row.external, row.scope, data.families, data.markets, at)}
      </td>
      <td className={cx("py-[12px] px-[15px] align-top font-mono text-[10.5px] tracking-[0.05em]", usesSeat(row.role) ? "text-n600" : "text-clear")}>
        {usesSeat(row.role) ? (member ? "SEAT" : "SEAT ON ACCEPT") : "FREE"}
      </td>
      <td className="py-[12px] px-[15px] align-top text-[11.5px] text-n600">
        {member ? relativeTime(row.lastActive, at) : lapsed ? `Lapsed ${formatDate(row.expiresAt)}` : `Sent ${formatDate(row.sentAt)}`}
      </td>
      <td className="py-[8px] px-[10px] align-top text-right">
        <Button variant="ghost" onClick={onManage} aria-label={`Manage ${name}`}>
          Manage
        </Button>
      </td>
    </tr>
  );
}

const blank = (): ScopeState => ({ role: "editor", external: false, familyIds: null, nodeIds: null, endsOn: "" });

function InviteDialog({
  problem,
  data,
  pending,
  onClose,
  onSend,
}: {
  problem: ReactNode;
  data: PeopleData;
  pending: boolean;
  onClose: () => void;
  onSend: (email: string, scope: ScopeState) => void;
}) {
  const emailId = useId();
  const [email, setEmail] = useState("");
  const [scope, setScope] = useState<ScopeState>(blank);
  return (
    <Dialog
      open
      onClose={onClose}
      kicker="People and roles"
      title="Invite a person"
      confirmLabel={pending ? "Sending…" : "Send invitation"}
      onConfirm={() => !pending && onSend(email, scope)}
    >
      <div className="flex flex-col gap-[13px]">
        {problem}
        <Field id={emailId} label="Work email" help="The link in the email works once, for this address only, for seven days.">
          <input
            id={emailId}
            type="email"
            autoComplete="off"
            className={INPUT}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <ScopeFields value={scope} onChange={setScope} families={data.families} markets={data.markets} />
      </div>
    </Dialog>
  );
}

function MemberDialog({
  problem,
  row,
  data,
  pending,
  lastAdmin,
  onClose,
  onSave,
  onRemove,
}: {
  problem: ReactNode;
  row: MemberRow;
  data: PeopleData;
  pending: boolean;
  lastAdmin: boolean;
  onClose: () => void;
  onSave: (scope: ScopeState) => void;
  onRemove: () => void;
}) {
  const [scope, setScope] = useState<ScopeState>({
    role: row.role,
    external: row.external,
    familyIds: row.scope.familyIds,
    nodeIds: row.scope.nodeIds,
    endsOn: row.scope.endsAt ? row.scope.endsAt.slice(0, 10) : "",
  });
  return (
    <Dialog
      open
      onClose={onClose}
      kicker={row.email ?? "Member"}
      title={`Change ${row.name}`}
      confirmLabel={pending ? "Saving…" : "Save changes"}
      onConfirm={() => !pending && onSave(scope)}
    >
      <div className="flex flex-col gap-[13px]">
        {problem}
        {lastAdmin ? (
          <p className="m-0 py-[8px] px-[10px] border-l-[3px] border-action bg-action-bg text-[12.5px] leading-[1.5]">
            {row.name} is the only admin. The workspace always keeps one, so they cannot be demoted, given an end date or
            removed until somebody else is made admin.
          </p>
        ) : null}
        <ScopeFields value={scope} onChange={setScope} families={data.families} markets={data.markets} />
        <p className={HELP}>A role change never grants or removes signing authority. Becoming external revokes it.</p>
        <div className="pt-[12px] border-t border-n200">
          <Button variant="secondary" className="border-blocked text-blocked hover:border-blocked hover:text-blocked hover:bg-blocked-bg" onClick={onRemove}>
            Remove from the workspace
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function RemoveDialog({
  problem,
  row,
  pending,
  onClose,
  onRemove,
}: {
  problem: ReactNode;
  row: MemberRow;
  pending: boolean;
  onClose: () => void;
  onRemove: (reason: string) => void;
}) {
  const reasonId = useId();
  const [reason, setReason] = useState("");
  return (
    <Dialog
      open
      onClose={onClose}
      kicker={row.email ?? "Member"}
      title={`Remove ${row.name}?`}
      confirmLabel={pending ? "Removing…" : `Remove ${row.name}`}
      onConfirm={() => !pending && onRemove(reason)}
    >
      {problem}
      <p className="mt-0 mb-[12px]">
        Their access ends at once and they are signed out. Their name stays on every check they ran and every document
        they signed. Any signing authority they hold is revoked.
      </p>
      <Field id={reasonId} label="Reason (optional, kept in the audit log)">
        <input id={reasonId} type="text" className={INPUT} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Dialog>
  );
}

function InvitationDialog({
  problem,
  row,
  pending,
  onClose,
  onResend,
  onRevoke,
}: {
  problem: ReactNode;
  row: InvitationRow;
  pending: boolean;
  onClose: () => void;
  onResend: () => void;
  onRevoke: () => void;
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      kicker="Pending invitation"
      title={row.email}
      confirmLabel={pending ? "Sending…" : "Send it again"}
      onConfirm={() => !pending && onResend()}
    >
      {problem}
      <p className="mt-0 mb-[10px]">
        Invited as {ROLE_TITLE[row.role].toLowerCase()}
        {row.external ? ", external," : ""} on {formatDate(row.sentAt)}. The link expires on {formatDate(row.expiresAt)}.
      </p>
      <p className="mt-0 mb-[12px] text-n700">
        Sending it again mints a new link and the old one stops working. To change the role or scope, revoke it and invite
        again.
      </p>
      <Button
        variant="secondary"
        className="border-blocked text-blocked hover:border-blocked hover:text-blocked hover:bg-blocked-bg"
        disabled={pending}
        onClick={onRevoke}
      >
        Revoke the invitation
      </Button>
    </Dialog>
  );
}
