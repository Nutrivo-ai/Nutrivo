"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Blueprint, Button, NoPermissionState, cx } from "@/components/kit";
import { useShell } from "@/components/shell/context";
import { saveOperator } from "@/lib/settings/actions";
import { countryLabel, countryOf } from "@/lib/onboarding/rules";
import { ROLE_LABEL, hrefFor } from "@/lib/shell/routes";
import { HELP, INPUT, KICKER, LABEL } from "./fields";
import { SettingsHeader, SettingsMain } from "./SettingsFrame";

// S-WSS-003 Workspace (design: product/Nutrivo Workspace Settings.dc.html, screen "workspace"). B01: the default
// responsible operator is saved through app.set_default_operator. The workspace's name, region and interface language
// have no write path yet (question 1 on issue #29), so they are shown as stored, read-only; so are the workspace's
// notifications, whose states say what is actually sent. "Close workspace" has no write path either, so the card
// explains closing and offers no button rather than one that does nothing.

export type Operator = { name: string; address: string; country: string; approval_number?: string };

export type WorkspaceView = {
  id: string;
  name: string;
  regions: string[];
  operator: Operator | null;
  marketsInReach: number;
  discontinued: number;
};

const REGION_TEXT: Record<string, string> = {
  EU: "EU · all 27 member states",
  UK: "UK · GB and NI",
  US: "US · federal and all states",
};

/**
 * The design's notification rows. Rule changes (Template 03) and expiring documents (Template 04) are sent today, to
 * each person as their own settings allow; nothing sends the other three yet, so they read OFF.
 */
const NOTIFICATIONS: { k: string; v: string; on: boolean }[] = [
  { k: "A rule changed that affects your recipes", v: "Material changes only, batched daily", on: true },
  { k: "A document is about to expire", v: "At sixty, thirty and seven days", on: true },
  { k: "A report you sent was verified", v: "When a recipient checks the reference", on: false },
  { k: "A check finished", v: "Only for checks you started yourself", on: false },
  { k: "Weekly portfolio summary", v: "Monday morning, counts only", on: false },
];

const NUMBER_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

/** "Six recipes are discontinued." as the design writes it; numerals past ten. */
export function discontinuedLine(n: number) {
  const count = n <= 10 ? NUMBER_WORDS[n] : String(n);
  if (n === 0) return "No recipe is discontinued.";
  return `${count} ${n === 1 ? "recipe is" : "recipes are"} discontinued.`;
}

export function WorkspaceSettings({ view }: { view: WorkspaceView }) {
  const { current } = useShell();
  const admin = current.role === "admin";
  return (
    <>
      <SettingsHeader title="Workspace" chip={`${view.regions.join(" + ")} · ${view.marketsInReach} MARKETS IN REACH`} />
      <SettingsMain>
        {admin ? (
          <WorkspaceScreen view={view} />
        ) : (
          <div className="max-w-[640px]">
            <NoPermissionState
              where="NO PERMISSION · SETTINGS"
              title="Your role cannot open Workspace"
              body={`You are ${/^[aeiou]/i.test(ROLE_LABEL[current.role]) ? "an" : "a"} ${ROLE_LABEL[current.role]} in ${current.name}. The workspace's defaults need an ${ROLE_LABEL.admin}.`}
              aside={`An admin of ${current.name} can change them.`}
            />
          </div>
        )}
      </SettingsMain>
    </>
  );
}

