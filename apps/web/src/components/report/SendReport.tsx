"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { ProductNotFound } from "@/components/artwork/ProductNotFound";
import { Blueprint, Button, Dialog, EmptyState, SectionHeading, cx } from "@/components/kit";
import { Screen } from "@/components/shell";
import { createEmailShare, createLinkShare, reportPdfLink, revokeShare, type ShareRefusal } from "@/lib/share/actions";
import {
  DEFAULT_EXPIRY_DAYS,
  EXPIRY_CHOICES,
  formatUtc,
  looksLikeEmail,
  pinFacts,
  shareLine,
  type PinnedReport,
  type ShareRow,
} from "@/lib/share/model";
import type { SendPage } from "@/lib/share/queries";

// S-NV2-026 Export, send, share (Nutrivo 2.0, screen "send", U09), I01 and I02. The design draws the four routes as
// static cards and the link settings as a static list; the controls live inside them (question 6 on #58): Export
// downloads the stored PDF, Email sends Template 01 to one address, Share by link makes a revocable link shown once,
// and Link settings sets the expiry and lists this report's shares, each revocable. Revoking stops the share page and
// never verification of the document (BE-27): the reference keeps verifying on /verify.

const mono = "font-mono uppercase";

const ARTEFACTS = [
  {
    name: "Report of Check",
    tier: "EVERY PAID PLAN · AT LAUNCH",
    tierClass: "text-accent-700",
    body: "Generated and pinned: ruleset version, artwork hash, timestamp and the not-assessed section. Sendable, shareable and verifiable. It says on its face that it was generated automatically and attested by nobody.",
  },
  {
    name: "Certificate of Check",
    tier: "ADVANCED ONLY",
    tierClass: "text-n600",
    body: "The same content plus a named person holding signing authority for that market, entered into an append-only chain. Internal attestation wording only. A document that looks like a certificate and is not one is worse than no document.",
  },
];

const REFUSAL: Record<ShareRefusal, string> = {
  "no-permission": "Your role cannot share this report. An editor of this product can.",
  invalid: "That was not accepted. Check the address and try again.",
  "not-available": "The PDF of this report is not available yet.",
  error: "Nothing changed. Try again in a moment.",
};

export function SendReport({
  route,
  workspaceId,
  productId,
  page,
}: {
  route: string;
  workspaceId: string;
  productId: string;
  page: SendPage;
}) {
  return (
    <Screen
      route={route}
      crumb="Artefacts · Report of Check"
      title="Sending the report"
      aside={
        page.kind === "loaded" ? (
          <span className="border border-rule py-[5px] px-[9px] font-mono text-[10.5px] tracking-[0.06em] text-n600 whitespace-nowrap">
            RULESET {page.report.rulesetVersion}
          </span>
        ) : null
      }
    >
      {page.kind === "not-found" ? (
        <ProductNotFound workspaceId={workspaceId} />
      ) : page.kind === "no-report" ? (
        <div className="max-w-[640px]" data-send-state="no-report">
          <EmptyState
            where="REPORT OF CHECK"
            title="No report has been issued for this product yet"
            body="A Report of Check is generated from a finished check, pinned to its ruleset version and artwork hash. Once one is issued it can be exported, emailed, shared by link and verified here."
            action={{ label: "Open the label report", href: `/w/${workspaceId}/products/${productId}/report` }}
          />
        </div>
      ) : (
        <Loaded workspaceId={workspaceId} productId={productId} page={page} />
      )}
    </Screen>
  );
}

