import { Blueprint, ButtonLink, SectionHeading, cx } from "@/components/kit";
import { FAILURE_LABEL, FAILURE_REMEDY, formatPageSize, languageName, runHeadline } from "@/lib/artwork/describe";
import type { ArtworkSummary, PanelRow, RunSummary } from "@/lib/artwork/queries";

const EDGE: Record<string, string> = {
  clear: "border-t-[3px] border-t-clear",
  action: "border-t-[3px] border-t-action",
  blocked: "border-t-[3px] border-t-blocked",
};
const TITLE: Record<string, string> = { succeeded: "Extraction", partial: "Partial extraction", failed: "Artwork we cannot read" };
const TAG: Record<string, string> = { clear: "text-clear", action: "text-action", blocked: "text-blocked" };

/**
 * S-NV2-025: the headline, what ran per language panel, how to get the geometry check where something could not be
 * read, and the file as received. No verdict is drawn here: checks are a separate event (D04), and a panel we could
 * not read is not assessed rather than passed.
 */
export function ArtworkReport({
  art,
  run,
  panels,
  checkHref,
}: {
  art: ArtworkSummary;
  run: RunSummary;
  panels: PanelRow[];
  checkHref: string;
}) {
  const headline = runHeadline(run, panels);
  const failures = [...new Set(panels.flatMap((p) => (p.failureCode ? [p.failureCode] : [])))];
  const read = panels.filter((p) => p.status === "extracted");
  const facts: [string, string][] = [
    // The design's rows are File, Size, Pages, Fonts embedded, Text layers, Received. Size and fonts are not stored yet
    // (waived on #41), so Version and Page size stand in their places.
    ["File", art.fileName ?? `version ${art.version}`],
    ["Version", String(art.version)],
    ["Pages", art.pageCount == null ? "—" : String(art.pageCount)],
    ["Page size", formatPageSize(art.pageSizeMm)],
    ["Text layers", `${read.length} of ${panels.length} panels`],
    ["Received", art.createdAt.slice(0, 16).replace("T", " ")],
  ];
  return (
        <div className="grid gap-[22px] items-start md:max-w-[948px] md:grid-cols-[minmax(0,1fr)_minmax(230px,300px)]">
          <div>
            <div data-artwork-headline>
              <Blueprint edge={EDGE[headline.tone]} className="py-[18px] px-[20px]">
                <p
                  className={cx("m-0 font-mono text-[10px] tracking-[0.13em] uppercase", TAG[headline.tone])}
                  data-run-status={run.status}
                >
                  {headline.tag}
                </p>
                <p className="mt-[8px] mb-0 font-head text-[26px] font-semibold leading-[1.15]">{headline.title}</p>
                <p className="mt-[8px] mb-0 text-[13.5px] leading-[1.55] text-n700 max-w-[68ch]">{headline.body}</p>
              </Blueprint>
            </div>

            <div className="mt-[22px]" data-panel-table>
              <SectionHeading>What ran, per language panel</SectionHeading>
              <table className="mt-[4px] w-full border-collapse table-fixed" aria-label="What ran, per language panel">
                {/* The design's columns at 1600 px; the verdict column is T-401–T-403's and is not drawn yet. */}
                <colgroup>
                  <col className="w-[144px]" />
                  <col className="w-[218px]" />
                  <col className="w-[86px]" />
                  <col />
                </colgroup>
                <thead className="sr-only">
                  <tr>
                    <th scope="col">Panel</th>
                    <th scope="col">Source</th>
                    <th scope="col">Text</th>
                    <th scope="col">Geometry</th>
                  </tr>
                </thead>
                <tbody>
                  {panels.map((p) => (
                    <tr key={p.id} className="border-b border-rule" data-panel={p.index} data-panel-status={p.status}>
                      <th scope="row" className="py-[11px] pl-0 pr-[8px] text-left align-baseline text-[13.5px] font-medium">
                        {languageName(p.language)}
                      </th>
                      <td className="py-[11px] pl-0 pr-[8px] align-baseline font-mono text-[10.5px] uppercase text-n600">
                        {p.status === "extracted"
                          ? `Live text · ${p.textObjects} ${p.textObjects === 1 ? "string" : "strings"}`
                          : (FAILURE_LABEL[p.failureCode ?? ""] ?? p.failureCode)}
                      </td>
                      <td
                        className={cx(
                          "py-[11px] pl-0 pr-[8px] align-baseline font-mono text-[10px] tracking-[0.06em] uppercase",
                          p.status === "extracted" ? "text-clear" : "text-n600",
                        )}
                      >
                        {p.status === "extracted" ? "Read" : "Not read"}
                      </td>
                      <td
                        className={cx(
                          "py-[11px] pl-0 align-baseline font-mono text-[10px] tracking-[0.06em] uppercase",
                          p.status === "extracted" ? "text-clear" : "text-n600",
                        )}
                      >
                        {p.status === "extracted" ? "Measured" : "Not measured"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {failures.length ? (
              <div className="mt-[22px] border border-ink py-[16px] px-[18px] bg-na-bg">
                <p className="m-0 font-mono text-[10px] tracking-[0.13em] uppercase text-na">Not assessed because of this file</p>
                <ul className="mt-[10px] mb-0 p-0 list-none grid gap-x-[22px] gap-y-[10px] md:grid-cols-2">
                  {failures.map((code) => {
                    const n = panels.filter((p) => p.failureCode === code).length;
                    return (
                      <li key={code} className="border-l-2 border-l-na pl-[11px] text-[12.5px] leading-[1.5]">
                        Character height, position and legibility: {n} {n === 1 ? "panel" : "panels"},{" "}
                        {FAILURE_LABEL[code]?.toLowerCase() ?? code}
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-[14px] mb-0 text-[12.5px] leading-[1.55] text-n700">
                  These items appear on the report by name. A reader can see exactly what was measured and what was not,
                  and no node reads clear on the strength of a panel we could not read.
                </p>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-[18px]">
            {failures.length ? (
              <Blueprint className="py-[16px] px-[18px] bg-accent-100">
                <p className="m-0 font-mono text-[10px] tracking-[0.13em] uppercase text-accent">How to get the geometry check</p>
                <ol className="mt-[10px] mb-0 pl-[18px] text-[13px] leading-[1.6]">
                  {failures.map((code) => (
                    <li key={code}>{FAILURE_REMEDY[code] ?? "Upload the print PDF with live text."}</li>
                  ))}
                </ol>
                <div className="mt-[14px]">
                  <ButtonLink href={checkHref} variant="primary">
                    Upload another file
                  </ButtonLink>
                </div>
                <p className="mt-[12px] mb-0 font-mono text-[10px] leading-[1.6] uppercase text-accent-700">
                  Re-checks are unlimited · replacing the file costs nothing
                </p>
              </Blueprint>
            ) : null}
            <div className="border border-rule py-[16px] px-[18px]" data-file-facts>
              <p className="m-0 font-mono text-[10px] leading-[15px] tracking-[0.13em] uppercase text-n600">File as received</p>
              <dl className="mt-[10px] mb-0 flex flex-col">
                {facts.map(([k, v]) => (
                  <div key={k} className="flex items-baseline gap-[12px] border-t border-rule py-[8px]">
                    <dt className="flex-1 font-mono text-[10px] tracking-[0.08em] uppercase text-n600">{k}</dt>
                    <dd className="m-0 font-mono text-[11px] text-right break-all">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <a href={checkHref} className="font-mono text-[10.5px] kit-transition">
              ← Back to upload &amp; scope
            </a>
          </div>
        </div>
  );
}

export function reportTitle(run: RunSummary): string {
  return TITLE[run.status] ?? "Extraction";
}
