"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Blueprint, Button, cx } from "@/components/kit";
import type { AcceptedRule, LinkableTerm } from "@/lib/admin/reads";
import { MATCHES, SCOPES, currentLinks, hasLinks, label, linkKind, type CurrentLinks } from "@/lib/admin/staff";
import { relinkRule } from "../actions";

// D-31 (T-211): a rule judges printed text only through accepted register terms, linked by the person who accepts it.
// The fields follow the rule's shape (private.term_link_fields, T-209); the database checks every link again.

const field = "block w-full mt-[4px] border border-n400 rounded-control bg-paper py-[6px] px-[8px] text-[13px] text-ink";
const caption = "block font-mono text-[9.5px] tracking-[0.12em] uppercase text-n600";
const EMPTY: CurrentLinks = { detect: [], scope: null, termKey: null, alternatives: [], match: null };

function languages(t: LinkableTerm) {
  return t.entries.map((e) => e.language).join(", ");
}

function TermChoices({ name, legend, terms, chosen, hint }: { name: string; legend: string; terms: LinkableTerm[]; chosen: string[]; hint: string }) {
  return (
    <fieldset className="m-0 p-0 border-0">
      <legend className={caption}>{legend}</legend>
      <p className="mt-[4px] mb-0 text-[12px] text-n600">{hint}</p>
      <div className="mt-[6px] max-h-[180px] overflow-y-auto border border-rule bg-paper py-[6px] px-[8px] flex flex-col gap-[4px]">
        {terms.map((t) => (
          <label key={t.termKey} className="flex items-baseline gap-[6px] text-[13px]">
            <input type="checkbox" name={name} value={t.termKey} defaultChecked={chosen.includes(t.termKey)} />
            <span className="font-mono text-[12px] break-all">{t.termKey}</span>
            <span className="text-[12px] text-n600">· {languages(t)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The link fields for one rule shape, named as linksFromForm reads them. */
export function LinkFields({ shape, terms, current = EMPTY }: { shape: string | null; terms: LinkableTerm[]; current?: CurrentLinks }) {
  const kind = linkKind(shape);
  return (
    <fieldset data-links={kind} className="m-0 p-0 border-0 flex flex-col gap-[10px]">
      <legend className={caption}>Term links (D-31)</legend>
      {!shape ? (
        <p className="m-0 text-[13px] text-n700">Choose the shape first: the links depend on it.</p>
      ) : kind === "none" ? (
        <p className="m-0 text-[13px] text-n700">A {label(shape)} rule links no terms.</p>
      ) : terms.length === 0 ? (
        <p className="m-0 text-[13px] text-n700">
          No term is accepted in the register yet, so there is nothing to link. Accept the terms in{" "}
          <Link href="/admin/terms" className="underline">the term register</Link> first. A rule accepted without links is
          withheld until it is re-linked.
        </p>
      ) : kind === "detect" ? (
        <>
          <TermChoices
            name="link_detect"
            legend="Detected by"
            terms={terms}
            chosen={current.detect}
            hint="The register terms whose printed wording shows this on a panel. Each needs an accepted entry in every language of the markets it covers. None chosen: the rule is withheld until it is re-linked."
          />
          {shape === "mandatory_particular" ? (
            <label className="text-[13px]">
              <span className={caption}>Scope</span>
              <select name="link_scope" defaultValue={current.scope ?? SCOPES[0]} className={field}>
                <option value="each_panel_in_node_language">Each panel in a language of the market</option>
                <option value="any_panel">Any panel of the artwork</option>
              </select>
            </label>
          ) : null}
        </>
      ) : (
        <>
          <label className="text-[13px]">
            <span className={caption}>Prescribed term</span>
            <select name="link_term_key" defaultValue={current.termKey ?? ""} className={field}>
              <option value="">None yet (the rule is withheld)</option>
              {terms.map((t) => (
                <option key={t.termKey} value={t.termKey}>{t.termKey} · {languages(t)}</option>
              ))}
            </select>
          </label>
          <TermChoices
            name="link_alternatives"
            legend="Also permitted"
            terms={terms}
            chosen={current.alternatives}
            hint="Other register terms the text permits instead. Each is read in the panel's own language only."
          />
          <label className="text-[13px]">
            <span className={caption}>Match</span>
            <select name="link_match" defaultValue={current.match ?? MATCHES[0]} className={field}>
              <option value="case_folded">Case-folded</option>
              <option value="exact">Exact</option>
            </select>
          </label>
        </>
      )}
    </fieldset>
  );
}

function linkSummary(rule: AcceptedRule): string {
  if (!hasLinks(rule.params)) return "No term links: the rule is withheld (data_missing).";
  const c = currentLinks(rule.params);
  const parts: string[] = [];
  if (c.detect.length) parts.push(`detected by ${c.detect.join(", ")}`);
  if (c.scope) parts.push(`scope ${label(c.scope)}`);
  if (c.termKey) parts.push(`prescribed ${c.termKey}`);
  if (c.alternatives.length) parts.push(`also ${c.alternatives.join(", ")}`);
  if (c.match) parts.push(`match ${label(c.match)}`);
  return parts.join(" · ");
}

type Said = { rule: string; tone: "done" | "refused"; text: string } | null;

function RuleLinksRow({ rule, terms, said, setSaid }: { rule: AcceptedRule; terms: LinkableTerm[]; said: Said; setSaid: (s: Said) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const kind = linkKind(rule.shape);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    start(async () => {
      const result = await relinkRule(rule.ruleKey, rule.shape, form);
      if (result.ok) {
        const v = result.value as { version?: number } | null;
        setSaid({ rule: rule.ruleKey, tone: "done", text: `Saved ${rule.ruleKey} v${v?.version ?? "?"} with the new links. Add its passed, failed and withheld fixtures; it is checked from the next release.` });
        router.refresh();
      } else setSaid({ rule: rule.ruleKey, tone: "refused", text: result.message });
    });
  }

  return (
    <li data-rule-links={rule.ruleKey} className="border-t border-rule pt-[12px]">
      <p className="m-0 font-head text-[15px] font-semibold break-all">
        {rule.ruleKey} <span className="font-mono text-[11px] font-normal text-n600">v{rule.version} · {label(rule.shape)} · {rule.nodeId}</span>
      </p>
      <p className="mt-[2px] mb-0 text-[13px] text-n700">{rule.title}</p>
      <p data-current-links className="mt-[4px] mb-0 text-[12.5px] text-n700">{linkSummary(rule)}</p>
      {kind === "none" ? null : (
        <details className="mt-[8px]">
          <summary className="cursor-pointer text-[13px] text-ink underline">Change the term links</summary>
          <form onSubmit={save} aria-label={`Term links for ${rule.ruleKey}`} className="mt-[8px] flex flex-col gap-[10px]">
            <LinkFields shape={rule.shape} terms={terms} current={currentLinks(rule.params)} />
            <label className="text-[13px]">
              <span className={caption}>Note (optional)</span>
              <input name="note" className={field} />
            </label>
            <div className="flex flex-wrap items-center gap-[8px]">
              <Button type="submit" variant="primary" disabled={pending || terms.length === 0}>Save as v{rule.version + 1}</Button>
              <span className="text-[12px] text-n600">A new editorial version. Its fixtures are written anew, and it is checked from the next release.</span>
            </div>
          </form>
        </details>
      )}
      {said?.rule === rule.ruleKey && said.tone === "refused" ? <p className="mt-[6px] mb-0 text-[13px] text-blocked">{said.text}</p> : null}
    </li>
  );
}

/** Accepted rules and their links, re-linked with app.relink_rule (D-31). */
export function AcceptedRules({ rules, terms }: { rules: AcceptedRule[]; terms: LinkableTerm[] }) {
  const [said, setSaid] = useState<Said>(null);
  return (
    <section aria-labelledby="accepted-rules">
    <Blueprint className="py-[18px] px-[20px]">
      <h2 id="accepted-rules" className="m-0 font-head text-[18px] font-semibold tracking-[-0.01em]">Accepted rules: term links</h2>
      <p className="mt-[4px] mb-0 text-[13px] text-n700">
        Each rule&rsquo;s latest accepted version and the register terms it judges printed text by. A rule without links is withheld.
      </p>
      <p role="status" data-said="relink" data-tone={said?.tone ?? ""} className={cx("mt-[8px] mb-0 text-[13px] min-h-[20px]", said?.tone === "refused" ? "text-blocked" : "text-n700")}>
        {said?.tone === "done" ? said.text : ""}
      </p>
      {rules.length === 0 ? (
        <p className="mt-[8px] mb-0 text-[13px] text-n700">No rule is accepted yet.</p>
      ) : (
        <ul className="mt-[8px] mb-0 p-0 list-none flex flex-col gap-[12px]">
          {rules.map((r) => <RuleLinksRow key={r.ruleKey} rule={r} terms={terms} said={said} setSaid={setSaid} />)}
        </ul>
      )}
    </Blueprint>
    </section>
  );
}
