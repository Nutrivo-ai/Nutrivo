"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { ErrorState } from "@/components/kit";

// When an /admin page's reads fail: nothing was changed, and reading again is the one action.
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <main className="flex-1 min-w-0 pt-[24px] px-[16px] md:px-[26px] pb-[48px]">
      <h1 className="sr-only">This page could not be read</h1>
      <div className="max-w-[640px]">
        <ErrorState
          where={error.digest ? `ERROR · ${error.digest}` : "ERROR · ADMIN"}
          title="This page could not be read"
          body="The content tables did not load, and nothing was changed."
          action={{ label: "Read it again", variant: "primary", onClick: () => reset() }}
        />
      </div>
    </main>
  );
}
