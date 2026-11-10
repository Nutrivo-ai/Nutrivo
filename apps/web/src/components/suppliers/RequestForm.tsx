"use client";

import { useActionState, useId, useState } from "react";
import { Blueprint, Button, cx } from "@/components/kit";
import { requestDocument, type RequestFormState } from "@/lib/suppliers/actions";

// The design's "Spec request · draft" panel (S-NV2-014) as the form behind "Send through the supplier portal". H02:
// one request names one supplier, one document type encoded in ref.document_requirements and, optionally, one product;
// the title is what the supplier reads. A viewer sees why they cannot send, never a dead button (docs/20).

const INPUT =
  "w-full box-border border border-n400 py-[9px] px-[11px] text-[13px] bg-paper text-ink rounded-none " +
  "placeholder:text-n500 focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2 disabled:bg-panel disabled:text-n700";
const LABEL = "block font-mono text-[10px] tracking-[0.08em] uppercase text-n600 mb-[4px]";

export function RequestForm({
  workspaceId,
  suppliers,
  docTypes,
  products,
  canRequest,
}: {
  workspaceId: string;
  suppliers: { id: string; name: string; hasEmail: boolean }[];
  docTypes: string[];
  products: { id: string; name: string }[];
  canRequest: boolean;
}) {
  const [state, action, pending] = useActionState<RequestFormState, FormData>(requestDocument, { status: "idle" });
  const [supplier, setSupplier] = useState(suppliers[0]?.id ?? "new");
  const id = useId();
  const chosen = suppliers.find((s) => s.id === supplier);
  const needsName = supplier === "new";
  const needsEmail = needsName || (chosen !== undefined && !chosen.hasEmail);
  const blocked = !canRequest ? "Only an editor can ask a supplier for a document." : docTypes.length === 0
    ? "No document type is encoded yet, so nothing can be requested. Requests open once document requirements are accepted."
    : null;

  return (
    <Blueprint as="section" className="p-[18px]">
      <form action={action} aria-label="Request a document" data-testid="request-form">
        <input type="hidden" name="workspace" value={workspaceId} />
        <p className="m-0 font-mono text-[10px] tracking-[0.12em] uppercase text-accent">Spec request · draft</p>
        <h2 className="mt-[7px] mb-0 font-head text-[19px] font-semibold leading-[1.2]">Ask a supplier for a document</h2>
        <fieldset disabled={blocked !== null || pending} className="m-0 mt-[14px] p-0 border-0 flex flex-col gap-[12px]">
          <legend className="sr-only">The request</legend>
          <div>
            <label htmlFor={`${id}-supplier`} className={LABEL}>Supplier</label>
            <select id={`${id}-supplier`} name="supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} className={INPUT}>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
              <option value="new">A new supplier…</option>
            </select>
          </div>
          {needsName ? (
            <div>
              <label htmlFor={`${id}-name`} className={LABEL}>Supplier name</label>
              <input id={`${id}-name`} name="supplier_name" required maxLength={200} autoComplete="organization" className={INPUT} />
            </div>
          ) : null}
          {needsEmail ? (
            <div>
              <label htmlFor={`${id}-email`} className={LABEL}>Supplier email</label>
              <input id={`${id}-email`} name="supplier_email" type="email" required maxLength={254} autoComplete="email" className={INPUT} />
            </div>
          ) : null}
          <div>
            <label htmlFor={`${id}-title`} className={LABEL}>What you need</label>
            <input
              id={`${id}-title`}
              name="title"
              required
              maxLength={200}
              placeholder="Current premix specification for PMX-118"
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor={`${id}-type`} className={LABEL}>Document type</label>
            <select id={`${id}-type`} name="doc_type" required className={INPUT} defaultValue={docTypes[0] ?? ""}>
              {docTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-product`} className={LABEL}>For product</label>
            <select id={`${id}-product`} name="product" className={INPUT} defaultValue="">
              <option value="">Every product (a workspace document)</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </fieldset>
        <Button type="submit" variant="primary" size="md" className="mt-[15px] w-full" disabled={blocked !== null || pending} aria-describedby={`${id}-note`}>
          {pending ? "Sending…" : "Send through the supplier portal"}
        </Button>
        <p id={`${id}-note`} className="mt-[9px] mb-0 text-[12px] leading-[1.5] text-n700">
          {blocked ??
            "The supplier gets a link by email: one upload, no account, valid for 14 days. The file is scanned before it reaches your documents."}
        </p>
        <p
          role={state.status === "problem" ? "alert" : "status"}
          data-testid="request-result"
          className={cx("mt-[9px] mb-0 text-[12.5px] leading-[1.5]", state.status === "problem" ? "text-blocked" : "text-clear")}
        >
          {state.status === "sent" ? `Request sent. ${state.supplier} will get the link by email.` : state.status === "problem" ? state.problem : ""}
        </p>
      </form>
    </Blueprint>
  );
}
