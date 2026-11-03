"use client";

import type { ReactNode } from "react";
import { Screen } from "@/components/shell";

// S-MOB-004 Capture (product/Nutrivo Mobile.dc.html, "Photograph a pack"): the framing guidance and what a photograph
// can and cannot be used for. No endpoint takes a pack photo or compares one with approved artwork (#57 question 1),
// so the screen has no Capture control and writes nothing; it says so instead. S-MOB-005 Read back waits for the same
// answer. A photograph is never treated as artwork and never produces a verdict.
export function Capture({ route }: { route: string }) {
  return (
    <Screen route={route} crumb="Portfolio · Pack photo">
      <section aria-label="Photograph a pack" data-region="capture" className="-mx-[16px] -mt-[24px] md:mx-0 md:mt-0 md:max-w-[560px] md:border md:border-rule">
        <Block region="guidance">
          <Kicker>Pack photo</Kicker>
          <h2 className="m-0 font-head text-[14.5px] font-semibold leading-[1.2] tracking-normal">Photograph the panel</h2>
          <Body>Fill the frame with the printed panel and keep it flat. Good light, no flash on gloss.</Body>
        </Block>
        <Block region="purpose">
          <Kicker>What this is for</Kicker>
          <Body first>
            Reading the printed text so we can compare it with the approved artwork. A photograph cannot be measured for
            character height, so it never produces a verdict.
          </Body>
        </Block>
        <Block region="unavailable" last>
          <Kicker>Not available yet</Kicker>
          <Body first>
            Capture opens when photo comparison is built. Until then, compare the pack with its approved artwork at a
            desk, on the product&apos;s label report.
          </Body>
        </Block>
      </section>
    </Screen>
  );
}

function Block({ children, region, last }: { children: ReactNode; region: string; last?: boolean }) {
  return (
    <div data-region={region} className={last ? "p-[14px]" : "p-[14px] border-b border-n200"}>
      {children}
    </div>
  );
}

function Kicker({ children }: { children: ReactNode }) {
  return <p className="mt-0 mb-[5px] font-mono text-[9px] leading-[normal] tracking-[0.09em] uppercase text-n600">{children}</p>;
}

function Body({ children, first }: { children: ReactNode; first?: boolean }) {
  return <p className={`${first ? "mt-0" : "mt-[6px]"} mb-0 text-[12.5px] leading-[1.5] text-n700`}>{children}</p>;
}
