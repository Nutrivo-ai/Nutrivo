import { cx, DataTable, EmptyState, SectionHeading, type Column } from "@/components/kit";
import { REQUEST_STATE_LABEL, type RequestState, type SupplierRow, type SupplierScreen } from "@/lib/suppliers/requests";
import { RequestForm } from "./RequestForm";

// S-NV2-014 Suppliers (design: product/Nutrivo 2.0.dc.html, screen "suppliers"). H02 (T-802): the suppliers table on
// the left and, on the right, the request the design drafts ("Spec request · draft"), sent through the supplier portal.
// Columns the design draws without a source (materials, specs current, portal) are left out (#69 question 2).

const STATE_TONE: Record<RequestState, string> = {
  sending: "text-n600",
  email_failed: "text-blocked",
  sent: "text-action",
  expired: "text-na",
  scanning: "text-action",
  received: "text-clear",
  rejected: "text-blocked",
};

const columns: Column<SupplierRow>[] = [
  {
    key: "supplier",
    header: "Supplier",
    width: "40%",
    cell: (s) => (
      <span>
        <span className="block text-[13.5px] font-medium">{s.name}</span>
        <span className="block mt-[2px] font-mono text-[10px] text-n600 break-all">{s.email ?? "No address"}</span>
      </span>
    ),
  },
  {
    key: "received",
    header: "Documents received",
    align: "center",
    width: "20%",
    cell: (s) => (
      <span className={cx("font-mono text-[11px]", s.requested > 0 && s.received === s.requested ? "text-clear" : "text-n700")}>
        {s.received} / {s.requested}
      </span>
    ),
  },
  {
    key: "request",
    header: "Latest request",
    align: "right",
    cell: (s) =>
      s.latest ? (
        <span>
          <span className="block text-[12.5px] text-n700 break-words">{s.latest.title}</span>
          <span
            data-request-state={s.latest.state}
            className={cx("block mt-[2px] font-mono text-[10px] tracking-[0.06em] uppercase", STATE_TONE[s.latest.state])}
          >
            {REQUEST_STATE_LABEL[s.latest.state]}
          </span>
        </span>
      ) : (
        <span className="font-mono text-[10px] text-n500">—</span>
      ),
  },
];

export function Suppliers({
  screen,
  workspaceId,
  canRequest,
}: {
  screen: SupplierScreen;
  workspaceId: string;
  canRequest: boolean;
}) {
  const n = screen.suppliers.length;
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-[22px] items-start">
      <section data-testid="suppliers-table" aria-label="Suppliers">
        <SectionHeading note={`${n} · ${screen.openRequests} with outstanding requests`}>Suppliers</SectionHeading>
        <DataTable
          caption="Suppliers and their document requests"
          columns={columns}
          rows={screen.suppliers}
          rowKey={(s) => s.id}
          empty={
            <EmptyState
              where="SUPPLIERS · NONE"
              title="No suppliers added"
              body="A supplier is a name and an email, not an account. Add one and you can ask for documents by link."
              aside={canRequest ? "Add one with the request on the right." : "An editor adds suppliers by asking them for a document."}
            />
          }
        />
      </section>
      <RequestForm
        workspaceId={workspaceId}
        suppliers={screen.suppliers.map((s) => ({ id: s.id, name: s.name, hasEmail: s.email !== null }))}
        docTypes={screen.docTypes}
        products={screen.products}
        canRequest={canRequest}
      />
    </div>
  );
}
