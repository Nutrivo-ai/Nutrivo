"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { AuthPage } from "@/components/auth/AuthCard";
import { ErrorState } from "@/components/kit";

// When /invite/<token> cannot be shown. Nothing was accepted or created by reading it.
export default function InviteError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <AuthPage>
      <ErrorState
        where="ERROR · INVITATION"
        title="This invitation could not be shown"
        body="Nothing was accepted or created. Try again in a moment; the link in your email still works until it lapses."
        action={{ label: "Try again", variant: "primary", onClick: () => retry() }}
      />
    </AuthPage>
  );
}
