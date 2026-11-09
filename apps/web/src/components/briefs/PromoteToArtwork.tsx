"use client";

// T-1003 · E04 Promote a brief to artwork, on Brief & formula (S-NV2-004). The design has no control for it; the
// placement and wording are the default proposed on #78 (Q1): an outline button under the intended claims, the screen's
// next step. Step 1 is C04's app.set_product_stage to in_development, step 2 is Upload & scope (D01) for the same
// product. A stage change is reversible (C04), so there is no confirmation. Shown only at stage brief; the route is
// editor-only, so a viewer never reaches it, and an editor the database refuses (42501) reads why.
import { useState, useTransition } from "react";
import { Button } from "@/components/kit";
import { promoteBrief, type BriefRefusal } from "@/lib/briefs/actions";

export const PROMOTE_REFUSAL: Record<BriefRefusal, string> = {
  "no-permission": "Your role cannot change this product's stage. An editor whose scope holds its markets, or an admin, can.",
  invalid: "The stage could not be changed: this product was not found. Reload the page.",
  error: "The stage was not changed. Try again, and if it fails twice, tell us.",
};

export const PROMOTE_NOTE =
  "The stage becomes In development and you go to Upload & scope for this product. You can change the stage back later.";

export function PromoteToArtwork({ workspaceId, productId }: { workspaceId: string; productId: string }) {
  const [refusal, setRefusal] = useState<BriefRefusal | null>(null);
  const [pending, start] = useTransition();
  const promote = () =>
    start(async () => {
      setRefusal(null);
      const result = await promoteBrief(workspaceId, productId);
      if (result && !result.ok) setRefusal(result.reason);
    });
  return (
    <div className="mt-[14px]" data-promote>
      <Button size="md" className="w-full" onClick={promote} disabled={pending} aria-describedby="promote-note">
        {pending ? "Promoting…" : "Promote to artwork"}
      </Button>
      <p id="promote-note" className="mt-[9px] mb-0 text-[12px] leading-[1.5] text-n600">
        {PROMOTE_NOTE}
      </p>
      {refusal ? (
        <p role="alert" className="mt-[8px] mb-0 text-[12.5px] font-medium text-ink" data-promote-refused={refusal}>
          {PROMOTE_REFUSAL[refusal]}
        </p>
      ) : null}
    </div>
  );
}
