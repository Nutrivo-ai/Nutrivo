"use client";

import posthog from "posthog-js";
import { useActionState, useEffect, useId } from "react";
import { Button, cx } from "@/components/kit";
import { typeLabel } from "@/lib/documents/library";
import { recordRegistration, type RecordFormState } from "@/lib/registration/actions";
import { RECORD_REFUSAL } from "@/lib/registration/model";
import type { EvidenceDocument } from "@/lib/registration/queries";

const LABEL = "block mb-[5px] font-mono text-[10px] tracking-[0.13em] uppercase text-n600";
const INPUT =
  "w-full box-border py-[8px] px-[10px] border border-n400 bg-paper text-[13px] text-ink font-head " +
  "focus:outline-2 focus:outline-accent focus:outline-offset-2";

/**
 * G03: record a registration the operator holds, through app.record_registration (a new row each time; the latest
 * wins). The database recomputes registration_state and the page is revalidated. Recording is all this form does:
 * nothing is sent to an authority (G02.must.1).
 */
export function RecordRegistration({
  workspaceId,
  productId,
  nodeId,
  documents,
  hasLatest,
}: {
  workspaceId: string;
  productId: string;
  nodeId: string;
  documents: EvidenceDocument[];
  hasLatest: boolean;
}) {
  const [state, action, pending] = useActionState<RecordFormState, FormData>(recordRegistration, { status: "idle" });
  const id = useId();
  useEffect(() => {
    if (state.status === "recorded") posthog.capture("registration_recorded", { node: nodeId });
  }, [state, nodeId]);
  return (
    <form action={action} aria-label="Record a registration" className="mt-[14px] border-t border-rule pt-[12px] flex flex-col gap-[10px]" data-record-form>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="nodeId" value={nodeId} />
      <p className="m-0 text-[13px] font-semibold">{hasLatest ? "Record a correction or a renewal" : "Record a registration"}</p>
      <div>
        <label htmlFor={`${id}-number`} className={LABEL}>Registration number</label>
        <input id={`${id}-number`} name="number" required maxLength={200} autoComplete="off" className={INPUT} />
      </div>
      <div className="grid grid-cols-2 gap-[10px]">
        <div>
          <label htmlFor={`${id}-on`} className={LABEL}>Registered on</label>
          <input id={`${id}-on`} name="registeredOn" type="date" required className={INPUT} />
        </div>
        <div>
          <label htmlFor={`${id}-expires`} className={LABEL}>Expires (optional)</label>
          <input id={`${id}-expires`} name="expiresAt" type="date" className={INPUT} />
        </div>
      </div>
      <div>
        <label htmlFor={`${id}-doc`} className={LABEL}>Evidence document (optional)</label>
        <select id={`${id}-doc`} name="evidenceDoc" defaultValue="" className={INPUT}>
          <option value="">None cited</option>
          {documents.map((d) => (
            <option key={d.id} value={d.id}>
              {d.fileName} · {typeLabel(d.docType)}
            </option>
          ))}
        </select>
        {documents.length === 0 ? (
          <p className="mt-[5px] mb-0 text-[12px] leading-[1.45] text-n600">No clean document is in this workspace yet; one can be cited later.</p>
        ) : null}
      </div>
      <Button type="submit" variant="primary" disabled={pending} className="self-start">
        {pending ? "Recording…" : "Record registration"}
      </Button>
      {state.status === "recorded" ? (
        <p role="status" className="m-0 text-[12.5px] text-n700">Recorded, and the audit log names you. The state above is recomputed.</p>
      ) : null}
      {state.status === "refused" ? (
        <p role="alert" data-refusal={state.refusal} className={cx("m-0 text-[12.5px] leading-[1.45] text-blocked")}>
          {RECORD_REFUSAL[state.refusal]}
        </p>
      ) : null}
    </form>
  );
}
