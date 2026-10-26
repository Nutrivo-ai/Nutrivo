"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Blueprint, Button, EmptyState, cx } from "@/components/kit";
import type { Extraction, Jurisdiction, RuleCandidate } from "@/lib/admin/reads";
import { languageName } from "@/lib/admin/language";
import { DOMAINS, EFFECT_TYPES, SHAPES, label } from "@/lib/admin/staff";
import { acceptCandidate, rejectCandidate } from "../actions";

// docs/12 "Accepting a rule: the checklist", as the person works through it.
const CHECKLIST = [
  "The excerpt shown is from the stored official text (the sha256 matches ref.sources).",
  "Both extractions agree, or you resolved the difference against the text.",
  "Parameters and units are exactly what the text says; the article reference is exact to the paragraph.",
  "Applicability (species, product class, life stage, market) matches the text, no wider and no narrower.",
  "Dates: effective_from and any sell-through period are set where the act gives them.",
  "Fixtures exist for passed, failed and withheld, and pass (checked again at release).",
];

const field = "block w-full mt-[4px] border border-n400 rounded-control bg-paper py-[6px] px-[8px] text-[13px] text-ink";
const caption = "block font-mono text-[9.5px] tracking-[0.12em] uppercase text-n600";

function ExtractionColumn({ name, x, lang }: { name: string; x: Extraction | null; lang: string | null }) {
  return (
    <div className="border-t border-rule pt-[10px]">
      <p className={caption}>{name}</p>
      {!x ? (
        <p className="mt-[6px] mb-0 text-[13px] text-n700">Not run yet.</p>
      ) : (
        <>
          <p className="mt-[6px] mb-0 font-mono text-[10.5px] text-n700">
            {x.verified ? "VERBATIM" : "NOT VERBATIM"} · {x.found ? "FOUND" : "NOT FOUND"}
          </p>
          <p className="mt-[6px] mb-0 text-[13px]">{x.articleRef ?? "No article reference"}</p>
          <pre className="mt-[6px] mb-0 p-[8px] bg-panel border border-rule font-mono text-[11px] whitespace-pre-wrap break-words">
            {JSON.stringify(x.params ?? {}, null, 2)}
          </pre>
          {x.excerpt ? (
            <blockquote lang={lang ?? undefined} className="mt-[6px] mb-0 mx-0 pl-[10px] border-l-2 border-n400 text-[12.5px] leading-[1.5] text-n800">
              {x.excerpt}
            </blockquote>
          ) : null}
        </>
      )}
    </div>
  );
}

function blockedReason(c: RuleCandidate): string | null {
  if (!c.ruleKey) return "It names no rule key.";
  if (c.agree === null || !c.first || !c.second) return "The second extraction has not run for it yet.";
  if (!c.first.acceptable && !c.second.acceptable) return "Neither extraction is a verified finding with params, article and excerpt.";
  if (!c.source?.storedOfficial) return "Its source is not a stored official text.";
  return null;
}

