import type { Metadata } from "next";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthPage } from "@/components/auth/AuthCard";
import { ResetForm } from "@/components/auth/forms";
import { EXPIRED_LINK, RESET_AFTER_MFA, minutesLeft, needsStepUp } from "@/lib/auth/rules";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Set a new password · Nutrivo" };

// S-REC-002 (A07.main). Reached through /auth/callback, which has already signed the person in with their reset link;
// without that session the link has expired or was used, and the recovery page offers a fresh one (A07.fail.1).
async function minutesOnTheLink(): Promise<number | null> {
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect(EXPIRED_LINK);
  const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (level && needsStepUp(level)) redirect(RESET_AFTER_MFA);
  return minutesLeft(data.user.recovery_sent_at, Date.now());
}

async function Reset() {
  return <ResetForm minutes={await minutesOnTheLink()} />;
}

export default function ResetPage() {
  return (
    <AuthPage>
      <Suspense>
        <Reset />
      </Suspense>
    </AuthPage>
  );
}
