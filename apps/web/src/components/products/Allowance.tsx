"use client";

import { useState } from "react";
import { Blueprint, Button, ButtonLink, StateGlyph } from "@/components/kit";
import { counterText, type AllowanceMoment } from "@/lib/products/rules";

/** The header counter (Plans and Checkout): from the second free label, amber, with the Action glyph. */
export function AllowanceCounter({ moment }: { moment: AllowanceMoment }) {
  const text = counterText(moment);
  if (!text) return null;
  return (
    <span
      className="inline-flex items-center gap-[8px] py-[5px] px-[10px] border border-action bg-action-bg font-mono text-[10.5px] tracking-[0.05em] uppercase text-n800"
      data-allowance-counter
    >
      <span aria-hidden className="inline-block w-0 h-0 border-l-[5px] border-r-[5px] border-b-[9px] border-l-transparent border-r-transparent border-b-action" />
      {text}
    </span>
  );
}

/** S-PLN-004: one panel when one free label is left. "Not now" hides it for this visit; nothing is recorded. */
export function LastLabelPanel({ workspaceId }: { workspaceId: string }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <section
      className="border border-ink border-l-4 border-l-action bg-paper pt-[19px] pb-[18px] px-[20px] md:max-w-[521px] box-border"
      aria-labelledby="last-label"
      data-last-label
    >
      <h2 id="last-label" className="m-0 font-head text-[15px] leading-[1.5] font-semibold">One free label left</h2>
      <p className="mt-[7px] mb-0 text-[13px] leading-[1.55] text-n700">
        Nothing expires and nothing is taken away. When the third is used you keep all three labels, every finding, every
        report you sent, and re-checking stays free. What stops is adding a fourth.
      </p>
      <div className="mt-[14px] flex flex-wrap gap-[10px]">
        <ButtonLink href={`/w/${workspaceId}/billing/plans`} variant="primary" size="md" className="px-[18px]">
          See what a plan costs for this workspace
        </ButtonLink>
        <Button size="md" onClick={() => setHidden(true)}>Not now</Button>
      </div>
    </section>
  );
}

/**
 * S-PLN-005: all free labels used and this product has no artwork yet, so a new label needs a plan (B02.fail.1).
 * Everything already checked stays: readable, verifiable, re-checkable for free.
 */
export function FourthLabel({ workspaceId, allowed }: { workspaceId: string; allowed: number }) {
  return (
    <div className="flex flex-col gap-[18px]" data-fourth-label>
      <section className="border border-ink border-l-4 border-l-action bg-paper py-[26px] px-[28px] flex flex-wrap items-center gap-[24px]" aria-labelledby="fourth-label">
        <div className="flex-1 min-w-[280px]">
          <p className="m-0 font-mono text-[10px] tracking-[0.13em] uppercase text-action">The fourth label</p>
          <h2 id="fourth-label" className="mt-[10px] mb-0 font-head text-[26px] font-semibold tracking-[-0.02em] leading-[1.15]">
            You have used all {allowed === 3 ? "three" : allowed} free labels
          </h2>
          <p className="mt-[10px] mb-0 text-[14px] leading-[1.6] text-n800">
            Nothing was deleted and nothing was taken away. All {allowed === 3 ? "three" : allowed} labels are here, every
            answer stays readable, every report you sent stays verifiable, and re-checking them is still free. The only
            thing that needs a plan is a fourth label.
          </p>
        </div>
        <ButtonLink href={`/w/${workspaceId}/billing/plans`} variant="primary" size="md" className="text-[15px] py-[12px] px-[22px]">
          Pick a plan
        </ButtonLink>
      </section>
      <Blueprint className="py-[20px] px-[22px]" as="section">
        <p className="m-0 font-mono text-[10px] tracking-[0.13em] uppercase text-clear">Still yours, permanently</p>
        <ul className="mt-[12px] mb-0 p-0 list-none flex flex-col gap-[8px] text-[13.5px] leading-[1.5] text-n800">
          <li className="flex gap-[10px]"><span className="mt-[3px] flex-none"><StateGlyph state="clear" size="sm" /></span>All {allowed === 3 ? "three" : allowed} labels, with their four states and where each answer came from</li>
          <li className="flex gap-[10px]"><span className="mt-[3px] flex-none"><StateGlyph state="clear" size="sm" /></span>Every report you sent, still resolving on the verification page</li>
          <li className="flex gap-[10px]"><span className="mt-[3px] flex-none"><StateGlyph state="clear" size="sm" /></span>Re-checking any of them as often as you like, free</li>
          <li className="flex gap-[10px]"><span className="mt-[3px] flex-none"><StateGlyph state="clear" size="sm" /></span>Monitoring on all of them, so a ruleset move still reaches you</li>
        </ul>
      </Blueprint>
    </div>
  );
}
