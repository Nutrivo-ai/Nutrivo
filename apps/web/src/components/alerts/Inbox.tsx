import Link from "next/link";
import type { ReactNode } from "react";
import { Blueprint, EmptyState, StateGlyph, cx } from "@/components/kit";
import {
  age,
  cardSentence,
  count,
  dayLabel,
  effectiveLabel,
  firstFinding,
  inboxHref,
  longDate,
  daysBetween,
  type AlertCard,
  type Filter,
  type Inbox as InboxModel,
} from "@/lib/alerts/model";
import { MarkAllRead } from "./MarkAllRead";

// T-902 · J04 Horizon and alerts inbox: S-MIS-001 at desktop widths (product/Nutrivo - Missing Surfaces.dc.html,
// screen "alerts") and S-MOB-006 at phone widths (product/Nutrivo Mobile.dc.html, the Alerts phone). One card per rule
// change, marked coming or in force with its date, naming the recipes it affects. A recipe links to its finding only
// in a market the workspace's plan holds (J04.must.1); elsewhere it is named and cannot be opened.

const PHASE_LABEL = { coming: "COMING", in_force: "IN FORCE" } as const;
const PHASE_BORDER = { coming: "border-action text-action", in_force: "border-blocked text-blocked" } as const;
const SEVERITY_TEXT = { blocked: "text-blocked", action: "text-action" } as const;
const SEVERITY_TINT = { blocked: "bg-blocked-bg border-l-blocked", action: "bg-action-bg border-l-action" } as const;
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "in_force", label: "In force" },
  { key: "coming", label: "Coming" },
];

const EMPTY_FILTERED: Record<Exclude<Filter, "all">, { title: string; body: string }> = {
  in_force: { title: "Nothing in force needs reading", body: "No change that already applies affects a recipe in your scope." },
  coming: { title: "Nothing is coming", body: "No change with a date still ahead affects a recipe in your scope." },
};

export function UnreadChip({ unread }: { unread: number }) {
  return (
    <span
      data-unread-count={unread}
      className={cx(
        "font-mono text-[10.5px] tracking-[0.05em] whitespace-nowrap border py-[5px] px-[9px]",
        unread ? "border-action text-action" : "border-n400 text-n600",
      )}
    >
      {unread ? `${unread} UNREAD` : "ALL READ"}
    </span>
  );
}

export function Inbox({ workspaceId, inbox, today }: { workspaceId: string; inbox: InboxModel; today: string }) {
  if (inbox.total === 0) {
    return (
      <div className="max-w-[640px]" data-region="inbox" data-empty>
        <EmptyState
          where="ALERTS · NOTHING YET"
          title="No rule change affects your recipes yet"
          body="An alert appears here when a released rule change touches a recipe whose latest check used that rule, marked coming or in force with its date. Editorial corrections never appear."
          action={{ label: "See what is coming", href: `/w/${workspaceId}/horizon`, variant: "secondary" }}
        />
      </div>
    );
  }
  return (
    <>
      <div className="hidden md:block" data-region="inbox" data-filter={inbox.filter}>
        <Desktop workspaceId={workspaceId} inbox={inbox} today={today} />
      </div>
      <div className="md:hidden">
        <Mobile inbox={inbox} today={today} />
      </div>
    </>
  );
}

