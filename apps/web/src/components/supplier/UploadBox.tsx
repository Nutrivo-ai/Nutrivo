"use client";

import { useId, useRef, useState, type DragEvent } from "react";
import { Button, cx } from "@/components/kit";
import { checkFile, uploadDocument, type UploadOutcome } from "@/lib/public/supplier";

// The one requested item and the design's drop area (S-NV2-028). The file goes straight from the browser to the
// supplier-upload function with the token in the form body (H03.must.1). Every refusal says what to do next, and an
// unavailable link reads exactly like the page's own unavailable state (H03.fail.1).

const REFUSED: Record<"too_large" | "unsupported_type" | "no_file", string> = {
  too_large: "That file is over 25 MB. Send a smaller copy of the document.",
  unsupported_type: "Only PDF, DOCX or XLSX files can be sent, and the file must be what its name says.",
  no_file: "Choose the file to send.",
};

type Phase = { kind: "idle" } | { kind: "sending" } | UploadOutcome;

export function UploadBox({ token, title }: { token: string; title: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const done = phase.kind === "received" || phase.kind === "unavailable";

  const choose = (f: File | null) => {
    setFile(f);
    const problem = f ? checkFile(f) : null;
    setPhase(problem ? { kind: "refused", reason: problem } : { kind: "idle" });
  };
  const drop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    if (!done) choose(e.dataTransfer.files[0] ?? null);
  };
  const send = async () => {
    if (!file) return setPhase({ kind: "refused", reason: "no_file" });
    setPhase({ kind: "sending" });
    setPhase(await uploadDocument(token, file));
  };

  const state = phase.kind === "received" ? "RECEIVED" : phase.kind === "unavailable" ? "CLOSED" : "OUTSTANDING";
  return (
    <div>
      <div className="mt-[18px] grid grid-cols-[18px_minmax(0,1fr)] sm:grid-cols-[18px_minmax(0,1fr)_minmax(110px,160px)_110px] gap-[10px] items-baseline border-b border-rule py-[12px]">
        <span aria-hidden="true" className={cx("inline-block w-[9px] h-[9px]", phase.kind === "received" ? "bg-clear" : "bg-action")} />
        <span>
          <span className="block text-[13.5px] break-words" data-testid="supplier-title">{title}</span>
          <span className="block mt-[2px] text-[12px] text-n600">PDF, DOCX or XLSX, up to 25 MB</span>
        </span>
        <span className="font-mono text-[10.5px] text-n600 break-all col-start-2 sm:col-start-auto">{file?.name ?? "—"}</span>
        <span
          data-testid="supplier-item-state"
          className={cx("font-mono text-[10px] tracking-[0.06em] sm:text-right col-start-2 sm:col-start-auto", phase.kind === "received" ? "text-clear" : "text-action")}
        >
          {state}
        </span>
      </div>

      {done ? null : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
          className={cx("mt-[20px] border border-dashed py-[22px] px-[16px] text-center", over ? "border-accent bg-accent-100" : "border-n400")}
        >
          <label htmlFor={`${id}-file`} className="block cursor-pointer">
            <span className="block font-mono text-[11px] tracking-[0.06em] text-n600">DROP FILES HERE · PDF, DOCX, XLSX</span>
            <span className="block mt-[6px] text-[12.5px] text-n600">or choose one from your computer</span>
          </label>
          <input
            ref={input}
            id={`${id}-file`}
            type="file"
            accept=".pdf,.docx,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => choose(e.target.files?.[0] ?? null)}
            className="mt-[10px] mx-auto block text-[12.5px] max-w-full"
            data-testid="supplier-file"
          />
          <Button
            type="button"
            variant="primary"
            size="md"
            className="mt-[14px]"
            onClick={send}
            disabled={phase.kind === "sending"}
            data-testid="supplier-send"
          >
            {phase.kind === "sending" ? "Sending…" : "Send the document"}
          </Button>
        </div>
      )}

      <p
        role={phase.kind === "received" ? "status" : phase.kind === "idle" || phase.kind === "sending" ? undefined : "alert"}
        data-testid="supplier-result"
        data-outcome={phase.kind}
        className={cx(
          "mt-[14px] mb-0 text-[13px] leading-[1.55]",
          phase.kind === "received" ? "text-clear" : phase.kind === "idle" || phase.kind === "sending" ? "text-n600" : "text-blocked",
        )}
      >
        {phase.kind === "received"
          ? "Received. The file is checked for malware and then reaches the customer. The link is now closed."
          : phase.kind === "unavailable"
            ? "This link is no longer open. Ask the customer who sent it for a new one."
            : phase.kind === "refused"
              ? REFUSED[phase.reason]
              : phase.kind === "error"
                ? "The file could not be sent just now. Nothing was received; try again."
                : "Your file is sent only when you press Send."}
      </p>
    </div>
  );
}
