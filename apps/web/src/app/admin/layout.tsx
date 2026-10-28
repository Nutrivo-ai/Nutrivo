import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { LoadingState, NoPermissionState } from "@/components/kit";
import { Wordmark } from "@/components/shell";
import { AdminNav } from "@/components/admin/AdminNav";
import { signInHref } from "@/lib/auth/rules";
import { staffGate } from "@/lib/admin/server";
import { ADMIN_MFA } from "@/lib/admin/staff";

// T-205: /admin is staff only (docs/09). The signed-in person's app_metadata.nutrivo_staff is checked here, on the
// server, before any admin page renders or reads; the pages read through staffReader(), which checks it again. A
// person proves a second factor first, and one without a factor enrols (aal2 for staff, #35 Q6). The check reads the session at request
// time, so it renders inside a Suspense boundary (cacheComponents); nothing of the console is in the static shell.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <main className="py-[40px] px-[16px] md:px-[30px]">
          <LoadingState label="LOADING · ADMIN">Checking your access.</LoadingState>
        </main>
      }
    >
      <StaffOnly>{children}</StaffOnly>
    </Suspense>
  );
}

async function StaffOnly({ children }: { children: ReactNode }) {
  const gate = await staffGate();
  if (gate.kind === "signed-out") redirect(signInHref("/admin"));
  if (gate.kind === "not-staff") {
    return (
      <div className="min-h-screen bg-panel text-ink">
        <div className="flex items-center gap-[18px] py-[16px] px-[16px] md:px-[30px] bg-paper border-b border-rule">
          <Wordmark />
          <span className="font-mono text-[10px] tracking-[0.1em] uppercase text-n600">Content operations</span>
        </div>
        <main className="max-w-[560px] mx-auto py-[40px] px-[16px]">
          <h1 className="sr-only">Staff only</h1>
          <NoPermissionState
            where="NO ACCESS · ADMIN"
            title="This console is for Nutrivo staff"
            body="Content operations (rule acceptance, terms, coverage and releases) are open to Nutrivo staff only."
            aside="Your workspaces are unchanged and still open to you."
          />
        </main>
      </div>
    );
  }
  if (gate.kind === "step-up") redirect(ADMIN_MFA);
  return (
    <div className="min-h-screen md:flex bg-paper text-ink">
      <AdminNav />
      <div className="flex-1 min-w-0 flex flex-col">{children}</div>
    </div>
  );
}
