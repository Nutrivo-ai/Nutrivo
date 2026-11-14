"use client";

// T-1002 · E02 "Screen this brief" (design S-NV2-004, under "What we can answer with this"): asks for the brief's
// compliance envelope through app.request_envelope and opens Design envelope (S-NV2-005), which follows the job. The
// same inputs return the same job, so screening twice is the cached envelope. Refusals are read, never hidden.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/kit";
import { requestEnvelope, type EnvelopeRequest } from "@/lib/briefs/actions";

type Refusal = Extract<EnvelopeRequest, { ok: false }>["reason"];

export const ENVELOPE_REFUSAL: Record<Refusal, string> = {
  "no-permission": "Your role cannot screen this brief. An editor whose scope holds its markets, or an admin, can.",
  invalid: "This brief was not found. Reload the page.",
  "no-ruleset": "No ruleset has been released yet, so there is nothing to screen against.",
  "no-markets": "This brief has no markets yet. Add a market, then screen it.",
  error: "The brief was not screened. Try again, and if it fails twice, tell us.",
  "rate-limited": "Too many requests; try again in a few minutes. Nothing was screened.",
};

export const SCREEN_NOTE =
  "Returns a design envelope, not a verdict: what you may use, up to what level, in which markets, with the wording to carry it.";

export function ScreenThisBrief({
  workspaceId,
  productId,
  label = "Screen this brief",
  note = true,
}: {
  workspaceId: string;
  productId: string;
  label?: string;
  note?: boolean;
}) {
  const router = useRouter();
  const [refusal, setRefusal] = useState<{ reason: Refusal; message?: string } | null>(null);
  const [pending, start] = useTransition();
  const screen = () =>
    start(async () => {
      setRefusal(null);
      const result = await requestEnvelope(workspaceId, productId);
      if (!result.ok) {
        setRefusal({ reason: result.reason, message: result.message });
        return;
      }
      router.push(`/w/${workspaceId}/briefs/${productId}/envelope`);
      router.refresh();
    });
  return (
    <div className="mt-[14px]" data-screen-brief>
      <Button variant="primary" size="md" className="w-full" onClick={screen} disabled={pending} aria-describedby={note ? "screen-note" : undefined}>
        {pending ? "Screening…" : label}
      </Button>
      {note ? (
        <p id="screen-note" className="mt-[9px] mb-0 text-[12px] leading-[1.5] text-n600">
          {SCREEN_NOTE}
        </p>
      ) : null}
      {refusal ? (
        <p role="alert" className="mt-[8px] mb-0 text-[12.5px] font-medium text-ink" data-screen-refused={refusal.reason}>
          {refusal.message ?? ENVELOPE_REFUSAL[refusal.reason]}
        </p>
      ) : null}
    </div>
  );
}
