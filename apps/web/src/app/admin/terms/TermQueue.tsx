"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Blueprint, EmptyState, cx } from "@/components/kit";
import type { RuleCandidate, TermCandidate } from "@/lib/admin/reads";
import { languageName } from "@/lib/admin/language";
import { label } from "@/lib/admin/staff";
import { decideTerm } from "../actions";

// The design's routing note, word for word (Nutrivo 2.0, `termRouting`).
const ROUTING = [
  {
    k: "PRESCRIBED · MANDATORY · CLAIM WORDING",
    v: "Double extraction against the cited article, then acceptance by a person. A legal term is a lookup, never a translation.",
    tone: "text-action",
  },
  { k: "NUMERIC THRESHOLDS", v: "Double independent extraction, accepted in-house. Disagreement routes to a person.", tone: "text-na" },
  { k: "STRUCTURAL AND EDITORIAL", v: "Accepted in-house, and never raises an alert.", tone: "text-clear" },
];

const pad = (n: number) => String(n).padStart(2, "0");
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

/** BE-11: a term is accepted only from the stored official text in its own language (app.decide_term checks it too). */
export function fromOwnText(t: TermCandidate) {
  return Boolean(t.source?.storedOfficial && t.source.language === t.language);
}

type Outcome = { tone: "done" | "refused"; text: string } | null;

