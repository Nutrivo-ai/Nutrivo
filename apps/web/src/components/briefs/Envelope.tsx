// T-1002 · E02 Design envelope (S-NV2-005, design "Nutrivo 2.0", screen envelope). What the brief must carry, may say
// and must stay within, per market, from accepted rules only:
// - the three state cards (Clear as briefed, Action needed, Not assessed) list the markets in each, as written by the
//   worker (Clear only for a fully encoded market with nothing withheld: private.envelope_verdict_guard);
// - "The envelope": each additive of the brief with its register ceiling per market (N/A where it was withheld);
// - "Wording you can use": the term register's own wording per language, with the rule's citation and provenance;
// - "Not assessed" in place of the design's "Next actions" (proposals are E03, LATER; #77 default 4): every withheld
//   item with its reason and its gap, linked to the coverage node;
// - the fixed statement that nutrient adequacy is out of scope (E02.must.2).
import { CitationLink, GapLink, ProvenanceTag, SectionHeading, StateBadge, StateGlyph, STATE_BORDER, STATE_TEXT, STATE_TINT, cx } from "@/components/kit";
import { buildEnvelope, marketLabel, unexplained, type EnvelopeState } from "@/lib/briefs/envelope";
import type { EnvelopeRead } from "@/lib/briefs/queries";

const CARDS: { state: EnvelopeState; label: string; note: string }[] = [
  { state: "clear", label: "Clear as briefed", note: "Every domain is encoded, and the formula is within every rule that applies." },
  { state: "action", label: "Action needed", note: "An additive is above its ceiling or not authorised as briefed. See the envelope below." },
  { state: "not_assessed", label: "Not assessed", note: "Something is not encoded, or the brief does not give what a rule needs. Listed below, never guessed." },
];

export const OUT_OF_SCOPE_TEXT: Record<string, string> = {
  nutrient_adequacy: "Nutrient adequacy is not assessed: it is out of scope until the FEDIAF guidelines are licensed.",
};

const KIND_LABEL = { requirement: "Required", permitted: "Permitted", obligation: "Required when", prohibited: "Not permitted" } as const;

