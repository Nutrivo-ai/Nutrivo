import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthPage } from "@/components/auth/AuthCard";
import { ForgotForm } from "@/components/auth/forms";

export const metadata: Metadata = { title: "Forgotten password · Nutrivo" };

// S-REC-001 (A07), and the page every expired or used email link lands on (A07.fail.1).
export default function ForgotPage() {
  return (
    <AuthPage>
      <Suspense>
        <ForgotForm />
      </Suspense>
    </AuthPage>
  );
}
