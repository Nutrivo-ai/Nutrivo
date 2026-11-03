import { EmptyState, STATE_LABEL, StateGlyph, cx } from "@/components/kit";
import { formatDay, type Expiry, type Library, type LibraryDocument, type MarketCard } from "@/lib/documents/library";

// S-NV2-010 Documents (design: product/Nutrivo 2.0.dc.html, screen "documents"). H01 (T-801): each market states how
// complete its documents are against ref.document_requirements, and every document shows its expiry. Read only:
// documents are insert-only and arrive through T-802. Where the design draws what the schema cannot say yet, the
// screen says less rather than inventing (issue #68): a market without encoded requirements reads Not assessed with no
// count, a document is named by its stored file, and the design's impact column is left out.

const TODAY_LABEL: Record<Expiry["kind"], string> = {
  expired: "EXPIRED",
  expiring: "EXPIRES",
  current: "CURRENT",
  no_expiry: "NO EXPIRY DATE",
};

const EXPIRY_TONE: Record<Expiry["kind"], string> = {
  expired: "text-n700",
  expiring: "text-action",
  current: "text-clear",
  no_expiry: "text-n600",
};

const SCAN_LABEL: Record<string, string> = {
  quarantine: "Being scanned: not counted yet",
  rejected: "Rejected by the scan: never counted",
};

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

export function DocumentLibrary({ library, today }: { library: Library; today: string }) {
  const { markets, documents } = library;
  return (
    <div data-documents>
      <p data-testid="documents-intro" className="m-0 mb-[16px] text-[14px] leading-[1.55] max-w-[92ch] text-n700">
        Not a folder. Each market states how complete its dossier is, which documents are missing, and which expire
        before your launch date.
      </p>

      {markets.length > 0 ? (
        <ul aria-label="Markets" className="m-0 p-0 list-none grid gap-[16px] grid-cols-1 md:grid-cols-3">
          {markets.map((m) => (
            <Market key={m.nodeId} market={m} />
          ))}
        </ul>
      ) : null}

      <section aria-labelledby="documents-expiring" className={markets.length > 0 ? "mt-[26px]" : undefined}>
        <div data-testid="documents-heading" className="flex flex-wrap items-baseline gap-[12px] border-b border-ink pb-[6px]">
          <h2 id="documents-expiring" className="m-0 text-[17px] font-semibold">
            Expiring or expired
          </h2>
          <span className="font-mono text-[10.5px] text-n600">
            an expired document does not fail a check — it makes it unassessable
          </span>
        </div>
        {documents.length === 0 ? (
          <div className="mt-[18px] max-w-[640px]">
            <EmptyState
              where="DOCUMENTS · NONE"
              title="No documents yet"
              body="Specifications, certificates and registrations appear here once they are uploaded or a supplier sends them, each with its expiry date."
              aside={markets.length === 0 ? "No product is on a market yet, so no market states its documents." : undefined}
            />
          </div>
        ) : (
          <ul aria-label="Documents" className="m-0 p-0 list-none flex flex-col">
            {documents.map((d) => (
              <DocumentLine key={d.id} doc={d} today={today} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Market({ market }: { market: MarketCard }) {
  if (market.kind === "not_encoded") {
    return (
      <li data-market={market.nodeId} data-market-state="not_encoded" className="border border-rule border-t-[3px] border-t-na py-[15px] px-[16px]">
        <div className="flex items-baseline gap-[8px]">
          <span className="flex-1 text-[17px] font-semibold">{market.name}</span>
          <span className="inline-flex items-center gap-[6px] font-mono text-[10.5px] tracking-[0.06em] uppercase text-na">
            <StateGlyph state="not_assessed" size="sm" />
            {STATE_LABEL.not_assessed}
          </span>
        </div>
        <p className="mt-[10px] mb-0 text-[12.5px] leading-[1.5] text-n700">
          No document requirements are encoded for this market yet, so its completeness is not stated.
        </p>
        <p className="mt-[8px] mb-0 font-mono text-[10px] tracking-[0.06em] text-n600">No count until requirements are accepted</p>
      </li>
    );
  }
  const complete = market.total > 0 && market.met === market.total && market.notAssessed === 0;
  const tone = complete ? "text-clear" : "text-action";
  const bar = complete ? "border-t-clear" : "border-t-action";
  return (
    <li data-market={market.nodeId} data-market-state="assessed" className={cx("border border-rule border-t-[3px] py-[15px] px-[16px]", bar)}>
      <div className="flex items-baseline gap-[8px]">
        <span className="flex-1 text-[17px] font-semibold">{market.name}</span>
        <span data-testid="market-ratio" className={cx("font-mono text-[11px]", tone)}>
          {market.met} / {market.total}
        </span>
      </div>
      <div aria-hidden="true" className="mt-[10px] flex gap-[2px]">
        {Array.from({ length: market.total }, (_, i) => (
          <span key={i} className={cx("flex-1 h-[7px]", i < market.met ? "bg-clear" : "bg-n200")} />
        ))}
      </div>
      <p className="mt-[10px] mb-0 text-[12.5px] leading-[1.5] text-n700">
        {market.outstanding.length === 0
          ? "Every encoded requirement has a current document."
          : `Missing or not current: ${market.outstanding.join(", ")}.`}
        {market.notAssessed > 0 ? ` ${plural(market.notAssessed, "requirement")} for another product class not assessed.` : ""}
      </p>
      <p className={cx("mt-[8px] mb-0 font-mono text-[10px] tracking-[0.06em]", tone)}>
        {market.outstanding.length === 0 ? "No document outstanding" : `${plural(market.outstanding.length, "document")} outstanding`}
      </p>
    </li>
  );
}

function DocumentLine({ doc, today }: { doc: LibraryDocument; today: string }) {
  const e = doc.expiry;
  const status = "on" in e ? (e.kind === "current" ? `${TODAY_LABEL.current} · ${formatDay(e.on, today)}` : `${TODAY_LABEL[e.kind]} ${formatDay(e.on, today)}`) : TODAY_LABEL[e.kind];
  return (
    <li
      data-document={doc.id}
      data-expiry={e.kind}
      data-scan={doc.scanStatus}
      className="grid grid-cols-1 md:grid-cols-[1fr_190px_170px] gap-x-[14px] gap-y-[4px] border-b border-rule py-[11px] px-[2px] items-baseline"
    >
      <span className="min-w-0">
        <span className="block text-[13.5px] font-medium break-words">{doc.title}</span>
        <span className="block mt-[2px] font-mono text-[10px] text-n600">
          {doc.typeLabel}
          {SCAN_LABEL[doc.scanStatus] ? ` · ${SCAN_LABEL[doc.scanStatus]}` : ""}
        </span>
      </span>
      <span className="text-[12.5px] text-n700">{doc.supplier ?? "Own document"}</span>
      <span className={cx("font-mono text-[11px]", EXPIRY_TONE[e.kind])}>
        {"on" in e ? <time dateTime={e.on}>{status}</time> : status}
      </span>
    </li>
  );
}