export function Envelope({ workspaceId, data }: { workspaceId: string; data: NonNullable<EnvelopeRead["envelope"]> }) {
  const view = buildEnvelope(data.nodes, data.items, data.outOfScope);
  const markets = view.markets.map((m) => m.nodeId);
  const silent = unexplained(view);
  return (
    <div data-envelope={data.id}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-[16px]">
        {CARDS.map((c) => {
          const inCard = view.markets.filter((m) => m.state === c.state).map((m) => marketLabel(m.nodeId));
          return (
            <div key={c.state} data-card={c.state} className={cx("border border-rule border-t-[3px] py-[15px] px-[16px]", STATE_BORDER[c.state])}>
              <p className={cx("m-0 flex items-center gap-[7px] font-mono text-[10px] tracking-[0.11em] uppercase", STATE_TEXT[c.state])}>
                <StateGlyph state={c.state} size="sm" />
                {c.label}
              </p>
              <p className="mt-[8px] mb-0 font-head text-[22px] font-semibold leading-[1.1]">{inCard.length ? inCard.join(" · ") : "None"}</p>
              <p className="mt-[7px] mb-0 text-[12.5px] leading-[1.45] text-n700">{c.note}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-[24px]">
        <SectionHeading note="ceilings, not failures — the formula is still open">The envelope</SectionHeading>
        {view.limits.length ? (
          <table className="w-full border-collapse mt-[2px]" data-envelope-limits>
            <thead>
              <tr>
                <th className="text-left font-mono text-[9.5px] tracking-[0.1em] uppercase font-normal text-n600 border-b border-ink py-[8px] pr-[8px] w-[26%]">Ingredient</th>
                <th className="text-right font-mono text-[9.5px] tracking-[0.1em] uppercase font-normal text-n600 border-b border-ink py-[8px] px-[8px] w-[9%]">In brief</th>
                {markets.map((m) => (
                  <th key={m} className="text-center font-mono text-[9.5px] tracking-[0.1em] uppercase font-normal text-n600 border-b border-ink py-[8px] px-[8px]">
                    {marketLabel(m)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.limits.map((r) => (
                <tr key={r.key}>
                  <td className="border-b border-rule py-[10px] pr-[8px]">
                    <span className="block text-[13.5px] font-medium">{r.name}</span>
                    <span className="block mt-[2px] font-mono text-[10px] text-n600">{r.reg}</span>
                  </td>
                  <td className="border-b border-rule py-[10px] px-[8px] text-right font-mono text-[12.5px]">{r.used}</td>
                  {markets.map((m) => {
                    const cell = r.cells[m] ?? { text: "—", state: "not_assessed" as const };
                    return (
                      <td key={m} data-cell={`${r.key}:${m}`} data-state={cell.state} className={cx("border-b border-rule py-[10px] px-[8px] text-center", STATE_TINT[cell.state])}>
                        <span className={cx("inline-flex items-center gap-[6px] font-mono text-[11.5px]", STATE_TEXT[cell.state])}>
                          <StateGlyph state={cell.state} size="sm" />
                          {cell.text}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-[10px] mb-0 text-[13px] text-n700" data-envelope-limits-empty>
            No additive limit could be stated for this brief. Additives the formula names are listed under Not assessed when
            a rule could not be read for them.
          </p>
        )}
        <p className="mt-[10px] mb-0 font-mono text-[10.5px] text-n600">
          Cell values are the register&apos;s maximum content for the additive. — = no limit set · N/A = not assessed for that market
        </p>
      </div>

      <div className="mt-[26px] grid grid-cols-1 lg:grid-cols-2 gap-[22px]">
        <div>
          <SectionHeading note="returned, not judged">Wording you can use</SectionHeading>
          {view.wording.length ? (
            <ul className="m-0 p-0 list-none" data-envelope-wording>
              {view.wording.map((w) => (
                <li key={w.key} className="border-b border-rule py-[12px] px-[2px]" data-kind={w.kind}>
                  <div className="flex items-baseline gap-[8px]">
                    <span className="font-mono text-[10px] tracking-[0.08em] uppercase text-accent-700">{w.language}</span>
                    <span className="flex-1 text-[13.5px] leading-[1.4]" lang={w.language === "—" ? undefined : w.language}>
                      {w.text}
                    </span>
                  </div>
                  <div className="mt-[5px] flex flex-wrap gap-y-[4px] gap-x-[12px] font-mono text-[10px] text-n600">
                    <span>
                      {KIND_LABEL[w.kind]} · {w.title} · {w.markets.map(marketLabel).join(", ")}
                    </span>
                    <CitationLink ruleKey={w.ruleKey} citation={w.citation} />
                    <ProvenanceTag provenance={w.provenance} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-[10px] mb-0 text-[13px] text-n700" data-envelope-wording-empty>
              No wording can be returned yet: no accepted rule with a term in a market&apos;s language applies to this brief.
            </p>
          )}
          <p className="mt-[10px] mb-0 text-[12.5px] leading-[1.5] text-n700">
            Prescribed designations are looked up from the term register, never translated.
          </p>
        </div>

        <div>
          <SectionHeading note="stated, not guessed">Not assessed</SectionHeading>
          <ul className="m-0 p-0 list-none" data-envelope-withheld>
            {view.withheld.map((w) => (
              <li key={w.key} className="border-b border-rule py-[11px] px-[2px]" data-reason-code={w.reason}>
                <div className="flex items-baseline gap-[9px]">
                  <StateGlyph state="not_assessed" size="sm" />
                  <span className="flex-1 text-[13.5px] leading-[1.4]">
                    {marketLabel(w.nodeId)}
                    {w.language ? ` · ${w.language.toUpperCase()}` : ""} · {w.what}
                  </span>
                </div>
                <div className="mt-[5px] pl-[18px] flex flex-wrap gap-y-[4px] gap-x-[12px] font-mono text-[10px] text-n600">
                  <span>{w.reason}</span>
                  {w.ruleKey && w.citation ? <CitationLink ruleKey={w.ruleKey} citation={w.citation} /> : null}
                  {w.gapId ? (
                    <GapLink gapId={w.gapId} href={`/w/${workspaceId}/library/coverage/${w.nodeId}#${w.gapId}`} />
                  ) : (
                    <span data-gap-id="">NO COVERAGE GAP RECORDED</span>
                  )}
                  <ProvenanceTag provenance="not_assessed" />
                </div>
              </li>
            ))}
            {silent.map((n) => (
              <li key={`silent-${n}`} className="border-b border-rule py-[11px] px-[2px]" data-reason-code="not_encoded">
                <div className="flex items-baseline gap-[9px]">
                  <StateGlyph state="not_assessed" size="sm" />
                  <span className="flex-1 text-[13.5px] leading-[1.4]">{marketLabel(n)} · No coverage recorded for this market</span>
                </div>
                <div className="mt-[5px] pl-[18px] font-mono text-[10px]">
                  <a href={`/w/${workspaceId}/library/coverage/${n}`} className="kit-transition">
                    WHAT IS COVERED FOR {marketLabel(n)} →
                  </a>
                </div>
              </li>
            ))}
          </ul>
          {view.withheld.length + silent.length === 0 ? (
            <p className="mt-[10px] mb-0 text-[13px] text-n700">Nothing was withheld for this brief.</p>
          ) : null}
        </div>
      </div>

      <div className="mt-[22px] border-t border-rule pt-[12px]" data-out-of-scope>
        {view.outOfScope.map((s) => (
          <p key={s} className="m-0 text-[12.5px] leading-[1.5] text-n700" data-scope={s}>
            <StateBadge state="not_assessed" tone="neutral" className="mr-[8px]" />
            {OUT_OF_SCOPE_TEXT[s] ?? `${s.replace(/_/g, " ")} is out of scope.`}
          </p>
        ))}
        <p className="mt-[6px] mb-0 font-mono text-[10.5px] text-n600" data-pinned>
          RULESET {data.rulesetVersion} · COMPUTED {new Date(data.createdAt).toISOString().slice(0, 16).replace("T", " ")} UTC
        </p>
      </div>
    </div>
  );
}
