// T-902 · J04: every state of the alerts inbox and the horizon, rendered to static markup: loading, error, empty,
// nothing in a filter, coming and in force (docs/20: every screen has every state).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/alerts/actions", () => ({ markAlertsRead: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import AlertsLoading from "@/app/w/[workspace]/alerts/loading";
import HorizonLoading from "@/app/w/[workspace]/horizon/loading";
import WorkspacePageError from "@/app/w/[workspace]/error";
import { buildCards, buildHorizon, inbox, type AlertRow } from "@/lib/alerts/model";
import { AlertsReadError, readAlertCards } from "@/lib/alerts/queries";
import { Horizon } from "./Horizon";
import { Inbox, UnreadChip } from "./Inbox";

const WS = "11111111-1111-4111-8111-111111111111";
const TODAY = "2026-11-13";
const P = "aaaaaaaa-0000-4000-8000-000000000001";

const row = (over: Partial<AlertRow>): AlertRow => ({
  id: "eeeeeeee-0000-4000-8000-000000000001",
  rule_diff_id: "dddddddd-0000-4000-8000-000000000001",
  product_id: P,
  node_id: "EU-FR",
  phase: "coming",
  effect_type: "prescribed_wording",
  effective_from: "2027-01-01",
  sell_through_until: null,
  created_at: "2026-11-12T07:23:00Z",
  ...over,
});

function cards(rows: AlertRow[], entitled = ["EU"]) {
  return buildCards({
    workspaceId: WS,
    today: TODAY,
    entitledRegions: entitled,
    alerts: rows,
    readIds: new Set(),
    diffs: [
      { id: "dddddddd-0000-4000-8000-000000000001", rule_key: "k.fr", to_version: 1 },
      { id: "dddddddd-0000-4000-8000-000000000002", rule_key: "k.tx", to_version: 1 },
    ],
    rules: [
      { rule_key: "k.fr", title: "A French wording" },
      { rule_key: "k.tx", title: "A Texas form" },
    ],
    citations: [],
    products: [{ id: P, name: "Puppy complete wet", stage: "active" }],
    jurisdictions: [
      { id: "EU", name: "European Union", parent_id: null },
      { id: "EU-FR", name: "France", parent_id: "EU" },
      { id: "US", name: "United States", parent_id: null },
      { id: "US-TX", name: "Texas", parent_id: "US" },
    ],
  });
}

const both = [
  row({}),
  row({ id: "eeeeeeee-0000-4000-8000-000000000002", rule_diff_id: "dddddddd-0000-4000-8000-000000000002", node_id: "US-TX", phase: "in_force", effective_from: "2026-09-01", effect_type: "new_obligation" }),
];

describe("alerts inbox states (T-902)", () => {
  it("loading: both routes show the workspace loading state", () => {
    for (const Loading of [AlertsLoading, HorizonLoading]) expect(renderToStaticMarkup(<Loading />)).toContain("LOADING · WORKSPACE");
  });

  it("error: a failed read throws to the workspace error boundary, which says nothing changed and offers a retry", async () => {
    const failing = {
      schema: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "boom", code: "XX000" } }) }) }) }) }),
    };
    await expect(readAlertCards(failing as never, WS, TODAY)).rejects.toBeInstanceOf(AlertsReadError);
    const html = renderToStaticMarkup(<WorkspacePageError error={new Error("x")} retry={() => {}} />);
    expect(html).toContain("This page could not be read");
    expect(html).toContain("Read it again");
  });

  it("empty: no change affects the recipes yet, pointing at the horizon", () => {
    const html = renderToStaticMarkup(<Inbox workspaceId={WS} inbox={inbox([], "all")} today={TODAY} />);
    expect(html).toContain("No rule change affects your recipes yet");
    expect(html).toContain(`href="/w/${WS}/horizon"`);
    expect(renderToStaticMarkup(<UnreadChip unread={0} />)).toContain("ALL READ");
  });

  it("nothing in a filter: says so and links back to every alert", () => {
    const html = renderToStaticMarkup(<Inbox workspaceId={WS} inbox={inbox(cards([row({})]), "in_force")} today={TODAY} />);
    expect(html).toContain("Nothing in force needs reading");
    expect(html).toContain("Show every alert");
  });

  it("[J04.main] coming and in force: each card says which, with its date and glyph, on desktop and phone", () => {
    const html = renderToStaticMarkup(<Inbox workspaceId={WS} inbox={inbox(cards(both), "all")} today={TODAY} />);
    expect(html).toContain('data-phase="coming"');
    expect(html).toContain('data-phase="in_force"');
    expect(html).toContain("IN FORCE 1 JAN 2027");
    expect(html).toContain("APPLIED 1 SEP 2026");
    expect(html).toContain('data-glyph="action"');
    expect(html).toContain("MARK ALL READ");
    expect(html).toContain('data-region="mobile-alerts"');
    expect(html).toContain("Two things changed");
    expect(renderToStaticMarkup(<UnreadChip unread={2} />)).toContain("2 UNREAD");
  });

  it("[J04.must.1] outside the plan: the recipe is named without a link, and the card says why", () => {
    const html = renderToStaticMarkup(<Inbox workspaceId={WS} inbox={inbox(cards(both), "in_force")} today={TODAY} />);
    expect(html).toContain("Puppy complete wet");
    expect(html).toContain('data-locked="true"');
    expect(html).not.toContain(`/products/${P}/nodes/US-TX`);
    expect(html).toContain("Your plan does not include United States, so the finding cannot be opened.");
  });

  it("horizon: empty, and a draft with no countdown or recipes", () => {
    const empty = renderToStaticMarkup(<Horizon workspaceId={WS} horizon={buildHorizon(WS, [], [], TODAY)} today={TODAY} />);
    expect(empty).toContain("Nothing is coming that we know of");
    expect(empty).not.toContain('data-region="deadline"');
    const draft = buildHorizon(WS, [], [{ id: "h", title: "A draft", stage: "draft", expected_date: null, effective_from: null, celex: null }], TODAY);
    const html = renderToStaticMarkup(<Horizon workspaceId={WS} horizon={draft} today={TODAY} />);
    expect(html).toContain("NO DATE");
    expect(html).toContain("Not yet linked to your recipes");
    expect(html).not.toContain("data-days");
  });
});
