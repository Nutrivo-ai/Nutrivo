"use client";

// S-EES-001 rebuilt from the kit: the "Nutrivo Empty and Error States" frame, with its own copy, drawn with
// EmptyState, ErrorState and PatternMark. tests/e2e/kit.spec.ts compares it with the design baseline.
import { Blueprint, EmptyState, ErrorState, PatternMark, useToast, type PatternKind } from "@/components/kit";
import { cx } from "@/components/kit/states";

const TAG_TEXT: Record<PatternKind, string> = { none: "text-na", action: "text-action", blocked: "text-blocked" };
const TAG: Record<PatternKind, string> = { none: "NOTHING YET", action: "SOMETHING NEEDED", blocked: "SOMETHING FAILED" };
const EDGE_TOP: Record<PatternKind, string> = {
  none: "border-t-4 border-t-na",
  action: "border-t-4 border-t-action",
  blocked: "border-t-4 border-t-blocked",
};

const PARTS = [
  { n: "01", k: "A mark", v: "One of three glyphs, so the kind of state is readable before the sentence is." },
  { n: "02", k: "What is true", v: "A statement of fact in the present tense. Never an apology, never a joke, never an exclamation mark." },
  { n: "03", k: "One action", v: "Exactly one thing to do, as a button. Where the person cannot act alone, it names the one human who can." },
  { n: "04", k: "A reference", v: "Where an answer was withheld or a rule was involved, a link to the coverage node or the rule that explains it." },
];

const KINDS: Array<{ kind: PatternKind; k: string; v: string; never: string }> = [
  { kind: "none", k: "Nothing has happened yet", v: "A first-run surface, an unfiltered list with no rows, a register nobody has added to. This is the most common state a new customer sees, and it is not a problem.",
    never: "Read as a fault, or use an accent-filled panel. Neutral mark, neutral ground." },
  { kind: "action", k: "Something is needed from somebody", v: "A missing input, an unassigned grant, an expired document, an allowance met. The product is working; it is waiting on a person.",
    never: "Say sorry. Nobody has failed — the work simply has a next step, and the screen names it." },
  { kind: "blocked", k: "Something failed", v: "An extraction that could not read a panel, a payment that did not clear, an export that could not build. Rare, and always specific about what did not happen.",
    never: "Show a code without a sentence, or lose the work already done. A partial success is reported as partial, not as a failure." },
];

type Story = { kind: PatternKind; where: string; title: string; body: string; action: string; aside: string; primary: boolean };
const st = (kind: PatternKind, where: string, title: string, body: string, action: string, aside: string, primary: boolean): Story =>
  ({ kind, where, title, body, action, aside, primary });

