import * as Sentry from "@sentry/nextjs";
import type { Metadata } from "next";
import { DeadlineChip, Horizon } from "@/components/alerts/Horizon";
import { Screen } from "@/components/shell";
import { readHorizon } from "@/lib/alerts/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Horizon · Nutrivo" };

// S-MIS-002 Horizon (spec/screens.yaml), J04 (T-902): the coming changes from app.alerts with their recipes, the
// sell-through deadlines, and the ref.horizon_items not yet in force. Read under RLS. A read failure goes to the
// workspace error boundary, and loading.tsx covers the wait.
export default async function Page({ params }: PageProps<"/w/[workspace]/horizon">) {
  const { workspace } = await params;
  const supabase = await createClient();
  const data = await Sentry.startSpan({ name: "horizon.read", op: "db.read" }, () => readHorizon(supabase, workspace));
  if (data.kind === "not-found") return null; // the workspace layout has already shown NoAccess
  return (
    <Screen route="/w/[workspace]/horizon" aside={<DeadlineChip deadlines={data.horizon.deadlines} />}>
      <Horizon workspaceId={workspace} horizon={data.horizon} today={data.today} />
    </Screen>
  );
}