function Loaded({
  workspaceId,
  productId,
  page,
}: {
  workspaceId: string;
  productId: string;
  page: Extract<SendPage, { kind: "loaded" }>;
}) {
  const [expiry, setExpiry] = useState<number | null>(DEFAULT_EXPIRY_DAYS);
  const r = page.report;
  return (
    <div
      data-send-state="loaded"
      className="grid gap-[22px] items-start grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(250px,330px)]"
    >
      <div>
        <Blueprint className="py-[20px] px-[22px]" as="section">
          <p className={cx(mono, "m-0 text-[10px] tracking-[0.13em] text-n500")}>Report of Check · pinned</p>
          <h2 className="mt-[8px] mb-0 font-head text-[26px] font-semibold leading-[1.15]">
            {page.product.name}
            {r.market ? ` · ${r.market}` : ""}
          </h2>
          {page.reports.length > 1 ? (
            <ReportPicker workspaceId={workspaceId} productId={productId} reports={page.reports} current={r.id} />
          ) : null}
          <dl className="mt-[16px] mb-0 grid grid-cols-1 sm:grid-cols-2 gap-x-[20px]">
            {pinFacts(r).map((f) => (
              <div key={f.k} className="border-t border-rule py-[10px]">
                <dt className={cx(mono, "m-0 text-[9.5px] tracking-[0.12em] text-n500")}>{f.k}</dt>
                <dd className="mt-[4px] mb-0 font-mono text-[12px] leading-[1.4] [overflow-wrap:anywhere]">{f.v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-[16px] mb-0 text-[13px] leading-[1.55] text-n700 max-w-[72ch]">
            This report states on its face that it was generated automatically and attested by nobody. It carries the
            ruleset version, the artwork hash and the not-assessed section, and it can be verified by anyone holding the
            reference.
          </p>
        </Blueprint>

        <div className="mt-[22px]">
          <SectionHeading note="Every route produces the same document and the same reference">Send it</SectionHeading>
        </div>
        <div className="mt-[14px] grid grid-cols-1 md:grid-cols-2 gap-[14px]">
          <ExportCard workspaceId={workspaceId} report={r} />
          <EmailCard report={r} expiry={expiry} />
          <LinkCard report={r} expiry={expiry} />
          <RouteCard
            k="Verification page"
            v="Anyone holding the reference can confirm the report is current, superseded or unknown."
            meta="PUBLIC · NO ACCOUNT"
          >
            <Link
              href={`/verify/${encodeURIComponent(r.ref)}`}
              prefetch={false}
              className="font-mono text-[11px] tracking-[0.06em] text-accent-700 underline focus-visible:outline-2 focus-visible:outline-accent"
            >
              OPEN THE VERIFICATION PAGE
            </Link>
          </RouteCard>
        </div>

        <div className="mt-[22px] border border-rule py-[16px] px-[18px] bg-panel">
          <p className={cx(mono, "m-0 text-[10px] tracking-[0.13em] text-n500")}>Two artefacts, not one</p>
          <div className="mt-[12px] grid grid-cols-1 md:grid-cols-2 gap-[20px]">
            {ARTEFACTS.map((a) => (
              <div key={a.name}>
                <p className="m-0 font-head text-[17px] font-semibold">{a.name}</p>
                <p className={cx("mt-[4px] mb-0 font-mono text-[10px] tracking-[0.06em]", a.tierClass)}>{a.tier}</p>
                <p className="mt-[8px] mb-0 text-[12.5px] leading-[1.55] text-n700">{a.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-[18px]">
        {page.plan === "free" ? (
          <Blueprint edge="border-t-[3px] border-t-accent" className="py-[16px] px-[18px] bg-accent-100">
            <p className={cx(mono, "m-0 text-[10px] tracking-[0.13em] text-accent")}>On your three free labels</p>
            <p className="mt-[8px] mb-0 font-head text-[19px] font-semibold leading-[1.25]">
              Send this one. A fourth label is where a plan starts.
            </p>
            <p className="mt-[8px] mb-0 text-[12.5px] leading-[1.55] text-accent-900">
              Nothing is held back on the free labels: four states, every finding, export, email, share, provenance and
              coverage links, unlimited re-checks. The wall is the export, the email, the share link and the second
              product.
            </p>
            <div className="mt-[14px] flex gap-[8px]">
              <Link
                href={`/w/${workspaceId}/billing/plans`}
                className="bg-accent text-paper font-mono text-[10.5px] tracking-[0.04em] py-[8px] px-[12px] no-underline hover:bg-accent-600 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              >
                SEE THE PLANS
              </Link>
            </div>
          </Blueprint>
        ) : null}
        <LinkSettings shares={page.shares} expiry={expiry} onExpiry={setExpiry} />
      </div>
    </div>
  );
}

function ReportPicker({
  workspaceId,
  productId,
  reports,
  current,
}: {
  workspaceId: string;
  productId: string;
  reports: { id: string; ref: string; market: string | null; issuedAt: string }[];
  current: string;
}) {
  const router = useRouter();
  return (
    <div className="mt-[12px] flex flex-wrap items-baseline gap-[10px]">
      <label htmlFor="send-report" className={cx(mono, "text-[9.5px] tracking-[0.12em] text-n500")}>
        Report
      </label>
      <select
        id="send-report"
        value={current}
        onChange={(e) => router.push(`/w/${workspaceId}/products/${productId}/report/send?report=${e.target.value}`)}
        className="border border-n400 bg-paper py-[5px] px-[8px] font-mono text-[11.5px] rounded-none focus-visible:outline-2 focus-visible:outline-accent"
      >
        {reports.map((r) => (
          <option key={r.id} value={r.id}>
            {r.ref} · {r.market ?? "—"} · {formatUtc(r.issuedAt).slice(0, 10)}
          </option>
        ))}
      </select>
    </div>
  );
}

function RouteCard({ k, v, meta, children }: { k: string; v: string; meta: string; children?: ReactNode }) {
  return (
    <section aria-label={k} className="border border-ink py-[15px] px-[17px] bg-paper">
      <h3 className={cx(mono, "m-0 text-[10px] tracking-[0.1em] text-accent font-normal")}>{k}</h3>
      <p className="mt-[7px] mb-0 text-[13px] leading-[1.5] text-n700">{v}</p>
      <p className={cx(mono, "mt-[10px] mb-0 text-[10.5px] text-n600")}>{meta}</p>
      {children ? <div className="mt-[12px]">{children}</div> : null}
    </section>
  );
}

function Problem({ text }: { text: string | null }) {
  return (
    <p role={text ? "alert" : undefined} className={cx("mb-0 text-[12px] leading-[1.45] text-blocked", text ? "mt-[8px]" : "hidden")}>
      {text}
    </p>
  );
}

function ExportCard({ workspaceId, report }: { workspaceId: string; report: PinnedReport }) {
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  function download() {
    setProblem(null);
    start(async () => {
      const result = await reportPdfLink(workspaceId, report.id);
      if (!result.ok) return setProblem(REFUSAL[result.reason]);
      window.location.assign(result.value);
    });
  }
  return (
    <RouteCard
      k="Export"
      v="A PDF of the report exactly as it reads on screen, including the not-assessed section and every provenance mark."
      meta={report.hasPdf ? "PDF" : "PDF · NOT STORED YET"}
    >
      <Button onClick={download} disabled={pending || !report.hasPdf}>
        {pending ? "Preparing…" : "Download the PDF"}
      </Button>
      <Problem text={problem} />
    </RouteCard>
  );
}

function EmailCard({ report, expiry }: { report: PinnedReport; expiry: number | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [address, setAddress] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  function send(e: React.FormEvent) {
    e.preventDefault();
    setProblem(null);
    setSent(null);
    if (!looksLikeEmail(address)) return setProblem("Enter one email address.");
    start(async () => {
      const result = await createEmailShare(report.id, address, expiry);
      if (!result.ok) return setProblem(REFUSAL[result.reason]);
      setSent(address.trim().toLowerCase());
      setAddress("");
      router.refresh();
    });
  }
  return (
    <RouteCard
      k="Email"
      v="Sent from us with the reference in the subject line, so the recipient can verify it without asking you for anything."
      meta="TO NAMED RECIPIENTS"
    >
      <form onSubmit={send} className="flex" noValidate>
        <label htmlFor="share-email" className="sr-only">
          Recipient email
        </label>
        <input
          id="share-email"
          type="email"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          autoComplete="off"
          placeholder="name@company.com"
          maxLength={254}
          className="flex-1 min-w-0 border border-n400 border-r-0 py-[7px] px-[10px] text-[12.5px] bg-paper rounded-none placeholder:text-n500 focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2"
        />
        <Button type="submit" variant="primary" className="rounded-none" disabled={pending}>
          {pending ? "Sending…" : "Send"}
        </Button>
      </form>
      <Problem text={problem} />
      <p aria-live="polite" className={cx("mb-0 text-[12px] leading-[1.45] text-n700", sent ? "mt-[8px]" : "hidden")}>
        {sent ? `Queued for ${sent}. It appears under Link settings.` : null}
      </p>
    </RouteCard>
  );
}

function LinkCard({ report, expiry }: { report: PinnedReport; expiry: number | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  function create() {
    setProblem(null);
    setCopied(false);
    start(async () => {
      const result = await createLinkShare(report.id, expiry);
      if (!result.ok) return setProblem(REFUSAL[result.reason]);
      // Shown once: the database keeps only its hash, so it cannot be shown again.
      setUrl(`${window.location.origin}/share/${result.value.token}`);
      router.refresh();
    });
  }
  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setProblem("The link could not be copied. Select it and copy it yourself.");
    }
  }
  return (
    <RouteCard
      k="Share by link"
      v="A read-only page of this one report. The recipient needs no account and sees nothing else in the workspace."
      meta="LINK · REVOCABLE"
    >
      {url ? (
        <div data-share-link>
          <label htmlFor="share-url" className="sr-only">
            Share link
          </label>
          <div className="flex">
            <input
              id="share-url"
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 min-w-0 border border-n400 border-r-0 py-[7px] px-[10px] font-mono text-[11px] bg-paper rounded-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2"
            />
            <Button variant="primary" className="rounded-none" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="mt-[8px] mb-0 text-[12px] leading-[1.45] text-n700">
            Shown once: we keep only a fingerprint of it. Make another link any time.
          </p>
        </div>
      ) : (
        <Button onClick={create} disabled={pending}>
          {pending ? "Making the link…" : "Create a link"}
        </Button>
      )}
      <Problem text={problem} />
    </RouteCard>
  );
}

function LinkSettings({
  shares,
  expiry,
  onExpiry,
}: {
  shares: ShareRow[];
  expiry: number | null;
  onExpiry: (days: number | null) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState<ShareRow | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const row = "flex items-baseline gap-[12px] border-t border-rule py-[9px]";
  function revoke(share: ShareRow) {
    setConfirm(null);
    setProblem(null);
    start(async () => {
      const result = await revokeShare(share.id);
      if (!result.ok) return setProblem(REFUSAL[result.reason]);
      router.refresh();
    });
  }
  return (
    <section aria-label="Link settings" className="border border-rule py-[16px] px-[18px] bg-paper">
      <h2 className={cx(mono, "m-0 text-[10px] tracking-[0.13em] text-n500 font-normal")}>Link settings</h2>
      <div className="mt-[10px]">
        <div className={row}>
          <label htmlFor="share-expiry" className="flex-1 text-[12.5px]">
            Expires
          </label>
          <select
            id="share-expiry"
            value={expiry === null ? "never" : String(expiry)}
            onChange={(e) => onExpiry(e.target.value === "never" ? null : Number(e.target.value))}
            className="border-0 bg-transparent font-mono text-[10.5px] text-n700 text-right cursor-pointer focus-visible:outline-2 focus-visible:outline-accent"
          >
            {EXPIRY_CHOICES.map((c) => (
              <option key={c.label} value={c.days === null ? "never" : String(c.days)}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        {[
          { k: "Password", v: "OFF" },
          { k: "Recipient can download", v: "YES" },
          { k: "Revoked links", v: "SHOW AS UNKNOWN" },
        ].map((l) => (
          <div key={l.k} className={row}>
            <span className="flex-1 text-[12.5px]">{l.k}</span>
            <span className="font-mono text-[10.5px] text-n700">{l.v}</span>
          </div>
        ))}
      </div>
      <p className="mt-[12px] mb-0 text-[12px] leading-[1.5] text-n600">
        A recipient sees the report and can verify the reference. They never see the rest of your portfolio.
      </p>

      <h3 className={cx(mono, "mt-[18px] mb-0 text-[10px] tracking-[0.13em] text-n500 font-normal")}>
        Shares of this report
      </h3>
      {shares.length === 0 ? (
        <p className="mt-[8px] mb-0 text-[12px] leading-[1.5] text-n600" data-shares-empty>
          Not shared yet.
        </p>
      ) : (
        <ul className="mt-[6px] mb-0 p-0 list-none" aria-label="Shares of this report">
          {shares.map((s) => {
            const line = shareLine(s);
            return (
              <li key={s.id} data-share={s.id} data-share-status={line.status} className={row}>
                <span className="flex-1 min-w-0 text-[12.5px] [overflow-wrap:anywhere]">{line.who}</span>
                <span className="font-mono text-[10px] text-n600 whitespace-nowrap">{line.when}</span>
                {line.status === "live" ? (
                  <Button variant="ghost" className="!p-0 text-[12px]" disabled={pending} onClick={() => setConfirm(s)}>
                    Revoke<span className="sr-only"> the share {line.who === "Link" ? "link" : `to ${line.who}`}</span>
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <Problem text={problem} />
      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        kicker="REVOKE A SHARE"
        title="Stop this link working?"
        confirmLabel="Revoke"
        onConfirm={() => confirm && revoke(confirm)}
      >
        <p className="m-0 text-[13px] leading-[1.55] text-n700">
          Whoever holds it will see the same answer as for an unknown link. The report itself is unchanged and its
          reference still verifies.
        </p>
      </Dialog>
    </section>
  );
}
