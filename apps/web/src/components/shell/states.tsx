"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { ErrorState, LoadingState } from "@/components/kit";

/** A workspace route while its reads are under way (loading.tsx). Neutral and mono, never the accent. */
export function ShellLoading() {
  return (
    <main className="flex-1 min-w-0 pt-[24px] px-[16px] md:px-[26px] pb-[48px]">
      <div className="max-w-[640px]">
        <LoadingState label="LOADING · WORKSPACE">Reading this workspace.</LoadingState>
      </div>
    </main>
  );
}

/**
 * A workspace route whose reads failed (error.tsx). It says what did not happen, keeps nothing hidden behind a
 * spinner, reports to Sentry, and offers the one action that can help: reading again.
 */
export function ShellError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  const digest = error instanceof Error && "digest" in error ? String(error.digest) : null;
  return (
    <main className="flex-1 min-w-0 pt-[24px] px-[16px] md:px-[26px] pb-[48px]">
      <div className="max-w-[640px]">
        <ErrorState
          where={digest ? `ERROR · ${digest}` : "ERROR · WORKSPACE"}
          title="This page could not be read"
          body={
            "The workspace's data did not load, and nothing was changed." +
            (digest ? " If reading it again fails too, the reference above identifies this failure." : "")
          }
          action={{ label: "Read it again", variant: "primary", onClick: () => retry() }}
        />
      </div>
    </main>
  );
}
