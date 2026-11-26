"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Blueprint, Button, cx } from "@/components/kit";
import type { FixtureReview, ProposedFixture } from "@/lib/admin/reads";
import { fixtureSummary } from "@/lib/admin/model";
import { decideFixture } from "../actions";

// #360 (docs/12 Thursday, docs/13): `nutrivo fixtures draft` proposes passed, failed and withheld fixtures for each
// accepted rule version, built from its own params and linked accepted terms and checked by the engine. The
// accepting person confirms or rejects each one here (app.decide_rule_fixture, staff at aal2). Only confirmed fixtures
// count for complete coverage (BE-10), the release gate (K05) and `nutrivo fixtures run`.

const caption = "block font-mono text-[9.5px] tracking-[0.12em] uppercase text-n600";
const OUTCOMES = ["passed", "failed", "withheld"];

type Said = { tone: "done" | "refused"; text: string; fixture: string } | null;

function FixtureRow({ fixture, ruleKey, version, said, setSaid }: {
  fixture: ProposedFixture;
  ruleKey: string;
  version: number;
  said: Said;
  setSaid: (s: Said) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [acting, setActing] = useState<"confirm" | "reject" | null>(null);
  const s = fixtureSummary(fixture.input, fixture.expected);
  const nameId = `fixture-${fixture.id}`;

  function decide(decision: "confirm" | "reject") {
    setActing(decision);
    start(async () => {
      const result = await decideFixture(fixture.id, decision, null);
      setActing(null);
      if (result.ok) {
        const v = result.value as { tested?: boolean } | null;
        const verb = decision === "confirm" ? "Confirmed" : "Rejected";
        const tested = v?.tested ? ` ${ruleKey} v${version} now has confirmed passed, failed and withheld fixtures.` : "";
        setSaid({ tone: "done", fixture: fixture.id, text: `${verb} “${fixture.name}” for ${ruleKey} v${version}.${tested}` });
        router.refresh();
      } else setSaid({ tone: "refused", fixture: fixture.id, text: result.message });
    });
  }

  return (
    <li data-fixture={fixture.id} data-outcome={fixture.expectedOutcome} className="border-t border-rule pt-[10px]">
      <p className="m-0 flex flex-wrap items-baseline gap-x-[8px]">
        <span className="font-mono text-[10.5px] tracking-[0.08em] uppercase text-ink">Expected: {fixture.expectedOutcome}</span>
        <span id={nameId} className="text-[13px] text-n700 break-all">{fixture.name}</span>
      </p>
      <dl className="mt-[6px] mb-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-[10px] gap-y-[2px] text-[12.5px]">
        <dt className="text-n600">Panel</dt>
        <dd className="m-0">{s.language}</dd>
        <dt className="text-n600">Printed</dt>
        <dd className="m-0 break-words" data-printed>{s.printed}</dd>
        <dt className="text-n600">Market</dt>
        <dd className="m-0">{s.node}</dd>
        {s.facts ? (
          <>
            <dt className="text-n600">Facts</dt>
            <dd className="m-0 break-words">{s.facts}</dd>
          </>
        ) : null}
        {s.expected ? (
          <>
            <dt className="text-n600">Expects</dt>
            <dd className="m-0 break-words">{s.expected}</dd>
          </>
        ) : null}
      </dl>
      <details className="mt-[6px]">
        <summary className="cursor-pointer text-[12.5px] text-ink underline">The whole input</summary>
        <pre className="mt-[6px] mb-0 p-[8px] bg-panel border border-rule font-mono text-[11px] whitespace-pre-wrap break-words">
          {JSON.stringify(fixture.input, null, 2)}
        </pre>
      </details>
      <div className="mt-[8px] flex flex-wrap items-center gap-[8px]">
        <Button type="button" variant="primary" aria-describedby={nameId} disabled={pending} onClick={() => decide("confirm")}>
          {acting === "confirm" ? "Confirming…" : "Confirm"}
        </Button>
        <Button type="button" variant="secondary" aria-describedby={nameId} disabled={pending} onClick={() => decide("reject")}>
          {acting === "reject" ? "Rejecting…" : "Reject"}
        </Button>
        {fixture.proposedBy ? <span className="text-[12px] text-n600">Proposed by {fixture.proposedBy}</span> : null}
      </div>
      {said?.fixture === fixture.id && said.tone === "refused" ? (
        <p className="mt-[6px] mb-0 text-[13px] text-blocked">{said.text}</p>
      ) : null}
    </li>
  );
}

/** Proposed fixtures per accepted rule version, each confirmed or rejected by the person (#360). */
export function ProposedFixtures({ reviews }: { reviews: FixtureReview[] }) {
  const [said, setSaid] = useState<Said>(null);
  return (
    <section aria-labelledby="proposed-fixtures">
      <Blueprint className="py-[18px] px-[20px]">
        <h2 id="proposed-fixtures" className="m-0 font-head text-[18px] font-semibold tracking-[-0.01em]">Accepted rules: proposed fixtures</h2>
        <p className="mt-[4px] mb-0 text-[13px] text-n700">
          Drafted by <code className="font-mono text-[12px]">nutrivo fixtures draft</code> from each version&rsquo;s own params and linked
          register terms, and checked by the engine. Confirm a fixture only when its input and expected outcome follow the text. Only
          confirmed fixtures count for complete coverage and the release.
        </p>
        <p role="status" data-said="fixtures" data-tone={said?.tone ?? ""} className={cx("mt-[8px] mb-0 text-[13px] min-h-[20px]", said?.tone === "refused" ? "text-blocked" : "text-n700")}>
          {said?.tone === "done" ? said.text : ""}
        </p>
        {reviews.length === 0 ? (
          <p data-empty="fixtures" className="mt-[8px] mb-0 text-[13px] text-n700">
            No fixture is waiting for a decision. The weekly content run proposes them for accepted rule versions that lack confirmed
            passed, failed and withheld fixtures.
          </p>
        ) : (
          <ul className="mt-[8px] mb-0 p-0 list-none flex flex-col gap-[14px]">
            {reviews.map((r) => (
              <li key={`${r.ruleKey}:${r.version}`} data-fixture-review={`${r.ruleKey}:${r.version}`}>
                <p className="m-0 font-head text-[15px] font-semibold break-all">
                  {r.ruleKey} <span className="font-mono text-[11px] font-normal text-n600">v{r.version}</span>
                </p>
                {r.title ? <p className="mt-[2px] mb-0 text-[13px] text-n700">{r.title}</p> : null}
                <p className={cx(caption, "mt-[4px]")} data-confirmed>
                  Confirmed: {OUTCOMES.map((o) => `${o} ${r.confirmed.includes(o) ? "yes" : "no"}`).join(" · ")}
                </p>
                <ul className="mt-[6px] mb-0 p-0 list-none flex flex-col gap-[10px]">
                  {r.proposed.map((f) => (
                    <FixtureRow key={f.id} fixture={f} ruleKey={r.ruleKey} version={r.version} said={said} setSaid={setSaid} />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Blueprint>
    </section>
  );
}