export function TermQueue({ terms, rules, initial }: { terms: TermCandidate[]; rules: RuleCandidate[]; initial: string | null }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(initial ?? terms[0]?.id ?? null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [pending, start] = useTransition();
  const index = Math.max(0, terms.findIndex((t) => t.id === selectedId));
  const selected = terms[index] ?? null;

  const next = () => terms[(index + 1) % terms.length]?.id ?? null;

  function decide(decision: "accept" | "reject") {
    if (!selected) return;
    const after = terms.length > 1 ? next() : null;
    start(async () => {
      const result = await decideTerm(selected.id, decision, null);
      if (result.ok) {
        setOutcome({ tone: "done", text: `${decision === "accept" ? "Accepted" : "Rejected"}: ${selected.term} (${selected.language.toUpperCase()}). The decision is recorded with your name.` });
        setSelectedId(after);
        router.refresh();
      } else {
        setOutcome({ tone: "refused", text: result.message });
      }
    });
  }

  function hold() {
    if (!selected) return;
    // #35 question 3: holding writes nothing. The entry stays a candidate and the queue moves on.
    setOutcome({ tone: "done", text: `Held for review: ${selected.term} stays in the queue as a candidate. Nothing was recorded.` });
    setSelectedId(next());
  }

  return (
    <main className="flex-1 min-w-0 pt-[24px] px-[16px] md:px-[26px] pb-[48px]">
      {terms.length === 0 ? (
        <div className="max-w-[640px]">
          <EmptyState
            where="QUEUE · INTERNAL"
            title="No term is waiting for acceptance"
            body="Candidate terms appear here once the extraction has read them from a stored official text. Each language's term comes from that language's version of the act."
            aside="Rule candidates are in the rule review queue."
          />
          <p className="mt-[12px] font-mono text-[10.5px]">
            <Link href="/admin/rules">Open the rule review queue →</Link>
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[minmax(220px,280px)_minmax(0,1fr)] gap-[22px] items-start">
          <div>
            <p className="m-0 mb-[10px] font-mono text-[10px] tracking-[0.13em] uppercase text-n500">Queue · internal</p>
            <ul aria-label="Candidate terms" className="m-0 p-0 list-none border border-ink">
              {terms.map((t) => {
                const on = t.id === selected?.id;
                return (
                  <li key={t.id} className="border-b border-rule">
                    <button
                      type="button"
                      aria-current={on ? "true" : undefined}
                      data-term-id={t.id}
                      onClick={() => setSelectedId(t.id)}
                      className={cx("w-full text-left border-0 cursor-pointer py-[10px] px-[12px] text-ink", on ? "bg-accent-100" : "bg-transparent hover:bg-panel")}
                    >
                      <span className="flex items-baseline gap-[8px]">
                        <span className={cx("flex-1 text-[13px] leading-[1.55]", on ? "font-semibold" : "font-normal")}>{t.term}</span>
                        <span className="font-mono text-[9.5px] text-n600">{t.language.toUpperCase()}</span>
                      </span>
                      <span className="block mt-[3px] font-mono text-[9.5px] tracking-[0.06em] uppercase text-n600">{label(t.kind)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div data-region="routing" className="mt-[16px] border border-rule py-[14px] px-[16px] bg-panel">
              <p className="m-0 font-mono text-[10px] tracking-[0.12em] uppercase text-n500">Routing by class</p>
              {ROUTING.map((r) => (
                <p key={r.k} className="mt-[9px] mb-0 text-[12.5px] leading-[1.5] text-n700">
                  <span className={cx("font-mono text-[10px] tracking-[0.06em]", r.tone)}>{r.k}</span>
                  <br />
                  {r.v}
                </p>
              ))}
            </div>
          </div>

          <div>
            {selected ? (
              <Blueprint className="relative py-[20px] px-[22px]">
                <div data-term-detail={selected.id}>
                  <div className="flex items-baseline gap-[10px]">
                    <p className="m-0 font-mono text-[10px] tracking-[0.13em] uppercase text-action">
                      {label(selected.kind)} · extracted, awaiting acceptance
                    </p>
                    <span className="flex-1" />
                    <span className="font-mono text-[10px] text-n600">
                      CANDIDATE {pad(index + 1)} OF {pad(terms.length)}
                    </span>
                  </div>
                  <h2 lang={selected.language} className="mt-[10px] mb-0 font-head text-[30px] font-semibold leading-[1.1] tracking-[-0.03em]">
                    {selected.term}
                  </h2>
                  {fromOwnText(selected) ? (
                    <p className="mt-[8px] mb-0 text-[13px] leading-[1.55] text-n700 max-w-[70ch]">
                      Extracted from the {languageName(selected.language)} text of the source instrument, not translated from English.
                      The English designation is recorded alongside it for reference only and is never used to produce this string.
                    </p>
                  ) : (
                    <p data-be11="refused" className="mt-[8px] mb-0 text-[13px] leading-[1.55] text-blocked max-w-[70ch]">
                      This entry is not from the stored official {languageName(selected.language)} text
                      {selected.source?.language ? ` (its source is the ${languageName(selected.source.language)} text)` : ""}. A term is
                      never derived from another language or translated (BE-11), so it cannot be accepted. Reject it, and extract it again
                      from the {languageName(selected.language)} text.
                    </p>
                  )}
                  <dl className="mt-[18px] mb-0 grid grid-cols-1 sm:grid-cols-2 gap-x-[22px]">
                    {[
                      { k: "Entry class", v: label(selected.kind).replace(/^./, (c) => c.toUpperCase()) },
                      { k: "Source", v: `${selected.source?.title ?? "No source recorded"}, ${selected.articleRef}` },
                      {
                        k: "Instrument language",
                        v: selected.source?.language
                          ? `${languageName(selected.source.language)} — ${selected.source.language === selected.language ? "extracted, not translated" : "not this term's language"}`
                          : "Unknown",
                      },
                      { k: "Ruleset version", v: selected.rulesetVersion ?? "Not yet in a release" },
                      {
                        k: "Source text",
                        v: selected.source ? `${selected.source.celex ?? selected.source.kind}, retrieved ${day(selected.source.retrievedAt)}` : "—",
                      },
                      { k: "English reference only", v: selected.englishReference ?? "None recorded" },
                    ].map((f) => (
                      <div key={f.k} className="border-t border-rule py-[10px]">
                        <dt className="m-0 font-mono text-[9.5px] tracking-[0.12em] uppercase text-n500">{f.k}</dt>
                        <dd data-fact={f.k} className="mt-[4px] mx-0 mb-0 text-[13px] leading-[1.45]">{f.v}</dd>
                      </div>
                    ))}
                  </dl>
                  <div data-region="decision" className="mt-[20px] border-t border-ink pt-[16px] flex flex-wrap gap-[8px] items-center">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={hold}
                      className="bg-accent text-paper border-0 font-mono text-[10.5px] tracking-[0.04em] py-[8px] px-[12px] cursor-pointer hover:bg-accent-600 disabled:opacity-45"
                    >
                      HOLD FOR REVIEW
                    </button>
                    <button
                      type="button"
                      disabled={pending || !fromOwnText(selected)}
                      onClick={() => decide("accept")}
                      className="bg-transparent text-ink border border-n400 font-mono text-[10.5px] tracking-[0.04em] py-[8px] px-[12px] cursor-pointer hover:border-accent disabled:opacity-45 disabled:cursor-not-allowed"
                    >
                      ACCEPT
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => decide("reject")}
                      className="bg-transparent text-ink border border-n400 font-mono text-[10.5px] tracking-[0.04em] py-[8px] px-[12px] cursor-pointer hover:border-accent disabled:opacity-45"
                    >
                      REJECT
                    </button>
                    <span className="text-[12px] text-n600">
                      Every decision is stamped with who made it and when, into the same append-only store as a check.
                    </span>
                  </div>
                </div>
              </Blueprint>
            ) : null}
            <p role="status" data-outcome={outcome?.tone ?? ""} className={cx("mt-[12px] mb-0 text-[13px] min-h-[20px]", outcome?.tone === "refused" ? "text-blocked" : "text-n700")}>
              {outcome?.text ?? ""}
            </p>

            <div className="mt-[20px] flex items-baseline gap-[12px] border-b border-ink pb-[6px]">
              <h2 className="m-0 font-head text-[17px] font-semibold tracking-[-0.03em]">Double extraction, rule candidates</h2>
              <span className="font-mono text-[10.5px] text-n600">Disagreement routes to a person</span>
            </div>
            {rules.length === 0 ? (
              <p className="mt-[10px] text-[13px] text-n700">No rule candidate is waiting.</p>
            ) : (
              <ul aria-label="Rule candidates" className="mt-[4px] mb-0 p-0 list-none">
                {rules.slice(0, 8).map((r) => (
                  <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_118px] gap-[10px] items-baseline border-b border-rule py-[11px]">
                    <Link href={`/admin/rules#c-${r.id}`} className="text-[13px] text-ink">
                      {r.ruleKey ?? "No rule key"} <span className="font-mono text-[11.5px] text-n600">· {r.article}</span>
                    </Link>
                    <span className={cx("font-mono text-[10px] tracking-[0.06em] text-right", r.agree === true ? "text-clear" : r.agree === false ? "text-action" : "text-na")}>
                      {r.agree === true ? "AGREED" : r.agree === false ? "TO A PERSON" : "SECOND KEY PENDING"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