const GROUPS: Array<{ n: string; k: string; v: string; states: Story[] }> = [
  { n: "01", k: "Onboarding and first run", v: "The two optional steps are skippable, so a first-run workspace can legitimately be empty in several places at once. Each one names the single action that fills it.",
    states: [
      st("none", "FIRST RUN · HOME", "No recipes yet", "Add your first recipe, or upload label artwork and we will read the recipe out of it. Either way the first answer takes about four minutes.", "Add a recipe", "or upload artwork", true),
      st("none", "FIRST RUN · PEOPLE", "You are the only person here", "Invite a colleague when you want one. People who only read are free, however many you invite, and a supplier never needs an account.", "Invite somebody", "not now is fine", false),
      st("action", "SKIPPED STEP · HOME", "Your operator details are not set", "Registration obligations are named against the operator on the label. Without it we can still check the artwork, but we cannot tell you what must be registered.", "Add operator details", "two fields", true),
      st("none", "FIRST RUN · MONITORING", "Nothing to monitor yet", "Once a recipe is checked we watch its markets for rule changes and name the recipes each one affects. Nothing here means nothing has changed.", "See your recipes", "", false),
    ] },
  { n: "02", k: "Checking and reports", v: "The states that touch a verdict are the most carefully worded in the product, because an empty result and a withheld result mean entirely different things.",
    states: [
      st("blocked", "ARTWORK · U10", "We could not read three language panels", "Six of nine panels were read and are reported below. The German, Dutch and Belgian-French panels are outlined text with no character data, so their geometry cannot be measured.", "Upload a vector PDF", "the six results stand", true),
      st("action", "BOARD · FREE", "That was your third free label", "All three stay here, with every finding and every report you sent. A fourth label is where a plan starts.", "See what a plan costs", "nothing is taken away", true),
      st("none", "COVERAGE · WITHHELD", "We hold no rules for this market", "No verdict is offered, and this market can never show as Clear. What we do and do not hold is published per market, with the gap named.", "See coverage for this market", "", false),
      st("action", "BOARD · STALE", "This answer predates the current rules", "It was checked against ruleset 2026.07-a and the current set is 2026.08-b, with one material change in this market. Re-checking is free and takes under a minute.", "Re-check now", "never metered", true),
    ] },
  { n: "03", k: "Plans, billing and allowances", v: "Every one of these is a limit being met, so none of them appears before the limit is actually met. A paywall shown early teaches people to distrust the screen.",
    states: [
      st("action", "PLANS · ALLOWANCE", "This is your eleventh recipe", "Basic holds ten and Standard thirty. Pack sizes, artwork versions and recipe variants never count against the allowance.", "Compare plans", "€12/mo per extra recipe", true),
      st("blocked", "BILLING · PAYMENT", "The card on file was declined", "We will try again in three days and nothing changes in the product before then. No report already sent is affected.", "Update the card", "day 3 of 14", true),
      st("none", "BILLING · INVOICES", "No invoices yet", "You are on your three free labels, so there is nothing to bill. The first invoice appears here the day a plan starts.", "See plans", "", false),
      st("action", "SIGNING · UNASSIGNED", "Nobody holds authority for US · Texas", "A Certificate of Check needs a named signatory for that market, so this pack cannot be signed. The Report of Check is unaffected.", "Grant Texas authority", "admin only", true),
    ] },
  { n: "04", k: "Suppliers, documents and partners", v: "States on surfaces where somebody outside the company is involved, and where the wording has to work for a person who has never seen the product.",
    states: [
      st("none", "SUPPLIER PORTAL", "One document is being asked of you", "Nordwild Feeds asked for the current specification for premix PMX-118. Upload it once; you will not be asked again while it is valid.", "Upload the specification", "no account needed", true),
      st("blocked", "VERIFICATION · PUBLIC", "We cannot find that reference", "Check the reference on the document you are holding. We will not say whether a similar one exists, because that would tell a stranger who our customers are.", "Try another reference", "", false),
      st("action", "DOCUMENTS · EXPIRING", "Four documents expire within thirty days", "Each one is named with its supplier and its date. A document that lapses does not invalidate a check that used it while it was current.", "See the four", "", true),
      st("none", "PARTNER · CLIENTS", "No client workspaces yet", "Add a client and they confirm the invitation. A workspace nobody at the brand has agreed to is not one we will create.", "Add a client", "10 included", true),
    ] },
];

const RULES: Array<{ k: string; v: string; bar: string }> = [
  { k: "One action, never three", v: "A state with three buttons is a state that has not decided what the person should do. Where two routes genuinely exist, one is the button and the other is text beside it.", bar: "border-l-accent" },
  { k: "Nothing already done is lost", v: "A failed extraction reports the panels it did read. A declined card breaks nothing. A partial result is labelled partial and stands on its own.", bar: "border-l-clear" },
  { k: "Empty is not withheld", v: "\"You have not checked anything yet\" and \"we hold no rules for this market\" are different sentences with different marks. Collapsing them would make the honesty position invisible.", bar: "border-l-blocked" },
  { k: "No apology, no personality", v: "No sorry, no exclamation marks, no jokes about tumbleweed. A person meeting an error in a compliance tool wants the fact and the next step.", bar: "border-l-na" },
  { k: "A limit is stated as a count", v: "\"That was your third free label\" rather than \"upgrade to continue\". The number is checkable; the exhortation is not.", bar: "border-l-action" },
  { k: "Never a paywall on a bad verdict", v: "No state on this list appears on a Blocked market or a Not assessed finding. Interrupting somebody who has just learned their product cannot be sold is how a compliance tool starts to feel like a sales tool.", bar: "border-l-blocked" },
];

const kicker = "m-0 font-mono uppercase text-accent";

