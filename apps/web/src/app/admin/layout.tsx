import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { NoPermissionState } from "@/components/kit";
import { Wordmark } from "@/components/shell";
import { AdminNav } from "@/components/admin/AdminNav";
import { sessionGate } from "@/lib/auth/session";
import { signInHref } from "@/lib/auth/rules";
import { staffGate } from "@/lib/admin/server";
import { createClient } from "@/lib/supabase/server";

// T-205: /admin is staff only (docs/09). The signed-in person's app_metadata.nutrivo_staff is checked here, on the
// server, before any admin page renders or reads; the pages read through staffReader(), which checks it again. A
// person with a second factor proves it first, as everywhere else (A02 step 4).
export default async function AdminLayout({ children }: { children: ReactNode }) {
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
  if ((await sessionGate(await createClient(), gate.user.id)) !== "ok") {
    redirect(`/auth/mfa?next=${encodeURIComponent("/admin")}`);
  }
  return (
    <div className="min-h-screen md:flex bg-paper text-ink">
      <AdminNav />
      <div className="flex-1 min-w-0 flex flex-col">{children}</div>
    </div>
  );
}
