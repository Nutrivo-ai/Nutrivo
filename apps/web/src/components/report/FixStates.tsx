"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/kit";
import { Screen } from "@/components/shell";

const ROUTE = "/w/[workspace]/products/[product]/report";

// S-FIX-010 Loading and S-FIX-011 Error (design: product/Nutrivo Fix Mode - Loading / - Error .dc.html), page content
// inside the built rail. Neutral greys, never the accent and never a state colour.

export function FixLoading() {
  return (
    <main id="main" className="flex-1 min-w-0 pt-[24px] px-[16px] md:px-[26px] pb-[48px]" data-fix-state="loading">
      <div aria-busy="true" className="flex gap-[24px]">
        <div className="hidden md:block flex-[1_1_680px] h-[640px] rounded-control bg-panel" />
        <div className="flex-[1_1_520px] max-w-[600px] flex flex-col gap-[12px]">
          <div className="h-[24px] w-[70%] rounded-control bg-panel" />
          <div className="h-[150px] rounded-control bg-panel" />
          <div className="h-[150px] rounded-control bg-panel" />
          <span role="status" className="text-[14px] text-n700">
            Loading the label report…
          </span>
        </div>
      </div>
    </main>
  );
}

/** The read failed. Nothing about the result changed; the request id is this response's own (docs/17). */
export function FixError({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Screen route={ROUTE}>
      <div role="alert" data-fix-state="error" className="border border-rule rounded-control p-[24px] md:p-[40px] bg-panel flex flex-col gap-[12px] max-w-[640px]">
        <h2 className="m-0 text-[20px] font-semibold">The label report didn’t load</h2>
        <p className="m-0 text-[15px] leading-[1.5] text-n700">Nothing has changed in this result. This page couldn’t reach it.</p>
        <div>
          <Button variant="primary" size="md" disabled={pending} onClick={() => start(() => router.refresh())}>
            Try again
          </Button>
        </div>
        <span data-request-id className="font-mono text-[12px] text-n700">
          Request id · {requestId}
        </span>
      </div>
    </Screen>
  );
}
