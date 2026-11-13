import type { ReactNode } from "react";
import Link from "next/link";
import { cx } from "@/components/kit";
import { Wordmark } from "@/components/shell/Wordmark";
import type { DescribeOutcome } from "@/lib/public/supplier";
import { UploadBox } from "./UploadBox";

// S-NV2-028 Supplier portal (design: product/Nutrivo 2.0.dc.html, screen "supp"). H03 (T-802): the supplier's own view,
// reached by a scoped link, with no account and no rail. One link opens one request (H03.must.1), so the design's
// several items, "Upload once, reaches many" and "Replace a document that has expired" are left out (#69 question 1);
// the card, the drop area and "What this link can do" follow the design.

const mono = "font-mono uppercase";
const DAY = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" });

export function SupplierPage({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-paper text-ink text-[14px]">
      <header className="flex items-end justify-between gap-[20px] border-b border-ink bg-paper py-[14px] px-[16px] md:px-[26px]">
        <div>
          <p className={cx(mono, "m-0 text-[10px] tracking-[0.14em] text-accent")}>Supplier portal · no account</p>
          <h1 className="mt-[4px] mb-0 text-[22px] font-semibold leading-[1.1] tracking-[-0.02em]">Upload a requested document</h1>
        </div>
        <Link href="/" aria-label="Nutrivo home" className="focus-visible:outline-2 focus-visible:outline-accent">
          <Wordmark size="header" />
        </Link>
      </header>
      <main id="main" className="flex-1 py-[24px] px-[16px] md:px-[26px]">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(240px,320px)] gap-[22px] items-start">
          <div>
            <p className="mt-0 mb-[14px] text-[13px] leading-[1.55] text-n600 max-w-[76ch]">
              The supplier&apos;s own view, reached by a scoped link. No account, no password, no seat: a supplier is never
              priced as a user of ours.
            </p>
            <div className="border border-ink bg-panel py-[26px] px-[12px] md:px-[30px]">{children}</div>
          </div>
          <aside className="border border-rule py-[16px] px-[18px] bg-panel" aria-label="What this link can do">
            <p className={cx(mono, "m-0 text-[10px] tracking-[0.13em] text-n600")}>What this link can do</p>
            <ul className="mt-[10px] mb-0 pl-[16px] text-[12.5px] leading-[1.65] text-n700">
              <li>Upload the requested document, once</li>
              <li>Show what is asked and until when</li>
            </ul>
            <p className="mt-[10px] mb-0 text-[12.5px] leading-[1.55] text-n700">
              It cannot see the customer&apos;s products, checks, findings or any other supplier.
            </p>
          </aside>
        </div>
      </main>
    </div>
  );
}

export function SupplierRequest({ token, outcome }: { token: string; outcome: DescribeOutcome }) {
  if (outcome.kind !== "open") {
    const unavailable = outcome.kind === "unavailable";
    return (
      <div role="alert" data-testid="supplier-unavailable" className="bg-paper border border-ink border-t-[3px] border-t-na py-[22px] px-[18px] md:px-[26px]">
        <p className={cx(mono, "m-0 text-[10px] tracking-[0.13em] text-na")}>{unavailable ? "Link not open" : "Not answered"}</p>
        <h2 className="mt-[7px] mb-0 text-[20px] font-semibold leading-[1.2]">
          {unavailable ? "This link is no longer open." : "We could not open this link just now."}
        </h2>
        <p className="mt-[8px] mb-0 text-[13px] leading-[1.55] text-n700">
          {unavailable
            ? "Links work for one upload and for a limited time. If you still need to send the document, ask the customer who sent you the link for a new one."
            : "Nothing was uploaded. Try again in a moment."}
        </p>
      </div>
    );
  }
  const r = outcome.request;
  return (
    <section aria-label="Document request" data-testid="supplier-request" className="bg-paper border border-ink py-[24px] px-[18px] md:px-[26px]">
      <div className="flex flex-wrap items-baseline gap-x-[12px] gap-y-[4px] border-b border-ink pb-[10px]">
        <h2 className="m-0 font-head text-[19px] font-semibold">Document request from {r.workspaceName}</h2>
        <span className="flex-1" />
        <span className="font-mono text-[10px] tracking-[0.06em] text-n600">
          LINK EXPIRES <time dateTime={r.expiresAt}>{DAY.format(new Date(r.expiresAt))}</time>
        </span>
      </div>
      <p className="mt-[12px] mb-0 text-[13.5px] leading-[1.55] text-n700 max-w-[70ch]">
        {r.workspaceName} needs one document{r.supplierName ? ` from ${r.supplierName}` : ""}. Upload it once here; the link
        then closes.
      </p>
      <UploadBox token={token} title={r.title} />
    </section>
  );
}

/** Loading: neutral, in the place the request will take. */
export function SupplierLoading() {
  return (
    <div data-testid="supplier-loading" role="status" className="bg-paper border border-ink border-t-[3px] border-t-n400 py-[22px] px-[18px] md:px-[26px]">
      <p className={cx(mono, "m-0 text-[10px] tracking-[0.13em] text-n600")}>Opening</p>
      <p className="mt-[7px] mb-0 text-[13px] leading-[1.55] text-n700">Opening the request.</p>
    </div>
  );
}
