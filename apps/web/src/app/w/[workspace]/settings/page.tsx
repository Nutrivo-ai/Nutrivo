import * as Sentry from "@sentry/nextjs";
import type { Metadata } from "next";
import { RulesetChip } from "@/components/coverage/RulesetChip";
import { Overview } from "@/components/settings/Overview";
import { Screen } from "@/components/shell";
import { billingContext, readUsage } from "@/lib/billing/read";
import {
  personLines,
  planLines,
  readChecksThisMonth,
  readOverviewFacts,
  seatCount,
  workspaceLines,
  type PlanFacts,
} from "@/lib/settings/overview";
import { readPeople } from "@/lib/settings/people";
import { createClient } from "@/lib/supabase/server";
import { loadShellContext } from "@/lib/workspace/memberships";

export const metadata: Metadata = { title: "Settings & roles · Nutrivo" };


// S-NV2-017 Settings & roles (spec/screens.yaml; design: product/Nutrivo 2.0.dc.html, screen "settings"). A03, A05,
// A06, A08 (T-1110): the summary of Workspace Settings, linking the pages that change it. Every read is under the
// person's own session (RLS). Below admin, Screen shows the no-permission state and nothing is read. A failed read goes
// to the workspace error boundary, and loading.tsx covers the wait. The plan is read only by an internal admin of the
// whole workspace (app.billing_context); any other admin sees who manages it instead.
export default async function Page({ params }: PageProps<"/w/[workspace]/settings">) {
  const { workspace } = await params;
  const supabase = await createClient();
  const context = await loadShellContext(supabase, workspace);
  if (context.kind !== "member") return null; // the workspace layout has already shown NoAccess
  if (context.current.role !== "admin") {
    return (
      <Screen route="/w/[workspace]/settings" crumb="Settings" title="People, signing authority and workspace">
        {null}
      </Screen>
    );
  }
  const now = new Date();
  const regions = context.current.regions;
  const data = await Sentry.startSpan({ name: "settings.overview.read", op: "db.read" }, async () => {
    const [people, facts, billing] = await Promise.all([
      readPeople(supabase, workspace, regions),
      readOverviewFacts(supabase, workspace, regions),
      billingContext(supabase, workspace),
    ]);
    let plan: PlanFacts = { kind: "no-billing" };
    if (billing.ok) {
      const [usage, checksThisMonth] = await Promise.all([readUsage(supabase, workspace), readChecksThisMonth(supabase, workspace, now)]);
      plan = {
        kind: "read",
        plan: usage.plan,
        recipes: usage.counts.recipes,
        recipesIncluded: usage.subscription?.recipesIncluded ?? null,
        // The regions the workspace holds (app.workspaces.entitled_regions); the free allowance counts none as bought.
        regions,
        checksThisMonth,
      };
    } else if (billing.reason === "error") {
      throw new Error(`billing context failed: ${billing.code ?? "error"}`);
    }
    return { people, ...facts, plan };
  });
  const seats = seatCount(data.people.members, data.people.editorSeats, now);
  return (
    <Screen
      route="/w/[workspace]/settings"
      crumb="Settings"
      title="People, signing authority and workspace"
      aside={<RulesetChip version={data.ruleset} current />}
    >
      <Overview
        view={{
          workspaceId: workspace,
          people: personLines(data.people.members, data.grants, now),
          invitations: data.people.invitations.length,
          workspace: workspaceLines(data.ruleset, data.marketsInReach),
          plan: data.plan.kind === "read" ? { kind: "read", lines: planLines(data.plan, seats) } : { kind: "no-billing" },
        }}
      />
    </Screen>
  );
}
