import Link from "next/link";
import { cx } from "@/components/kit";
import { PublicCardFrame, TONE, mono, type StateTile } from "@/components/verify/VerifyScreen";
import { marketOf, sharedFacts, type ShareOutcome } from "@/lib/public/share";
import { DownloadSharedPdf } from "./DownloadSharedPdf";

// /share/[token] (I02, D-30, T-604): the recipient of a share link, with no account. There is no design of its own: it
// is laid out like Public verification (S-NV2-027) with its states (answer, unknown, too many, not answered, loading),
// plus Download PDF and a link to /verify for the reference (#58 Q3). The answer comes from the `share` Edge Function
// only. A revoked, expired, unknown or malformed link reads the same, and says nothing about which it was.

const STATES: StateTile[] = [
  { k: "Shared", v: "The report as it was issued, with its PDF. Nothing else in the workspace.", tone: "neutral" },
  { k: "Verify", v: "Whether the reference is current or superseded is answered on the verification page.", tone: "neutral" },
  { k: "Unknown", v: "No shared report at this link: revoked, expired or never issued. We do not say which.", tone: "none" },
];

export function SharePage({ children }: { children?: React.ReactNode }) {
  return (
    <PublicCardFrame
      heading="Shared report"
      intro="Public page, no account. It shows one report someone shared with you and nothing else: never the rest of their portfolio, never the label or the composition."
      cardLabel="A shared Report of Check"
      cardKicker="A shared Report of Check"
      testId="share-screen"
      footnote="A Report of Check is generated automatically from a check pinned to a ruleset version and an artwork hash, and attested by nobody. Anyone holding its reference can verify that Nutrivo issued it and whether it has been superseded."
      states={STATES}
      statesLabel="What this page can show"
    >
      {children}
    </PublicCardFrame>
  );
}

/** The answer in the card: the report's face facts, the unknown answer, or why there is no answer just now. */
export function ShareResult({ token, outcome }: { token: string; outcome: ShareOutcome }) {
  if (outcome.kind !== "answer") {
    const limited = outcome.kind === "rate_limited";
    return (
      <div role="alert" data-testid="share-error" className="mt-[24px] border border-ink border-t-[3px] border-t-blocked py-[18px] px-[20px] bg-blocked-bg">
        <p className={cx(mono, "m-0 text-[10px] tracking-[0.13em] text-blocked")}>{limited ? "Too many requests" : "Not answered"}</p>
        <h2 className="mt-[7px] mb-0 text-[20px] font-semibold leading-[1.2]">
          {limited ? "Too many requests from this connection." : "We could not open this link just now."}
        </h2>
        <p className="mt-[8px] mb-0 text-[13px] leading-[1.55] text-n700">
          {limited
            ? `Try again in ${outcome.retryAfter} seconds. This says nothing about the link itself.`
            : "This says nothing about the link or the report. Try again in a moment."}
        </p>
        <Link
          href={`/share/${encodeURIComponent(token)}`}
          prefetch={false}
          className="mt-[12px] inline-block font-mono text-[11px] tracking-[0.06em] text-accent underline focus-visible:outline-2 focus-visible:outline-accent"
        >
          TRY AGAIN
        </Link>
      </div>
    );
  }
  const s = outcome.share;
  if (s.status === "unknown") {
    const tone = TONE.none;
    return (
      <div data-testid="share-result" data-status="unknown" aria-live="polite" className={cx("mt-[24px] border border-ink border-t-[3px] py-[18px] px-[20px]", tone.edge, tone.bg)}>
        <p className={cx(mono, "m-0 text-[10px] tracking-[0.13em]", tone.text)}>Unknown</p>
        <h2 className="mt-[7px] mb-0 font-head text-[22px] font-semibold leading-[1.2] tracking-normal">No shared report at this link.</h2>
        <p className="mt-[8px] mb-0 text-[13px] leading-[1.55] text-n700">
          The link may have been revoked or may have expired, or it was never issued. We do not say which. If you hold a
          report&apos;s reference, the verification page still answers for it.
        </p>
        <Link
          href="/verify"
          prefetch={false}
          className="mt-[12px] inline-block font-mono text-[11px] tracking-[0.06em] text-accent-700 underline focus-visible:outline-2 focus-visible:outline-accent"
        >
          VERIFY A REFERENCE
        </Link>
      </div>
    );
  }
  const tone = TONE.neutral;
  return (
    <div data-testid="share-result" data-status="open" aria-live="polite" className={cx("mt-[24px] border border-ink border-t-[3px] py-[18px] px-[20px]", tone.edge, tone.bg)}>
      <p className={cx(mono, "m-0 text-[10px] tracking-[0.13em]", tone.text)}>Shared</p>
      <h2 className="mt-[7px] mb-0 font-head text-[22px] font-semibold leading-[1.2] tracking-normal">
        {s.product_name ?? "Report of Check"}
        {marketOf(s) ? ` · ${marketOf(s)}` : ""}
      </h2>
      <dl className="mt-[16px] mb-0">
        {sharedFacts(s).map((f) => (
          <div key={f.k} className="flex flex-col sm:flex-row sm:items-baseline gap-[2px] sm:gap-[14px] border-t border-n300 py-[9px]">
            <dt className={cx(mono, "sm:w-[190px] flex-none text-[9.5px] tracking-[0.1em] text-n700")}>{f.k}</dt>
            <dd className="m-0 text-[13px] leading-[1.45] [overflow-wrap:anywhere]">{f.v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-[16px] flex flex-wrap items-center gap-x-[18px] gap-y-[10px]">
        <DownloadSharedPdf token={token} hasPdf={s.has_pdf} />
        <Link
          href={`/verify/${encodeURIComponent(s.ref)}`}
          prefetch={false}
          className="font-mono text-[11px] tracking-[0.06em] text-accent-700 underline focus-visible:outline-2 focus-visible:outline-accent"
        >
          VERIFY THIS REFERENCE
        </Link>
      </div>
    </div>
  );
}

/** Loading: neutral, never the accent, in the place the answer will take. */
export function ShareLoading() {
  return (
    <div data-testid="share-loading" role="status" className="mt-[24px] border border-ink border-t-[3px] border-t-n400 py-[18px] px-[20px] bg-panel">
      <p className={cx(mono, "m-0 text-[10px] tracking-[0.13em] text-n600")}>Opening</p>
      <p className="mt-[7px] mb-0 text-[13px] leading-[1.55] text-n700">Opening the shared report.</p>
    </div>
  );
}
