import Link from "next/link";
import { Blueprint, ButtonLink, EmptyState, StateGlyph, cx } from "@/components/kit";
import { cardSentence, count, longDate, type Horizon as HorizonModel, type HorizonEntry } from "@/lib/alerts/model";

// T-902 · J04: S-MIS-002 Horizon (product/Nutrivo - Missing Surfaces.dc.html, screen "horizon"). Everything known to be
// coming, in date order, with the recipes against it, led by the nearest sell-through deadline. A change from the
// ruleset carries its effective date and its recipes (app.alerts, contract 5); a horizon item that is not yet law
// carries no countdown (BE-37), and until horizon items are linked to rules it names no recipes (#73 gap 1).

const TONE_DATE: Record<HorizonEntry["tone"], string> = { blocked: "text-blocked", action: "text-ink", draft: "text-n600" };
const TONE_STAGE: Record<HorizonEntry["tone"], string> = { blocked: "text-blocked", action: "text-action", draft: "text-n600" };
const TONE_IMPACT: Record<HorizonEntry["tone"], string> = { blocked: "text-blocked", action: "text-action", draft: "text-n600" };

export function DeadlineChip({ deadlines }: { deadlines: number }) {
  if (!deadlines) return null;
  return (
    <span data-deadlines={deadlines} className="font-mono text-[10.5px] tracking-[0.05em] whitespace-nowrap border border-blocked text-blocked py-[5px] px-[9px]">
      {deadlines} SELL-THROUGH {deadlines === 1 ? "DEADLINE" : "DEADLINES"}
    </span>
  );
}

export function Horizon({ workspaceId, horizon, today }: { workspaceId: string; horizon: HorizonModel; today: string }) {
  const { deadline, entries } = horizon;
  return (
    <div data-region="horizon">
      {deadline ? (
        <Blueprint as="section" edge="border-l-4 border-l-blocked" className="relative bg-blocked-bg! py-[20px] px-[16px] md:px-[24px] mb-[20px]">
          <div data-region="deadline" data-diff={deadline.card.diffId} className="flex items-start justify-between gap-[26px] flex-wrap">
            <div className="flex-1 min-w-0 md:min-w-[400px]">
              <div className="flex items-center gap-[10px]">
                <StateGlyph state="blocked" />
                <p className="m-0 font-mono text-[10px] tracking-[0.1em] uppercase text-blocked">Withdrawn authorisation · sell-through deadline</p>
              </div>
              <h2 className="mt-[11px] mb-0 text-[21px] font-semibold leading-[1.25] max-w-[46ch] tracking-normal">{deadline.card.title}</h2>
              <p className="mt-[9px] mb-0 text-[13.5px] leading-[1.6] text-n800 max-w-[88ch]">
                {cardSentence(deadline.card, today)}{" "}
                {capitalise(count(deadline.card.recipes.length, "of your recipes is", "of your recipes are"))} named.
              </p>
            </div>
            <div className="flex-none">
              <p className="m-0 font-mono text-[30px] leading-none text-blocked" data-days>
                {deadline.days}
              </p>
              <p className="mt-[6px] mb-0 font-mono text-[10px] tracking-[0.06em] text-n700">
                {deadline.label} · {longDate(deadline.until).toUpperCase()}
              </p>
              <div className="mt-[14px] flex flex-col gap-[7px]">
                <ButtonLink variant="primary" size="md" href={deadline.recipesHref} className="justify-center">
                  {deadline.card.recipes.length === 1 ? "Open the recipe" : `Open the ${count(deadline.card.recipes.length, "recipe", "recipes")}`}
                </ButtonLink>
              </div>
            </div>
          </div>
        </Blueprint>
      ) : null}

      <div className="grid gap-[20px] items-start md:grid-cols-[minmax(0,1fr)_300px]">
        <Blueprint as="section" className="relative">
          <div className="py-[15px] px-[18px] border-b border-ink">
            <h2 className="m-0 text-[16px] font-semibold tracking-normal">Everything coming, in date order</h2>
            <p className="mt-[4px] mb-0 font-mono text-[10px] tracking-[0.05em] text-n600" data-count={entries.length}>
              DRAFTS AND ENACTED CHANGES NOT YET IN FORCE · {entries.length} {entries.length === 1 ? "ITEM" : "ITEMS"}
            </p>
          </div>
          {entries.length ? (
            <ol className="m-0 p-0 list-none" data-region="timeline">
              {entries.map((e, i) => (
                <Entry key={e.key} entry={e} odd={i % 2 === 1} last={i === entries.length - 1} />
              ))}
            </ol>
          ) : (
            <div className="p-[18px]">
              <EmptyState
                where="HORIZON · NOTHING AHEAD"
                title="Nothing is coming that we know of"
                body="No released rule change with a date still ahead affects your recipes, and no draft or proposal is being watched."
                action={{ label: "Open the alerts inbox", href: `/w/${workspaceId}/alerts`, variant: "secondary" }}
              />
            </div>
          )}
        </Blueprint>
        <Blueprint edge="border-l-4 border-l-na" className="relative py-[17px] px-[19px]">
          <h2 className="m-0 text-[13.5px] font-semibold leading-[1.55] tracking-normal">A draft is marked as a draft</h2>
          <p className="mt-[7px] mb-0 text-[12.5px] leading-[1.55] text-n700">
            Anything not yet law says so and carries no countdown, because a proposal that fails would make a countdown a lie. It
            earns a date only when it is adopted.
          </p>
        </Blueprint>
      </div>
    </div>
  );
}

function Entry({ entry: e, odd, last }: { entry: HorizonEntry; odd: boolean; last: boolean }) {
  return (
    <li
      data-entry={e.key}
      data-tone={e.tone}
      className={cx("py-[15px] px-[18px]", !last && "border-b border-n200", odd ? "bg-panel" : "bg-transparent")}
    >
      <div className="grid gap-[8px] md:gap-[16px] items-baseline md:grid-cols-[104px_minmax(0,1fr)_128px]">
        <div>
          <p className={cx("m-0 font-mono text-[12px]", TONE_DATE[e.tone])} data-date>
            {e.date}
          </p>
          <p className={cx("mt-[4px] mb-0 font-mono text-[9px] tracking-[0.06em]", TONE_STAGE[e.tone])} data-stage>
            {e.stage}
          </p>
        </div>
        <div>
          <h3 className="m-0 text-[13.5px] font-semibold leading-[1.3] tracking-normal">{e.title}</h3>
          <p className="mt-[5px] mb-0 text-[12.5px] leading-[1.5] text-n700">{e.body}</p>
          {e.cite ? <p className="mt-[6px] mb-0 font-mono text-[10px] uppercase text-n600">{e.cite}</p> : null}
        </div>
        <div className="md:text-right" data-impact>
          {e.impact ? (
            <>
              <p className={cx("m-0 font-mono text-[15px] leading-none", TONE_IMPACT[e.tone])}>
                {e.href ? (
                  <Link href={e.href} className="text-inherit" aria-label={`${e.impact.count} ${e.impact.label}: open them`}>
                    {e.impact.count}
                  </Link>
                ) : (
                  e.impact.count
                )}
              </p>
              <p className="mt-[5px] mb-0 text-[11px] leading-[1.35] text-n600">{e.impact.label}</p>
            </>
          ) : (
            <p className="m-0 text-[11px] leading-[1.35] text-n600" data-unlinked>
              Not yet linked to your recipes
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

function capitalise(s: string) {
  return s[0].toUpperCase() + s.slice(1);
}