function Candidate({ c, nodes }: { c: RuleCandidate; nodes: Jurisdiction[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [outcome, setOutcome] = useState<{ tone: "done" | "refused"; text: string } | null>(null);
  const blocked = blockedReason(c);

  function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    start(async () => {
      const result = await acceptCandidate(c.id, form);
      if (result.ok) {
        const v = result.value as { rule_key?: string; version?: number } | null;
        setOutcome({ tone: "done", text: `Accepted as ${v?.rule_key ?? c.ruleKey} v${v?.version ?? "?"}, with your name and the time.` });
        router.refresh();
      } else setOutcome({ tone: "refused", text: result.message });
    });
  }

  function reject() {
    start(async () => {
      const result = await rejectCandidate(c.id, null);
      if (result.ok) {
        setOutcome({ tone: "done", text: "Rejected. The candidate is kept, decided, and never becomes a rule." });
        router.refresh();
      } else setOutcome({ tone: "refused", text: result.message });
    });
  }

  const lang = c.source?.language ?? null;
  return (
    <Blueprint as="article" className="py-[18px] px-[20px]">
      <div id={`c-${c.id}`} data-candidate={c.id}>
        <div className="flex flex-wrap items-baseline gap-[10px]">
          <p className="m-0 font-mono text-[10px] tracking-[0.13em] uppercase text-action">
            {c.decision === "needs_review" ? "Needs review" : "Pending"} ·{" "}
            {c.agree === true ? "keys agree" : c.agree === false ? "keys disagree, to a person" : "second key pending"}
          </p>
          <span className="flex-1" />
          <span className="font-mono text-[10px] text-n600">{c.createdAt.slice(0, 10)}</span>
        </div>
        <h2 className="mt-[8px] mb-0 font-head text-[20px] font-semibold tracking-[-0.02em] break-all">{c.ruleKey ?? "No rule key"}</h2>
        <p className="mt-[4px] mb-0 text-[13px] text-n700">
          {c.article} · {c.source ? `${c.source.title} (${c.source.celex ?? c.source.kind}, ${languageName(c.source.language)})` : "No source"}
          {c.existingRule ? ` · existing rule: ${c.existingRule.title}` : " · new rule key"}
        </p>
        <div className="mt-[12px] grid grid-cols-1 lg:grid-cols-2 gap-[18px]">
          <ExtractionColumn name="First key (K01)" x={c.first} lang={lang} />
          <ExtractionColumn name="Second key (K02)" x={c.second} lang={lang} />
        </div>

        {blocked ? (
          <p data-blocked="true" className="mt-[14px] mb-0 text-[13px] text-n700">
            <span className="font-mono text-[10px] tracking-[0.08em] uppercase text-action">Cannot be accepted yet · </span>
            {blocked}
          </p>
        ) : (
          <form onSubmit={accept} className="mt-[14px] border-t border-ink pt-[12px] grid grid-cols-1 md:grid-cols-2 gap-[12px]">
            <fieldset className="m-0 p-0 border-0 md:col-span-2">
              <legend className={caption}>Accept from the extraction you checked against the text</legend>
              <div className="mt-[6px] flex gap-[18px] text-[13px]">
                {(["first", "second"] as const).map((u) => (
                  <label key={u} className="flex items-center gap-[6px]">
                    <input type="radio" name="use" value={u} required disabled={!(u === "first" ? c.first : c.second)?.acceptable} />
                    {u === "first" ? "First key" : "Second key"}
                  </label>
                ))}
              </div>
            </fieldset>
            {c.existingRule ? (
              <p className="m-0 md:col-span-2 text-[13px] text-n700">
                The rule keeps its shape ({label(c.existingRule.shape)}), domain ({label(c.existingRule.domain)}) and node ({c.existingRule.nodeId}).
              </p>
            ) : (
              <>
                <label className="text-[13px] md:col-span-2">
                  <span className={caption}>Title</span>
                  <input name="title" required className={field} />
                </label>
                <label className="text-[13px]">
                  <span className={caption}>Shape</span>
                  <select name="shape" required defaultValue="" className={field}>
                    <option value="" disabled>Choose</option>
                    {SHAPES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                  </select>
                </label>
                <label className="text-[13px]">
                  <span className={caption}>Domain</span>
                  <select name="domain" required defaultValue="" className={field}>
                    <option value="" disabled>Choose</option>
                    {DOMAINS.map((d) => <option key={d} value={d}>{label(d)}</option>)}
                  </select>
                </label>
                <label className="text-[13px]">
                  <span className={caption}>Held on node</span>
                  <select name="node" required defaultValue="" className={field}>
                    <option value="" disabled>Choose</option>
                    {nodes.map((n) => <option key={n.id} value={n.id}>{n.id} · {n.name}</option>)}
                  </select>
                </label>
              </>
            )}
            <label className="text-[13px] md:col-span-2">
              <span className={caption}>Applicability (docs/05 predicate, no wider and no narrower than the text)</span>
              <textarea name="applicability" required rows={3} placeholder='{"all": [{"eq": ["species", "dog"]}]}' className={cx(field, "font-mono")} />
            </label>
            <label className="text-[13px]">
              <span className={caption}>Effect of the change (BE-09)</span>
              <select name="effect_type" required defaultValue="" className={field}>
                <option value="" disabled>Choose</option>
                {EFFECT_TYPES.map((e) => <option key={e} value={e}>{label(e)}</option>)}
              </select>
            </label>
            <span />
            <label className="text-[13px]">
              <span className={caption}>Effective from</span>
              <input type="date" name="effective_from" className={field} />
            </label>
            <label className="text-[13px]">
              <span className={caption}>Sell-through until</span>
              <input type="date" name="sell_through_until" className={field} />
            </label>
            <div className="md:col-span-2 flex flex-wrap items-center gap-[8px]">
              <Button type="submit" variant="primary" disabled={pending}>Accept this rule version</Button>
              <span className="text-[12px] text-n600">Recorded as accepted by you, now. An accepted version is never changed.</span>
            </div>
          </form>
        )}
        <div className="mt-[10px] flex flex-wrap items-center gap-[8px]">
          <Button variant="secondary" disabled={pending} onClick={reject}>Reject</Button>
          <p role="status" className={cx("m-0 text-[13px]", outcome?.tone === "refused" ? "text-blocked" : "text-n700")}>{outcome?.text ?? ""}</p>
        </div>
      </div>
    </Blueprint>
  );
}

export function RuleQueue({ candidates, nodes }: { candidates: RuleCandidate[]; nodes: Jurisdiction[] }) {
  return (
    <main className="flex-1 min-w-0 pt-[24px] px-[16px] md:px-[26px] pb-[48px]">
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-[22px] items-start">
        <div className="flex flex-col gap-[18px] min-w-0">
          {candidates.length === 0 ? (
            <EmptyState
              where="QUEUE · RULES"
              title="No rule candidate is waiting"
              body="Candidates appear here after the K01 and K02 extractions have read a stored official text. Nothing becomes a rule without a person's acceptance."
            />
          ) : (
            candidates.map((c) => <Candidate key={c.id} c={c} nodes={nodes} />)
          )}
        </div>
        <aside className="border border-rule bg-panel py-[14px] px-[16px]">
          <p className="m-0 font-mono text-[10px] tracking-[0.12em] uppercase text-n500">Accepting a rule: the checklist</p>
          <ul className="mt-[6px] mb-0 pl-[16px] text-[12.5px] leading-[1.5] text-n700">
            {CHECKLIST.map((item) => <li key={item} className="mt-[6px]">{item}</li>)}
          </ul>
        </aside>
      </div>
    </main>
  );
}