function WorkspaceScreen({ view }: { view: WorkspaceView }) {
  const router = useRouter();
  const ids = { name: useId(), op: useId(), address: useId(), region: useId(), lang: useId() };
  const [name, setName] = useState(view.operator?.name ?? "");
  const [address, setAddress] = useState(view.operator?.address ?? "");
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<{ text: string; ok: boolean } | null>(null);
  const country = countryOf(address.trim());

  function save() {
    setSaid(null);
    start(async () => {
      // The establishment number is not drawn here; the stored one is kept rather than cleared.
      const result = await saveOperator(view.id, { name, address, approval: view.operator?.approval_number ?? "" });
      if (result.ok) {
        setSaid({ ok: true, text: "Saved. New recipes start with this operator; existing recipes are unchanged." });
        router.refresh();
      } else {
        setSaid({
          ok: false,
          text: result.problem ?? (result.reason === "no-permission" ? "Only an admin can change the default operator." : "Nothing was saved. Try again."),
        });
      }
    });
  }

  return (
    <div data-screen="S-WSS-003" className="grid gap-[20px] items-start grid-cols-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      <Blueprint as="section" className="py-[22px] px-[24px]">
        <div data-testid="workspace-form">
          <p className={cx(KICKER, "text-n600")}>This workspace</p>
          <h2 className="mt-[8px] mb-0 text-[21px] font-semibold leading-[1.15]">Name, defaults and language</h2>
          <div className="mt-[20px] flex flex-col gap-[15px]">
            <div>
              <label htmlFor={ids.name} className={LABEL}>
                Workspace name
              </label>
              <input id={ids.name} className={INPUT} type="text" value={view.name} readOnly />
            </div>
            <div className="border-t border-n200 pt-[15px]">
              <div className="flex items-baseline gap-[10px] mb-[6px]">
                <label htmlFor={ids.op} className="text-[12.5px] font-medium">
                  Default responsible operator
                </label>
                <span className="font-mono text-[9.5px] tracking-[0.06em] text-n600">PRE-FILLS NEW RECIPES</span>
              </div>
              <input id={ids.op} className={INPUT} type="text" value={name} maxLength={300} onChange={(e) => setName(e.target.value)} />
              <div className="mt-[10px]">
                <input
                  id={ids.address}
                  className={INPUT}
                  type="text"
                  value={address}
                  maxLength={500}
                  aria-label="Default operator address"
                  aria-describedby={`${ids.address}-help`}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>
              <p id={`${ids.address}-help`} className="mt-[6px] mb-0 text-[12px] leading-[1.45] text-n600">
                Exactly as printed on the label. Every recipe can override it, and changing it here never alters a recipe
                that already exists.
              </p>
              {address.trim() ? (
                <p className="mt-[4px] mb-0 font-mono text-[10px] tracking-[0.05em] text-n600" data-testid="operator-country">
                  {country ? `COUNTRY · ${countryLabel(country).toUpperCase()}` : "COUNTRY · END THE ADDRESS WITH ITS TWO-LETTER CODE"}
                </p>
              ) : null}
            </div>
            <div className="border-t border-n200 pt-[15px] grid grid-cols-1 sm:grid-cols-2 gap-[14px]">
              <div>
                <label htmlFor={ids.region} className={LABEL}>
                  Region
                </label>
                <input id={ids.region} className={INPUT} type="text" readOnly value={view.regions.map((r) => REGION_TEXT[r] ?? r).join(" + ")} />
              </div>
              <div>
                <label htmlFor={ids.lang} className={LABEL}>
                  Interface language
                </label>
                <input id={ids.lang} className={INPUT} type="text" readOnly value="English" />
              </div>
            </div>
            <p className="m-0 text-[12px] leading-[1.5] text-n600">
              The interface language is not the checking language. A label is always checked in the language it is printed
              in, whatever this is set to.
            </p>
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
          {pending ? "Saving…" : "Save workspace"}
        </Button>
      </Blueprint>

      <div className="flex flex-col gap-[18px]">
        <Blueprint as="section" className="py-[20px] px-[22px]">
          <h2 className={cx(KICKER, "text-accent font-normal")}>Notifications</h2>
          <ul className="mt-[13px] mb-0 p-0 list-none flex flex-col gap-[10px]">
            {NOTIFICATIONS.map((n) => (
              <li key={n.k} className="grid grid-cols-[minmax(0,1fr)_74px] gap-[14px] items-center border-b border-n200 pb-[9px]">
                <div>
                  <p className="m-0 text-[13px] font-medium">{n.k}</p>
                  <p className="mt-[3px] mb-0 text-[11.5px] leading-[1.4] text-n600">{n.v}</p>
                </div>
                <span
                  className={cx(
                    "font-mono text-[10px] tracking-[0.06em] text-center border py-[5px]",
                    n.on ? "border-clear bg-clear-bg text-clear" : "border-n400 text-n600",
                  )}
                >
                  {n.on ? "ON" : "OFF"}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-[13px] mb-0 text-[12.5px] leading-[1.5] text-n700">
            Editorial changes to a ruleset never notify anyone, on any setting. They are content operations, not events.
          </p>
        </Blueprint>

        <Blueprint as="section" className="py-[20px] px-[22px]">
          <h2 className={cx(KICKER, "text-n600 font-normal")}>Recipes no longer sold</h2>
          <p className="mt-[10px] mb-0 text-[13px] leading-[1.55] text-n700">
            {discontinuedLine(view.discontinued)} They are excluded from counts, freshness and monitoring, and they are not
            deleted, because certificates issued against them still have to resolve.
          </p>
          <Link
            href={hrefFor("/w/[workspace]/products/discontinued", view.id)}
            className="inline-block mt-[11px] font-mono text-[10.5px] tracking-[0.05em]"
          >
            SEE DISCONTINUED RECIPES
          </Link>
        </Blueprint>

        <Blueprint as="section" edge="border-l-4 border-l-blocked" className="py-[20px] px-[22px]">
          <h2 className={cx(KICKER, "text-blocked font-normal")}>Closing this workspace</h2>
          <p className="mt-[10px] mb-0 text-[13px] leading-[1.55] text-n700">
            It goes dormant rather than being deleted. Nobody can sign in, nothing new can be checked, and every report
            already sent stays verifiable — because somebody outside your company may still be holding one.
          </p>
        </Blueprint>
      </div>
    </div>
  );
}
