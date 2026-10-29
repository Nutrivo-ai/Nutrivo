"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Blueprint, Button, ButtonLink, cx } from "@/components/kit";
import { changePassword, signOutElsewhere } from "@/lib/settings/actions";
import { MIN_PASSWORD } from "@/lib/auth/rules";
import { channelsText, leavingText, type Channels } from "@/lib/settings/account";
import { ROLE_TITLE } from "@/lib/settings/people";
import type { WorkspaceMembership } from "@/lib/workspace/memberships";
import { HELP, INPUT, KICKER, LABEL } from "./fields";
import { SettingsHeader, SettingsMain } from "./SettingsFrame";

// S-WSS-006 Your account (design: product/Nutrivo Workspace Settings.dc.html, screen "account"). A07: the password
// is changed through Supabase Auth and every other session ends. The name and the email have no write path that keeps
// app.people in step (questions 1 and 2 on issue #29), so they are shown read-only. Notification preferences are read
// from app.notification_prefs (a missing row means on) and have no write path yet either. Only this browser's session
// is listed: other sessions are not readable from here (question 4).

export type AccountView = {
  name: string;
  email: string;
  twoStep: boolean;
  /** "Chrome on macOS · signed in 4 Sep, 08:12". */
  thisBrowser: string;
  notices: { ruleChanged: Channels; documentExpiring: Channels };
  /** The workspace whose settings the person came from, if any. */
  current: WorkspaceMembership | null;
  memberships: WorkspaceMembership[];
  /** Active admins of the current workspace other than this person. */
  otherAdmins: number;
};

