import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthPage } from "@/components/auth/AuthCard";
import { MfaForm } from "@/components/auth/forms";

export const metadata: Metadata = { title: "Two-step sign-in · Nutrivo" };

// A02 step 4: enrol TOTP when signing authority requires it (A02.fail.2), or prove it for aal2 (A02.must.2). No frame
// of its own is drawn; it uses the Account Recovery card (question 2, #25).
export default function MfaPage() {
  return (
    <AuthPage>
      <Suspense>
        <MfaForm />
      </Suspense>
    </AuthPage>
  );
}