function Desktop({ workspaceId, inbox, today }: { workspaceId: string; inbox: InboxModel; today: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_296px] gap-[20px] items-start">
      <Blueprint as="section" className="relative">
        <div className="flex items-center gap-[10px] py-[14px] px-[18px] border-b border-ink flex-wrap" data-region="toolbar">
          <nav aria-label="Alert filters" className="flex items-center gap-[10px]">
            {FILTERS.map((f) => {
              const on = !inbox.diff && inbox.filter === f.key;
              return (
                <Link
                  key={f.key}
                  href={inboxHref(workspaceId, f.key)}
                  data-filter={f.key}
                  aria-current={on ? "true" : undefined}
                  className={cx(
                    "inline-flex items-center border rounded-control py-[7px] px-[12px] text-[12px] no-underline kit-transition",
                    on ? "border-accent bg-accent-100 text-accent-700 font-semibold" : "border-n400 bg-paper text-n700 font-normal hover:border-accent",
                  )}
                >
                  {f.label}
                </Link>
              );
            })}
          </nav>
          <span className="flex-1" />
          {inbox.unreadIds.length ? <MarkAllRead workspaceId={workspaceId} alertIds={inbox.unreadIds} /> : null}
        </div>
        {inbox.diff ? (
          <p className="m-0 py-[10px] px-[18px] border-b border-n200 text-[12.5px] text-n700" data-one-change>
            Showing one change.{" "}
            <Link href={inboxHref(workspaceId, "all")} className="text-accent-700">
              Show every alert
            </Link>
          </p>
        ) : null}
        {inbox.cards.length ? (
          inbox.cards.map((c, i) => <Card key={c.diffId} card={c} today={today} last={i === inbox.cards.length - 1} />)
        ) : (
          <div className="p-[18px]">
            <EmptyState
              where={`ALERTS · ${inbox.filter === "in_force" ? "IN FORCE" : "COMING"}`}
              title={EMPTY_FILTERED[inbox.filter as Exclude<Filter, "all">].title}
              body={EMPTY_FILTERED[inbox.filter as Exclude<Filter, "all">].body}
              action={{ label: "Show every alert", href: inboxHref(workspaceId, "all"), variant: "secondary" }}
            />
          </div>
        )}
      </Blueprint>
      <div className="flex flex-col gap-[16px]">
        <Blueprint edge="border-l-4 border-l-accent" className="relative py-[17px] px-[19px]">
          <h2 className="m-0 text-[13.5px] font-semibold leading-[1.55] tracking-normal">Coming, and in force</h2>
          <p className="mt-[7px] mb-0 text-[12.5px] leading-[1.55] text-n700">
            Every alert says which it is, and carries the date. A change fourteen months out is a plan. Without the distinction
            every notice reads as urgent and people stop reading them.
          </p>
        </Blueprint>
        <Blueprint className="relative py-[17px] px-[19px]">
          <h2 className="m-0 font-mono text-[9.5px] font-normal tracking-[0.1em] uppercase text-n600">How this inbox works</h2>
          <div className="mt-[12px] flex flex-col gap-[11px]">
            <Rule bar="border-l-blocked" title="Editorial changes never appear here">
              A corrected typo in an instrument is content operations, not an event.
            </Rule>
            <Rule bar="border-l-accent" title="An alert names recipes or it is not sent">
              A change with no impact on your recipes is recorded in the ruleset history and shown nowhere else.
            </Rule>
            <Rule bar="border-l-na" title="Unread state is per person">
              Reading an alert does not mark it read for a colleague.
            </Rule>
            <Rule bar="border-l-clear" title="Nothing here is a paywall">
              An alert for a region your plan does not hold still says a change exists and which recipes it would affect. It
              just cannot open the finding.
            </Rule>
          </div>
        </Blueprint>
      </div>
    </div>
  );
}

function Rule({ bar, title, children }: { bar: string; title: string; children: ReactNode }) {
  return (
    <div className={cx("border-l-[3px] pl-[12px]", bar)}>
      <h3 className="m-0 text-[12.5px] font-semibold leading-[1.3] tracking-normal">{title}</h3>
      <p className="mt-[4px] mb-0 text-[12px] leading-[1.5] text-n700">{children}</p>
    </div>
  );
}

function Card({ card: c, today, last }: { card: AlertCard; today: string; last: boolean }) {
  const eff = effectiveLabel(c, today);
  const id = `alert-${c.diffId}`;
  return (
    <article
      aria-labelledby={id}
      data-alert={c.diffId}
      data-phase={c.phase}
      data-unread={c.unread ? "true" : "false"}
      className={cx(
        "py-[16px] px-[18px] border-l-[3px]",
        !last && "border-b border-b-n200",
        c.unread ? "bg-paper border-l-accent" : "bg-panel border-l-transparent",
      )}
    >
      <div className="flex gap-[13px] items-start">
        <span className="mt-[2px]">
          <StateGlyph state={c.severity} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-[10px] flex-wrap">
            <span className={cx("font-mono text-[9.5px] tracking-[0.07em] border bg-paper py-[3px] px-[7px]", PHASE_BORDER[c.phase])} data-phase-label>
              {PHASE_LABEL[c.phase]}
            </span>
            <span className="font-mono text-[10px] tracking-[0.05em] text-n600">{age(c.at, today)}</span>
            {c.unread ? <span className="sr-only">Unread</span> : null}
            <span className="flex-1" />
            <span className={cx("font-mono text-[10px] tracking-[0.05em]", eff.tone === "severity" ? SEVERITY_TEXT[c.severity] : "text-n600")} data-effective>
              {eff.text}
            </span>
          </div>
          <h2 id={id} className="mt-[8px] mb-0 text-[14.5px] font-semibold leading-[1.3] tracking-normal">
            {c.title}
          </h2>
          <p className="mt-[6px] mb-0 text-[12.5px] leading-[1.55] text-n700">{cardSentence(c, today)}</p>
          <div className="mt-[10px] flex items-center gap-[9px] flex-wrap" data-region="affects">
            <span className="font-mono text-[9.5px] tracking-[0.07em] text-accent-700">AFFECTS</span>
            {c.recipes.map((r) =>
              r.href ? (
                <Link
                  key={r.productId}
                  href={r.href}
                  data-recipe={r.productId}
                  className="border border-n300 bg-panel py-[4px] px-[8px] text-[11.5px] text-n800 no-underline kit-transition hover:border-accent"
                >
                  {r.name}
                </Link>
              ) : (
                <span key={r.productId} data-recipe={r.productId} data-locked className="border border-n300 bg-panel py-[4px] px-[8px] text-[11.5px] text-n800">
                  {r.name}
                </span>
              ),
            )}
            <span className="font-mono text-[10px] uppercase text-n600" data-rule-key={c.ruleKey}>
              {[c.citation ?? c.ruleKey, c.markets.map((m) => m.name).join(", ")].join(" · ")}
            </span>
          </div>
          {c.outsidePlan.length ? <OutsidePlan regions={c.outsidePlan} /> : null}
        </div>
      </div>
    </article>
  );
}

