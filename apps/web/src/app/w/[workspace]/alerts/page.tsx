import * as Sentry from "@sentry/nextjs";
import type { Metadata } from "next";
import { Inbox, UnreadChip } from "@/components/alerts/Inbox";
import { Screen } from "@/components/shell";
import { inbox, parseFilter } from "@/lib/alerts/model";
import { readAlertCards } from "@/lib/alerts/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Alerts · Nutrivo" };

// S-MIS-001 Alerts inbox at desktop widths and S-MOB-006 Alerts at phone widths (spec/screens.yaml), J04 (T-902). Read
// under RLS: app.alerts by product and market scope, the person's own app.alert_reads. ?show=in_force|coming filters;
// ?diff=<rule diff> shows one change (Horizon's "Open the recipes"). A read failure goes to the workspace error
// boundary, and loading.tsx covers the wait.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Page({ params, searchParams }: PageProps<"/w/[workspace]/alerts">) {
  const { workspace } = await params;
  const query = await searchParams;
  const filter = parseFilter(query.show);
  const diff = typeof query.diff === "string" && UUID.test(query.diff) ? query.diff : null;
  const supabase = await createClient();
  const data = await Sentry.startSpan({ name: "alerts.read", op: "db.read", attributes: { filter } }, () => readAlertCards(supabase, workspace));
  if (data.kind === "not-found") return null; // the workspace layout has already shown NoAccess
  const model = inbox(data.cards, filter, diff);
  return (
    <Screen route="/w/[workspace]/alerts" aside={<UnreadChip unread={model.unread} />}>
      <Inbox workspaceId={workspace} inbox={model} today={data.today} />
    </Screen>
  );
}
