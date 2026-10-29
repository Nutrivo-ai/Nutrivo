"use client";

import { ErrorState } from "@/components/kit";

// When /onboarding cannot read the person, their workspaces or the regions. Nothing was created by reading.
export default function OnboardingError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="min-h-screen bg-panel pt-[34px] px-[16px] md:px-[32px]">
      <main className="max-w-[1040px] mx-auto">
        <ErrorState
          where="ONBOARDING"
          title="This step could not be read just now"
          body="Nothing you entered was lost: an account or a workspace that was created is still there. Try again in a moment."
          action={{ label: "Try again", onClick: () => retry(), variant: "primary" }}
        />
      </main>
    </div>
  );
}