export function EmptyAndErrorStatesStory() {
  const toast = useToast();
  return (
    <div className="min-w-[1180px] bg-panel pb-[60px]">
      <main className="max-w-[1120px] mx-auto bg-paper border-x border-rule">
        <div className="border-b border-ink pt-[32px] px-[40px] pb-[26px]">
          <p className={cx(kicker, "text-[10.5px] tracking-[0.14em]")}>Pattern · 5 September 2026</p>
          <h1 className="mt-[10px] mb-0 text-[34px] font-semibold leading-[1.08] max-w-[30ch]">Empty and error states, as one pattern</h1>
          <p className="mt-[12px] mb-0 text-[15px] leading-[1.6] text-n700 max-w-[92ch]">
            Every state on the newer surfaces is built from the same four parts, so a person meeting one can tell at a glance whether nothing has happened yet, something is missing, or something has gone wrong.
          </p>
          <div className="mt-[24px] grid grid-cols-4 border border-rule">
            {PARTS.map((p, i) => (
              <div key={p.n} className={cx("py-[16px] px-[18px]", i < 3 && "border-r border-rule")}>
                <p className="m-0 font-mono text-[9.5px] tracking-[0.1em] uppercase text-n600">{p.n}</p>
                <p className="mt-[8px] mb-0 text-[14.5px] font-semibold leading-[1.2]">{p.k}</p>
                <p className="mt-[7px] mb-0 text-[12.5px] leading-[1.5] text-n700">{p.v}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="border-b border-ink pt-[26px] px-[40px] pb-[30px]">
          <p className={cx(kicker, "text-[10px] tracking-[0.13em]")}>Three kinds, three marks</p>
          <div className="mt-[18px] grid grid-cols-3 gap-[18px]">
            {KINDS.map((k) => (
              <Blueprint key={k.kind} edge={EDGE_TOP[k.kind]} className="py-[18px] px-[20px]">
                <div className="flex items-center gap-[10px]">
                  <PatternMark kind={k.kind} />
                  <p className={cx("m-0 font-mono text-[10px] tracking-[0.08em]", TAG_TEXT[k.kind])}>{TAG[k.kind]}</p>
                </div>
                <p className="mt-[11px] mb-0 text-[15px] font-semibold leading-[1.2]">{k.k}</p>
                <p className="mt-[7px] mb-0 text-[13px] leading-[1.55] text-n700">{k.v}</p>
                <p className="mt-[11px] mb-0 pt-[10px] border-t border-n200 text-[12.5px] leading-[1.5] text-n700">
                  <span className="font-mono text-[9.5px] tracking-[0.08em] text-n600">NEVER · </span>
                  {k.never}
                </p>
              </Blueprint>
            ))}
          </div>
          <p className="mt-[18px] mb-0 text-[13.5px] leading-[1.6] text-n700 max-w-[100ch]">
            The marks borrow the verdict grammar on purpose — neutral for nothing yet, triangle for something needed, barred for a failure — so a person reads them the way they already read the board. They are never used on a results surface, where those glyphs mean a verdict and nothing else.
          </p>
        </div>

        {GROUPS.map((g) => (
          <div key={g.n} className="border-b border-rule pt-[26px] px-[40px] pb-[30px]">
            <div className="flex items-baseline gap-[16px]">
              <p className="m-0 font-mono text-[11.5px] tracking-[0.1em] text-n600 flex-none">{g.n}</p>
              <div>
                <h2 className="m-0 text-[24px] font-semibold leading-[1.15]">{g.k}</h2>
                <p className="mt-[7px] mb-0 text-[13.5px] leading-[1.55] text-n700 max-w-[92ch]">{g.v}</p>
              </div>
            </div>
            <div className="mt-[20px] ml-[40px] grid grid-cols-2 gap-[18px]">
              {g.states.map((s) => {
                const props = {
                  where: s.where,
                  title: s.title,
                  body: s.body,
                  aside: s.aside,
                  action: {
                    label: s.action,
                    variant: s.primary ? ("primary" as const) : ("secondary" as const),
                    onClick: () => toast({ text: `Story action: ${s.action}` }),
                  },
                };
                return s.kind === "blocked" ? (
                  <ErrorState key={s.title} {...props} />
                ) : (
                  <EmptyState key={s.title} kind={s.kind} {...props} />
                );
              })}
            </div>
          </div>
        ))}

        <div className="pt-[28px] px-[40px] pb-[36px]">
          <p className={cx(kicker, "text-[10px] tracking-[0.13em]")}>Rules that hold everywhere</p>
          <div className="mt-[18px] grid grid-cols-2 gap-[18px]">
            {RULES.map((r) => (
              <div key={r.k} className={cx("border-l-[3px] pl-[15px]", r.bar)}>
                <p className="m-0 text-[14px] font-semibold leading-[1.25]">{r.k}</p>
                <p className="mt-[6px] mb-0 text-[13px] leading-[1.55] text-n700">{r.v}</p>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
