"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { FullExport } from "@/app/w/[workspace]/settings/data/DataAndRetention";
import { Blueprint, Button, EmptyState, SectionHeading, cx } from "@/components/kit";
import { useShell } from "@/components/shell";
import { formatWhen, type ExportState } from "@/lib/exports/exports";
import { requestReport } from "@/lib/exports/report-actions";
import type { ReportLine } from "@/lib/exports/reports";
import { reportPdfLink } from "@/lib/share/actions";
import { hrefFor, roleAllows } from "@/lib/shell/routes";

// S-NV2-018 Exports (design: product/Nutrivo 2.0.dc.html, screen "exports"). T-1112: the Report of Check per check
// (I01) and the full export (O03), and only what a contract backs. The design's Certificate of Check card, its five
// working packs (action plan, portfolio board, obligation register, design envelope, dossier pack), the "Never
// exported" box and the Compliance Worker have no contract behind them on this screen, so they are not drawn; the
// export rule keeps only the claims the report and the export make true (docs/20, S-NV2-018).

const PREPARING_REFRESH_MS = 10_000;

const RULES: { k: string; v: string }[] = [
  { k: "Stamped", v: "Every Report of Check prints its reference, ruleset version, artwork hash and issue time on its face." },
  { k: "Bounded", v: "Every report carries its Not assessed section. Silence is never read as clear." },
  { k: "Traceable", v: "Each report is recorded against its product and market, and its record is never changed or deleted." },
  { k: "Free to take", v: "The full export of the workspace is free on every plan, including the free one." },
];

const SECTIONS = [
  "Scope & classification",
  "Artwork with pins",
  "Findings",
  "Measurements",
  "Not assessed",
  "Other language panels",
  "Registration",
];

const HEAD = "text-left font-mono text-[9.5px] tracking-[0.1em] uppercase font-normal text-n600 border-b border-rule py-[9px] pr-[10px]";
const CELL = "border-b border-rule py-[11px] pr-[10px] align-top";
const MONO_TAG = "border border-accent-200 text-accent-700 py-[3px] px-[7px] font-mono text-[9.5px] tracking-[0.08em]";

export type ExportsView = {
  workspaceId: string;
  lines: ReportLine[];
  /** The latest full export, read only for an admin (the export card is theirs). */
  fullExport: ExportState | null;
};

