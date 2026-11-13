import type { ReactNode } from "react";
import Link from "next/link";
import { cx } from "@/components/kit";
import { Wordmark } from "@/components/shell/Wordmark";
import { verificationFacts, type Verification, type VerifyOutcome } from "@/lib/public/verify";

// S-NV2-027 (I04): design/product/Nutrivo 2.0.dc.html, screen "verify". The design draws it inside the app shell; the
// public page has no rail and no worker panel, and the visual test compares the card and the three state tiles (plan
// on #48, Q1). The design draws the Current result; Superseded and Unknown use the same card in the colours and words
// of the design's own state tiles.

type Tone = "clear" | "action" | "none";

const TONE: Record<Tone, { edge: string; text: string; bg: string }> = {
  clear: { edge: "border-t-clear", text: "text-clear", bg: "bg-clear-bg" },
  action: { edge: "border-t-action", text: "text-action", bg: "bg-action-bg" },
  none: { edge: "border-t-na", text: "text-na", bg: "bg-na-bg" },
};

const STATES: { k: string; v: string; tone: Tone }[] = [
  { k: "Current", v: "Issued by us and not superseded by a material rule change.", tone: "clear" },
  { k: "Superseded", v: "A rule it relied on has materially changed. The document remains genuine.", tone: "action" },
  { k: "Unknown", v: "No document with that reference. We do not say why.", tone: "none" },
];

const RESULT: Record<Verification["status"], { label: string; title: string; tone: Tone }> = {
  current: { label: "Current", title: "This report was issued by Nutrivo and has not been superseded.", tone: "clear" },
  superseded: {
    label: "Superseded",
    title: "This report was issued by Nutrivo and has since been superseded. It remains genuine.",
    tone: "action",
  },
  unknown: { label: "Unknown", title: "No document with that reference.", tone: "none" },
};

const mono = "font-mono uppercase";