function OutsidePlan({ regions }: { regions: string[] }) {
  return (
    <p className="mt-[8px] mb-0 text-[12px] leading-[1.5] text-n700" data-outside-plan>
      Your plan does not include {regions.join(" or ")}, so the finding cannot be opened. The change and the recipes it would
      affect are still named.
    </p>
  );
}

// ─── S-MOB-006: the Alerts phone ────────────────────────────────────────────────────────────────────────────────

function capitalise(s: string) {
  return s[0].toUpperCase() + s.slice(1);
}

function mobileSentence(c: AlertCard, today: string): string {
  const names = c.recipes.map((r) => r.name).join(" · ");
  let when: string;
  if (c.phase === "coming") {
    when = c.effectiveFrom
      ? `Effective ${longDate(c.effectiveFrom)}${daysBetween(today, c.effectiveFrom) > 30 ? ", so there is time" : ""}.`
      : "Coming, with no date yet.";
  } else {
    when = c.effectiveFrom ? `In force since ${longDate(c.effectiveFrom)}.` : "In force now.";
  }
  return `Affects ${names}. ${when}`;
}

function Mobile({ inbox, today }: { inbox: InboxModel; today: string }) {
  const cards = inbox.cards;
  const unread = cards.filter((c) => c.unread).length;
  const first = firstFinding([...cards.filter((c) => c.unread), ...cards.filter((c) => !c.unread)]);
  return (
    <section aria-label="Alerts" data-region="mobile-alerts" className="-mx-[16px] -mt-[24px]">
      <MobileBlock region="summary">
        <MobileKicker>{cards.length ? dayLabel(cards[0].at, today) : "Alerts"}</MobileKicker>
        <h2 className="m-0 font-head text-[14.5px] font-semibold leading-[18px] tracking-normal">
          {unread ? `${capitalise(count(unread, "thing", "things"))} changed` : "Nothing new since you last read them"}
        </h2>
      </MobileBlock>
      {cards.map((c) =>
        c.unread ? (
          <MobileBlock key={c.diffId} region="alert" className={cx("border-l-[4px]", SEVERITY_TINT[c.severity])} alert={c}>
            <div className="flex items-center gap-[8px] mb-[7px]">
              <StateGlyph state={c.severity} />
              <span className={cx("font-mono text-[9.5px] tracking-[0.07em] uppercase", SEVERITY_TEXT[c.severity])}>{PHASE_LABEL[c.phase]}</span>
              <span className="sr-only">Unread</span>
            </div>
            <h3 className="m-0 font-head text-[14.5px] font-semibold leading-[18px] tracking-normal">{c.title}</h3>
            <p className="mt-[6px] mb-0 text-[12.5px] leading-[1.5] text-n700">{mobileSentence(c, today)}</p>
            {c.outsidePlan.length ? <OutsidePlan regions={c.outsidePlan} /> : null}
          </MobileBlock>
        ) : (
          <MobileBlock key={c.diffId} region="alert" alert={c}>
            <MobileKicker>
              {dayLabel(c.at, today)} · {PHASE_LABEL[c.phase].toLowerCase()}
            </MobileKicker>
            <h3 className="m-0 font-head text-[14.5px] font-semibold leading-[18px] tracking-normal">{c.title}</h3>
            <p className="mt-[6px] mb-0 text-[12.5px] leading-[1.5] text-n700">{mobileSentence(c, today)}</p>
            {c.outsidePlan.length ? <OutsidePlan regions={c.outsidePlan} /> : null}
          </MobileBlock>
        ),
      )}
      {first ? (
        <MobileBlock region="open" last>
          <Link
            href={first}
            className="flex items-center justify-center min-h-[44px] w-full rounded-[3px] border border-n400 bg-paper text-[13px] text-n700 no-underline"
          >
            Open the first
          </Link>
        </MobileBlock>
      ) : null}
    </section>
  );
}

function MobileBlock({
  children,
  className,
  region,
  last,
  alert,
}: {
  children: ReactNode;
  className?: string;
  region: string;
  last?: boolean;
  alert?: AlertCard;
}) {
  return (
    <div
      data-region={region}
      data-alert={alert?.diffId}
      data-phase={alert?.phase}
      data-unread={alert ? String(alert.unread) : undefined}
      className={cx("p-[14px]", !last && "border-b border-n200", className)}
    >
      {children}
    </div>
  );
}

function MobileKicker({ children }: { children: ReactNode }) {
  return <p className="mt-0 mb-[5px] font-mono text-[9px] leading-[normal] tracking-[0.09em] uppercase text-n600">{children}</p>;
}