export function Exports({ view }: { view: ExportsView }) {
  const { current } = useShell();
  const router = useRouter();
  const preparing = view.lines.some((l) => l.report.kind === "preparing");

  // While a report is prepared, re-read the page every 10 s, as the full export card does.
  useEffect(() => {
    if (!preparing) return;
    const timer = window.setInterval(() => router.refresh(), PREPARING_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [preparing, router]);

  return (
    <div data-region="exports">
      <Blueprint as="section" className="py-[18px] px-[20px] bg-accent-100" >
        <h2 className="m-0 font-mono text-[10px] tracking-[0.13em] uppercase text-accent-700 font-normal">The export rule</h2>
        <p className="mt-[7px] mb-0 font-head text-[21px] font-semibold leading-[1.15] text-accent-700">
          A report leaves the building as a claim. It is pinned, and it says what was not assessed.
        </p>
        <dl className="mt-[12px] mb-0 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-[18px]">
          {RULES.map((r) => (
            <div key={r.k}>
              <dt className="font-mono text-[9.5px] tracking-[0.09em] uppercase text-accent-700">{r.k}</dt>
              <dd className="mt-[4px] mx-0 text-[12.5px] leading-[1.5] text-ink">{r.v}</dd>
            </div>
          ))}
        </dl>
      </Blueprint>

      <div className="mt-[26px] flex flex-wrap items-baseline gap-x-[14px] border-b border-ink pb-[8px]">
        <h2 className="m-0 font-mono text-[10px] tracking-[0.13em] uppercase text-accent-700 font-normal">Artefacts</h2>
        <p className="m-0 text-[12.5px] text-n700">
          Documents that leave the building as a claim about a product, pinned and verifiable, and the full export.
        </p>
      </div>
      <div className="mt-[16px] grid grid-cols-1 lg:grid-cols-2 gap-[16px]">
        <article
          data-region="report-card"
          className="border border-rule border-l-[3px] border-l-action py-[16px] px-[18px] flex flex-col"
        >
          <div className="flex items-baseline gap-[10px]" data-card-title>
            <span className="font-mono text-[10px] tracking-[0.1em] text-n600">01</span>
            <h3 className="m-0 flex-1 font-head text-[19px] font-semibold leading-[1.15] tracking-normal">Report of Check</h3>
            <span className={MONO_TAG}>PDF</span>
          </div>
          <p className="mt-[7px] mb-0 text-[13px] leading-[1.5] text-n700">
            One document per market and printed language. Artwork with the pins, each finding as an instruction with its
            citation and the measured value against the required one.
          </p>
          <p className="mt-[8px] mb-0 font-mono text-[10px] tracking-[0.06em] uppercase text-accent-700">
            Goes to · Prepress and the artwork agency, usually outside the tool
          </p>
          <div className="mt-[11px] border-t border-rule pt-[9px]">
            <p className="m-0 mb-[5px] font-mono text-[9.5px] tracking-[0.09em] uppercase text-n600">Sections</p>
            <ul className="m-0 p-0 list-none flex flex-wrap gap-[4px]">
              {SECTIONS.map((s) => (
                <li key={s} className="border border-n200 bg-panel py-[3px] px-[7px] font-mono text-[10px] text-n700">
                  {s}
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-[13px] mb-0 text-[11.5px] leading-[1.4] text-n600">
            Generated from a finished check and listed below, one per product, market and language.
          </p>
        </article>
        <article
          data-region="full-export"
          className="border border-rule border-l-[3px] border-l-accent py-[16px] px-[18px] flex flex-col"
        >
          <div className="flex items-baseline gap-[10px]">
            <span className="font-mono text-[10px] tracking-[0.1em] text-n600">02</span>
            <h3 className="m-0 flex-1 font-head text-[19px] font-semibold leading-[1.15] tracking-normal">Full export</h3>
            <span className={MONO_TAG}>ZIP</span>
          </div>
          <p className="mt-[8px] mb-0 font-mono text-[10px] tracking-[0.06em] uppercase text-accent-700">
            Goes to · You, to keep or to move elsewhere
          </p>
          <div className="mt-[11px] border-t border-rule pt-[11px]">
            {view.fullExport ? (
              <FullExport workspaceId={view.workspaceId} initial={view.fullExport} />
            ) : (
              <p className="m-0 text-[12.5px] leading-[1.5] text-n700" data-export-note>
                Recipes, checks, findings, reports, certificates and documents, with the ruleset version on every row.
                An admin of {current.name} requests it; it is free on every plan.
              </p>
            )}
          </div>
        </article>
      </div>

      <section className="mt-[30px]" aria-labelledby="ex-reports" data-region="reports">
        <SectionHeading note="the latest check of each product, market and language">
          <span id="ex-reports">Reports of Check</span>
        </SectionHeading>
        {view.lines.length ? (
          <ReportTable workspaceId={view.workspaceId} lines={view.lines} canRequest={roleAllows(current.role, "editor")} />
        ) : (
          <div className="mt-[14px] max-w-[640px]">
            <EmptyState
              where="REPORTS OF CHECK"
              title="No label has been checked in this workspace yet"
              body="A Report of Check is generated from a finished check, pinned to its ruleset version and artwork hash. Check a label and its report can be generated here."
              action={
                roleAllows(current.role, "editor")
                  ? { label: "Add a product", href: hrefFor("/w/[workspace]/products/new", view.workspaceId) }
                  : undefined
              }
            />
          </div>
        )}
      </section>
    </div>
  );
}

function ReportTable({ workspaceId, lines, canRequest }: { workspaceId: string; lines: ReportLine[]; canRequest: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse">
        <thead>
          <tr>
            <th scope="col" className={cx(HEAD, "w-[26%]")}>Product</th>
            <th scope="col" className={cx(HEAD, "w-[14%]")}>Market</th>
            <th scope="col" className={cx(HEAD, "w-[9%]")}>Language</th>
            <th scope="col" className={cx(HEAD, "w-[17%]")}>Checked</th>
            <th scope="col" className={cx(HEAD, "pr-0")}>Report</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.checkId} data-check={l.checkId} data-report-state={l.report.kind}>
              <td className={cx(CELL, "text-[13.5px] font-medium")}>
                <Link
                  href={`${hrefFor("/w/[workspace]/products/[product]/report", workspaceId).replace("[product]", l.productId)}`}
                  className="text-ink hover:text-accent-700 hover:underline"
                >
                  {l.product}
                </Link>
              </td>
              <td className={cx(CELL, "text-[13px]")}>{l.market}</td>
              <td className={cx(CELL, "font-mono text-[11px] uppercase")}>{l.language ?? "—"}</td>
              <td className={cx(CELL, "font-mono text-[10px] text-n600")}>
                <span className="block">{formatWhen(l.checkedAt)}</span>
                <span className="block mt-[2px]">RULESET {l.rulesetVersion}</span>
              </td>
              <td className={cx(CELL, "pr-0")}>
                <ReportCell workspaceId={workspaceId} line={l} canRequest={canRequest} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportCell({ workspaceId, line, canRequest }: { workspaceId: string; line: ReportLine; canRequest: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const r = line.report;
  const label = `${line.product}, ${line.market}${line.language ? `, ${line.language.toUpperCase()}` : ""}`;

  function generate() {
    setProblem(null);
    start(async () => {
      const result = await requestReport(line.checkId);
      if (!result.ok) {
        setProblem(
          result.problem ??
            (result.reason === "no-permission"
              ? "Your role or market scope cannot generate this report."
              : "The report was not requested. Nothing changed; try again."),
        );
        return;
      }
      router.refresh();
    });
  }

  function download(reportId: string) {
    setProblem(null);
    start(async () => {
      const result = await reportPdfLink(workspaceId, reportId);
      if (!result.ok) {
        setProblem("The download link could not be made. Try again.");
        return;
      }
      window.location.assign(result.value);
    });
  }

  return (
    <div aria-live="polite">
      {r.kind === "issued" ? (
        <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[6px]">
          <span className="font-mono text-[10.5px] text-ink" data-ref>
            {r.ref}
          </span>
          <span className="font-mono text-[10px] text-n600">ISSUED {formatWhen(r.issuedAt)}</span>
          {r.pdf ? (
            <Button
              variant="secondary"
              className="border-accent text-accent-700 hover:bg-accent-100"
              disabled={pending}
              aria-busy={pending}
              aria-label={`Download the PDF: ${label}`}
              onClick={() => download(r.reportId)}
            >
              Download the PDF
            </Button>
          ) : (
            <span className="text-[12px] text-n700">The PDF is not stored yet.</span>
          )}
        </div>
      ) : null}
      {r.kind === "preparing" ? (
        <p role="status" className="m-0 font-mono text-[10px] tracking-[0.08em] uppercase text-n600">
          Preparing the report
        </p>
      ) : null}
      {r.kind === "failed" ? (
        <p className="m-0 text-[12.5px] leading-[1.5] text-blocked">
          The report did not finish ({formatWhen(r.failedAt)}). Nothing was issued for this check; a new check can be
          reported.
        </p>
      ) : null}
      {r.kind === "none" ? (
        canRequest ? (
          <Button
            variant="secondary"
            className="border-accent text-accent-700 hover:bg-accent-100"
            disabled={pending}
            aria-busy={pending}
            aria-label={`Generate the report: ${label}`}
            onClick={generate}
          >
            Generate the report
          </Button>
        ) : (
          <span className="text-[12px] text-n700">Not generated yet. An editor can generate it.</span>
        )
      ) : null}
      {problem ? (
        <p role="alert" className="mt-[6px] mb-0 text-[12.5px] leading-[1.5] text-blocked">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
