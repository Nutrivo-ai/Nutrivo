import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthPage } from "@/components/auth/AuthCard";
import { SignInForm } from "@/components/auth/forms";

export const metadata: Metadata = { title: "Sign in · Nutrivo" };

// A02.main. Sign-in has no frame of its own: the S-NV2-033 fields in the Account Recovery card (question 1, #25).
export default function SignInPage() {
  return (
    <AuthPage>
      <Suspense>
        <SignInForm />
      </Suspense>
    </AuthPage>
  );
}
