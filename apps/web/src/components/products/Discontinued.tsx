import { EmptyState, STATE_LABEL, STATE_TEXT, StateGlyph } from "@/components/kit";
import type { DiscontinuedRow } from "@/lib/products/queries";

const HEAD = "py-[10px] pr-[12px] font-mono text-[9.5px] font-normal tracking-[0.12em] uppercase text-n600 text-left";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * S-NV2-023 Discontinued products (C04.must.1). Nothing is deleted: a discontinued product leaves the board, the
 * portfolio counts, freshness and monitoring, and keeps every report and certificate it produced resolvable. Its
 * name opens the product, where its stage can be changed back (reversible, recorded like any other change).
 */
export function Discontinued({ workspaceId, rows, total }: { workspaceId: string; rows: DiscontinuedRow[]; total: number }) {
  return (
    <div className="max-w-[948px]" data-discontinued>
      <div className="flex flex-wrap items-end gap-[22px] border-b border-ink pb-[10px]">
        <p className="m-0 flex-1 min-w-[280px] text-[13.5px] leading-[1.55] text-n700 max-w-[74ch]">
          Nothing is deleted. A discontinued product leaves the board, the portfolio counts, freshness and monitoring, and
          keeps every certificate and report it ever produced resolvable.
        </p>
        <span className="font-mono text-[10.5px] uppercase text-n600 whitespace-nowrap" data-discontinued-count>
          {plural(rows.length, "product")} · excluded from {Math.max(0, total - rows.length)}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="mt-[18px]">
          <EmptyState
            where="DISCONTINUED · NONE"
            title="No product is discontinued"
            body="A product leaves the board by becoming discontinued, from its own screen. It stays here, with every report and certificate it produced."
            action={{ label: "Add a product", href: `/w/${workspaceId}/products/new` }}
          />
        </div>
      ) : (
        <table className="w-full border-collapse mt-0">
          <thead>
            <tr className="border-b border-ink">
              <th scope="col" className={HEAD}>Product</th>
              <th scope="col" className={HEAD}>Discontinued</th>
              <th scope="col" className={HEAD}>Reason recorded</th>
              <th scope="col" className={HEAD}>Artefacts</th>
              <th scope="col" className={`${HEAD} text-right`}>Last state</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-rule align-top">
                <td className="py-[14px] pr-[16px]">
                  <a href={`/w/${workspaceId}/products/${r.id}/check`} className="text-[14px] font-medium text-ink no-underline hover:text-accent-700">
                    {r.name}
                  </a>
                  <div className="mt-[4px] font-mono text-[10px] text-n600">
                    {r.familyShared ? `family ${r.family}` : r.everChecked ? "own family" : "never checked"}
                  </div>
                </td>
                <td className="py-[14px] pr-[16px] font-mono text-[11px] text-n700 whitespace-nowrap">{r.discontinuedAt.slice(0, 10)}</td>
                <td className="py-[14px] pr-[16px] text-[13px] text-n800">{r.reason ?? "—"}</td>
                <td className="py-[14px] pr-[16px] font-mono text-[11px]">
                  <Artefacts workspaceId={workspaceId} row={r} />
                </td>
                <td className="py-[14px] text-right">
                  {r.lastState ? (
                    <span className={`inline-flex items-center gap-[6px] font-mono text-[10.5px] tracking-[0.08em] uppercase ${STATE_TEXT[r.lastState]}`}>
                      <StateGlyph state={r.lastState} size="sm" />
                      Was {STATE_LABEL[r.lastState]}
                    </span>
                  ) : (
                    <span className="font-mono text-[10.5px] tracking-[0.08em] uppercase text-n600">Never checked</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="mt-[22px] grid gap-[18px] md:grid-cols-3" data-discontinued-notes>
        <Note title="Not deleted">
          A certificate names a product. If the product disappeared, every artefact that cites it would stop resolving.
        </Note>
        <Note title="Out of the numbers">
          Excluded from portfolio counts, freshness and monitoring. A rule change never raises an alert on a discontinued
          product.
        </Note>
        <Note title="Reversible">
          A product can be made active again. The change is recorded, dated and attributed like any other event.
        </Note>
      </div>
    </div>
  );
}

function Artefacts({ workspaceId, row }: { workspaceId: string; row: DiscontinuedRow }) {
  const parts = [
    row.reports ? plural(row.reports, "report") : null,
    row.certificates ? plural(row.certificates, "certificate") : null,
    row.envelopes ? plural(row.envelopes, "envelope") : null,
  ].filter(Boolean);
  if (parts.length === 0) return <span className="text-n600">None</span>;
  if (!row.reports) return <span className="text-n700">{parts.join(" · ")}</span>;
  return (
    <a href={`/w/${workspaceId}/products/${row.id}/report`} className="text-accent-700 no-underline hover:text-accent">
      {parts.join(" · ")}
    </a>
  );
}

function Note({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-rule py-[14px] px-[16px]">
      <p className="m-0 font-mono text-[10px] tracking-[0.12em] uppercase text-n600">{title}</p>
      <p className="mt-[6.5px] mb-0 text-[13px] leading-[1.5] text-n700">{children}</p>
    </div>
  );
}