/** The page: a header strip and the grey frame around the card, 16 px gutters at phone width. */
export function VerifyPage({ reference, children }: { reference: string; children?: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-paper text-ink text-[14px]">
      <header className="flex items-end justify-between gap-[20px] border-b border-ink bg-paper py-[14px] px-[16px] md:px-[26px]">
        <div>
          <p className={cx(mono, "m-0 text-[10px] tracking-[0.14em] text-accent")}>Public · no account</p>
          <h1 className="mt-[4px] mb-0 text-[22px] font-semibold leading-[1.1] tracking-[-0.02em]">Verify a reference</h1>
        </div>
        <Link href="/" aria-label="Nutrivo home" className="focus-visible:outline-2 focus-visible:outline-accent">
          <Wordmark size="header" />
        </Link>
      </header>
      <main id="main" className="flex-1 py-[24px] px-[16px] md:px-[26px]">
        <p className="mt-0 mb-[16px] text-[13px] leading-[1.55] text-n600 max-w-[76ch]">
          Public page, no account. It answers one question about one reference and nothing else: never the composition,
          never the findings, never who the customer is.
        </p>
        <div className="border border-ink bg-panel py-[34px] px-[12px] md:px-[40px] pb-[40px]">
          <div data-testid="verify-screen" className="max-w-[640px] mx-auto">
            <section aria-label="Verify a report or certificate" className="bg-paper border border-ink py-[30px] px-[18px] md:px-[34px]">
              <p className="m-0 flex items-end gap-[4px] font-head text-[20px] font-semibold tracking-[-0.045em] leading-none">
                <span>nutrivo</span>
                <span aria-hidden="true" className="inline-block w-[6px] h-[6px] bg-accent mb-[2px]" />
              </p>
              <p className={cx(mono, "mt-[4px] mb-0 text-[10px] tracking-[0.1em] text-n600")}>Verify a report or certificate</p>
              <form action="/verify" method="get" role="search" className="mt-[22px] flex">
                <label htmlFor="verify-ref" className="sr-only">Reference</label>
                <input
                  id="verify-ref"
                  name="ref"
                  defaultValue={reference}
                  required
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={64}
                  placeholder="Reference printed on the report"
                  className="flex-1 min-w-0 border border-n400 border-r-0 py-[11px] px-[13px] font-mono text-[13px] leading-[1.55] text-ink bg-paper rounded-none placeholder:text-n500 focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2"
                />
                <button
                  type="submit"
                  className="border-0 bg-accent text-paper font-mono text-[11px] tracking-[0.06em] py-[12px] px-[18px] leading-[1.55] cursor-pointer rounded-none hover:bg-accent-600 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                >
                  VERIFY
                </button>
              </form>
              {children}
              <p className="mt-[18px] mb-0 text-[12.5px] leading-[1.6] text-n700">
                This page confirms that a document exists, when it was issued, which ruleset version it was produced
                against, and whether items were left not assessed. It does not confirm that the product is compliant, and it
                does not show the label, the composition or the findings.
              </p>
            </section>
            <ul className="list-none p-0 mx-0 mb-0 mt-[20px] grid grid-cols-1 sm:grid-cols-3 gap-[12px]" aria-label="What each answer means">
              {STATES.map((s) => (
                <li key={s.k} className={cx("border border-rule border-t-[3px] py-[12px] px-[14px] bg-paper", TONE[s.tone].edge)}>
                  <p className={cx(mono, "m-0 text-[10px] tracking-[0.08em]", TONE[s.tone].text)}>{s.k}</p>
                  <p className="mt-[6px] mb-0 text-[12px] leading-[1.5] text-n700">{s.v}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
}

/** The answer under the form: the result card, or why there is no answer just now. */
export function VerifyResult({ reference, outcome }: { reference: string; outcome: VerifyOutcome }) {
  if (outcome.kind !== "answer") {
    const limited = outcome.kind === "rate_limited";
    return (
      <div role="alert" data-testid="verify-error" className="mt-[24px] border border-ink border-t-[3px] border-t-blocked py-[18px] px-[20px] bg-blocked-bg">
        <p className={cx(mono, "m-0 text-[10px] tracking-[0.13em] text-blocked")}>{limited ? "Too many checks" : "Not answered"}</p>
        <h2 className="mt-[7px] mb-0 text-[20px] font-semibold leading-[1.2]">
          {limited ? "Too many checks from this connection." : "We could not check this reference just now."}
        </h2>
        <p className="mt-[8px] mb-0 text-[13px] leading-[1.55] text-n700">
          {limited
            ? `Try again in ${outcome.retryAfter} seconds. This says nothing about the reference itself.`
            : "This says nothing about the document. Try again in a moment."}
        </p>
        <Link
          href={`/verify/${encodeURIComponent(reference)}`}
          prefetch={false}
          className="mt-[12px] inline-block font-mono text-[11px] tracking-[0.06em] text-accent underline focus-visible:outline-2 focus-visible:outline-accent"
        >
          TRY AGAIN
        </Link>
      </div>
    );
  }
  const v = outcome.verification;
  const r = RESULT[v.status];
  const tone = TONE[r.tone];
  return (
    <div data-testid="verify-result" data-status={v.status} aria-live="polite" className={cx("mt-[24px] border border-ink border-t-[3px] py-[18px] px-[20px]", tone.edge, tone.bg)}>
      <p className={cx(mono, "m-0 text-[10px] tracking-[0.13em]", tone.text)}>{r.label}</p>
      <h2 className="mt-[7px] mb-0 font-head text-[22px] font-semibold leading-[1.2] tracking-normal">{r.title}</h2>
      <dl className="mt-[16px] mb-0">
        {verificationFacts(reference, v).map((f) => (
          <div key={f.k} className="flex flex-col sm:flex-row sm:items-baseline gap-[2px] sm:gap-[14px] border-t border-n300 py-[9px]">
            <dt className={cx(mono, "sm:w-[190px] flex-none text-[9.5px] tracking-[0.1em] text-n700")}>{f.k}</dt>
            <dd className="m-0 text-[13px] leading-[1.45] [overflow-wrap:anywhere]">{f.v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Loading: neutral, never the accent, in the place the answer will take. */
export function VerifyLoading() {
  return (
    <div data-testid="verify-loading" role="status" className="mt-[24px] border border-ink border-t-[3px] border-t-n400 py-[18px] px-[20px] bg-panel">
      <p className={cx(mono, "m-0 text-[10px] tracking-[0.13em] text-n600")}>Checking</p>
      <p className="mt-[7px] mb-0 text-[13px] leading-[1.55] text-n700">Looking up the reference.</p>
    </div>
  );
}
