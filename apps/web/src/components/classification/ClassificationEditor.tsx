"use client";

import posthog from "posthog-js";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/kit";
import { confirmClassification, type ConfirmRefusal } from "@/lib/classification/actions";
import { FIELD_LABEL, FIELDS, valueLabel, type Field } from "@/lib/classification/describe";
import { VOCABULARY } from "@/lib/classification/vocabulary";

const REFUSAL: Record<ConfirmRefusal, string> = {
  "no-permission": "Your role cannot confirm a classification. An editor or an admin can.",
  stale: "The classification changed since this page was opened. Reload to see the latest, then confirm again.",
  invalid: "One of the values is not a recorded value. Nothing was saved.",
  error: "The classification was not saved. Nothing was changed; try again.",
};

/**
 * D03 step 2: a person confirms or edits (T-402). The design's "Challenge this determination" opens it; until a person
 * has confirmed, the same button reads "Confirm or correct these values". Every save is a new row through
 * app.confirm_classification; a value is chosen from the recorded vocabulary or left Not determined, never typed.
 */
export function ClassificationEditor({
  productId,
  basisId,
  current,
  confirmed,
}: {
  productId: string;
  basisId: string | null;
  current: Record<Field, string | null>;
  confirmed: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<Field, string>>(() =>
    Object.fromEntries(FIELDS.map((f) => [f, current[f] ?? ""])) as Record<Field, string>,
  );
  const [refusal, setRefusal] = useState<ConfirmRefusal | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-[14px] w-full border border-accent-700 bg-transparent p-[9px] font-mono text-[10.5px] tracking-[0.08em] uppercase text-accent-700 cursor-pointer hover:bg-accent-200"
      >
        {confirmed ? "Challenge this determination" : "Confirm or correct these values"}
      </button>
    );
  }

  const submit = () =>
    start(async () => {
      setRefusal(null);
      const result = await confirmClassification(
        productId,
        basisId,
        Object.fromEntries(FIELDS.map((f) => [f, values[f] || null])),
      );
      if (!result.ok) {
        setRefusal(result.reason);
        return;
      }
      posthog.capture("classification_confirmed", { edited: FIELDS.filter((f) => (values[f] || null) !== current[f]).length });
      setOpen(false);
      router.refresh();
    });

  return (
    <form
      className="mt-[14px] border-t border-ink pt-[12px]"
      aria-label="Confirm the classification"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-col gap-[10px]">
        {FIELDS.map((f) => (
          <label key={f} className="flex flex-col gap-[3px]">
            <span className="font-mono text-[10px] tracking-[0.08em] uppercase text-n700">{FIELD_LABEL[f]}</span>
            {VOCABULARY[f].length ? (
              <select
                name={f}
                value={values[f]}
                disabled={pending}
                onChange={(e) => setValues({ ...values, [f]: e.target.value })}
                className="border border-rule rounded-control bg-paper px-[8px] py-[6px] text-[13.5px]"
              >
                <option value="">Not determined</option>
                {VOCABULARY[f].map((v) => (
                  <option key={v} value={v}>
                    {valueLabel(v)}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-[13px] text-n700">No recorded values yet: stays Not determined</span>
            )}
          </label>
        ))}
      </div>
      {refusal ? (
        <p role="alert" className="mt-[10px] mb-0 text-[12.5px] leading-[1.45] text-blocked">
          {REFUSAL[refusal]}
        </p>
      ) : null}
      <div className="mt-[12px] flex gap-[8px]">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Confirm"}
        </Button>
        <Button type="button" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <p className="mt-[9px] mb-0 text-[12px] leading-[1.45] text-accent-700">
        Confirming starts a new check scope: the next check uses these values, and earlier results are not reused.
      </p>
    </form>
  );
}
