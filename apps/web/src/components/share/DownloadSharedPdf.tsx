"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/kit";
import { downloadSharedPdf } from "@/lib/public/share-actions";
import type { PdfOutcome } from "@/lib/public/share";

// Download PDF on /share/[token] (T-604): a fresh link from the `share` Edge Function on each click, valid for 300 s,
// so a page left open longer still downloads. A link revoked since the page loaded reloads into the unknown answer.

const PROBLEM: Record<Exclude<PdfOutcome["kind"], "link" | "unknown" | "rate_limited">, string> = {
  no_pdf: "The PDF of this report is not stored yet.",
  unavailable: "The PDF could not be prepared just now. Try again in a moment.",
};

export function DownloadSharedPdf({ token, hasPdf }: { token: string; hasPdf: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  if (!hasPdf) {
    return <p className="m-0 font-mono text-[10.5px] tracking-[0.04em] text-n600">PDF · NOT STORED YET</p>;
  }
  function download() {
    setProblem(null);
    start(async () => {
      const result = await downloadSharedPdf(token);
      if (result.kind === "link") return window.location.assign(result.url);
      if (result.kind === "unknown") return router.refresh();
      if (result.kind === "rate_limited") return setProblem(`Too many requests. Try again in ${result.retryAfter} seconds.`);
      setProblem(PROBLEM[result.kind]);
    });
  }
  return (
    <div>
      <Button variant="primary" onClick={download} disabled={pending}>
        {pending ? "Preparing…" : "Download PDF"}
      </Button>
      <p role={problem ? "alert" : undefined} className={problem ? "mt-[8px] mb-0 text-[12px] leading-[1.45] text-blocked" : "hidden"}>
        {problem}
      </p>
    </div>
  );
}
