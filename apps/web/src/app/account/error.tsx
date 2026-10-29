"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { ErrorState } from "@/components/kit";

// When /account cannot read the person, their factors or their workspaces. Reading changes nothing.
export default function AccountError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <div className="min-h-screen bg-panel pt-[26px] px-[16px] md:px-[28px]">
      <main className="max-w-[640px]">
        <ErrorState
          where="ERROR · YOUR ACCOUNT"
          title="Your account could not be read"
          body="Nothing was changed. Read it again; if that fails too, sign out and back in."
          action={{ label: "Read it again", variant: "primary", onClick: () => retry() }}
        />
      </main>
    </div>
  );
}