export function Account({ view }: { view: AccountView }) {
  const router = useRouter();
  const ids = { name: useId(), email: useId(), pw: useId(), again: useId() };
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [elsewhere, setElsewhere] = useState<{ ok: boolean; text: string } | null>(null);
  const chip = view.current ? `${view.name} · ${ROLE_TITLE[view.current.role]}`.toUpperCase() : view.name.toUpperCase();
  const leaving = leavingText(view.current, view.otherAdmins);

  function save() {
    setSaid(null);
    if (!password && !again) {
      setSaid({ ok: false, text: "Nothing to save: type a new password twice to change it." });
      return;
    }
    start(async () => {
      const result = await changePassword(password, again);
      if (result.ok) {
        setPassword("");
        setAgain("");
        setSaid({ ok: true, text: "Password changed. Every other session has been signed out; this one stays." });
        router.refresh();
      } else {
        setSaid({ ok: false, text: result.problem ?? "The password was not changed. Try again." });
      }
    });
  }

  function endOthers() {
    setElsewhere(null);
    start(async () => {
      const result = await signOutElsewhere();
      setElsewhere(result.ok ? { ok: true, text: "Every other session has been signed out." } : { ok: false, text: result.problem ?? "Try again." });
    });
  }

  return (
    <>
      <SettingsHeader title="Your account" chip={chip} current={view.current} memberships={view.memberships} />
      <SettingsMain>
        <div data-screen="S-WSS-006" className="grid gap-[20px] items-start grid-cols-1 lg:grid-cols-2">
          <Blueprint as="section" className="py-[22px] px-[24px]">
            <p className={cx(KICKER, "text-n600")}>You</p>
            <h2 className="mt-[8px] mb-0 text-[21px] font-semibold leading-[1.15]">Name, sign-in and password</h2>
            <div className="mt-[20px] flex flex-col gap-[15px]">
              <div>
                <label htmlFor={ids.name} className={LABEL}>
                  Full name
                </label>
                <input id={ids.name} className={INPUT} type="text" value={view.name} readOnly />
                <p className={HELP}>
                  This name appears on every check you run and every certificate you sign, so it should be the name you would
                  use on a document.
                </p>
              </div>
              <div>
                <label htmlFor={ids.email} className={LABEL}>
                  Email address
                </label>
                <input id={ids.email} className={INPUT} type="email" value={view.email} readOnly />
                <p className={HELP}>The address you sign in with. Invitations and notices for you arrive here.</p>
              </div>
              <div className="border-t border-n200 pt-[15px]">
                <label htmlFor={ids.pw} className={LABEL}>
                  New password
                </label>
                <input
                  id={ids.pw}
                  className={INPUT}
                  type="password"
                  autoComplete="new-password"
                  placeholder={MIN_PASSWORD === 12 ? "At least twelve characters" : `At least ${MIN_PASSWORD} characters`}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <div className="mt-[10px]">
                  <input
                    id={ids.again}
                    className={INPUT}
                    type="password"
                    autoComplete="new-password"
                    placeholder="Type it again"
                    aria-label="Confirm new password"
                    value={again}
                    onChange={(e) => setAgain(e.target.value)}
                  />
                </div>
              </div>
              <div className="border-t border-n200 pt-[15px] flex items-start justify-between gap-[16px]">
                <div>
                  <p className="m-0 text-[13.5px] font-semibold">Two-step sign-in</p>
                  <p className="mt-[5px] mb-0 text-[12.5px] leading-[1.5] text-n700">
                    A code from an authenticator app in addition to your password. Required for anybody holding signing
                    authority.
                  </p>
                  {view.twoStep ? null : (
                    <a href="/auth/mfa?next=%2Faccount" className="inline-block mt-[8px] font-mono text-[10.5px] tracking-[0.05em]">
                      SET UP TWO-STEP SIGN-IN
                    </a>
                  )}
                </div>
                <span
                  data-testid="two-step"
                  className={cx(
                    "flex-none font-mono text-[10px] tracking-[0.06em] border py-[5px] px-[8px]",
                    view.twoStep ? "border-clear bg-clear-bg text-clear" : "border-n400 text-n600",
                  )}
                >
                  {view.twoStep ? "ON" : "OFF"}
                </span>
              </div>
            </div>
            <div aria-live="polite">
              {said ? (
                <p role={said.ok ? "status" : "alert"} className={cx(HELP, "mt-[14px] text-[12.5px]", said.ok ? "text-clear" : "text-blocked")}>
                  {said.text}
                </p>
              ) : null}
            </div>
            <Button variant="primary" size="md" className="mt-[20px] py-[11px] px-[20px] text-[14px]" disabled={pending} aria-busy={pending} onClick={save}>
              Save changes
            </Button>
          </Blueprint>

          <div className="flex flex-col gap-[18px]">
            <Blueprint as="section" className="py-[20px] px-[22px]">
              <h2 className={cx(KICKER, "text-accent font-normal")}>What you get told about</h2>
              <ul className="mt-[13px] mb-0 p-0 list-none flex flex-col gap-[10px]">
                {[
                  { k: "A rule changed that affects my recipes", c: view.notices.ruleChanged },
                  { k: "A document I own is expiring", c: view.notices.documentExpiring },
                  { k: "Somebody verified a report I sent", c: null },
                  { k: "A check I started has finished", c: null },
                ].map((n) => {
                  const state = channelsText(n.c);
                  return (
                    <li key={n.k} className="grid grid-cols-[minmax(0,1fr)_108px] gap-[14px] items-baseline border-b border-n200 pb-[9px]">
                      <span className="text-[13px]">{n.k}</span>
                      <span className={cx("font-mono text-[9.5px] tracking-[0.05em] text-right", state === "OFF" ? "text-n600" : "text-clear")}>
                        {state}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-[13px] mb-0 text-[12.5px] leading-[1.5] text-n700">
                Your own settings, not the workspace&apos;s. An admin sets what the workspace sends; you decide which of it
                reaches you.
              </p>
            </Blueprint>

            <Blueprint as="section" className="py-[20px] px-[22px]">
              <h2 className={cx(KICKER, "text-n600 font-normal")}>Where you are signed in</h2>
              <div className="mt-[13px] flex items-baseline justify-between gap-[14px] border-b border-n200 pb-[10px]">
                <div>
                  <p className="m-0 text-[13px] font-medium">This browser</p>
                  <p className="mt-[3px] mb-0 text-[11.5px] text-n600">{view.thisBrowser}</p>
                </div>
                <span className="flex-none font-mono text-[9.5px] tracking-[0.06em] border border-clear text-clear bg-paper py-[4px] px-[7px]">
                  CURRENT
                </span>
              </div>
              <div aria-live="polite">
                {elsewhere ? (
                  <p role={elsewhere.ok ? "status" : "alert"} className={cx(HELP, "mt-[10px] text-[12.5px]", elsewhere.ok ? "text-clear" : "text-blocked")}>
                    {elsewhere.text}
                  </p>
                ) : null}
              </div>
              <Button variant="secondary" className="mt-[13px]" disabled={pending} onClick={endOthers}>
                Sign out everywhere else
              </Button>
            </Blueprint>

            {leaving ? (
              <Blueprint edge="border-l-4 border-l-action" className="py-[18px] px-[20px]">
                <div data-testid="leaving">
                  <p className="m-0 text-[13.5px] font-semibold">Leaving this workspace</p>
                  <p className="mt-[6px] mb-0 text-[12.5px] leading-[1.5] text-n700">{leaving}</p>
                </div>
              </Blueprint>
            ) : (
              <Blueprint className="py-[18px] px-[20px]">
                <p className="m-0 text-[13.5px] font-semibold">No workspace yet</p>
                <p className="mt-[6px] mb-0 text-[12.5px] leading-[1.5] text-n700">Your account is not in a workspace.</p>
                <ButtonLink href="/onboarding" className="mt-[12px]">
                  Create your workspace
                </ButtonLink>
              </Blueprint>
            )}
          </div>
        </div>
      </SettingsMain>
    </>
  );
}
