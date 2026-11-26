// T-1110 · S-NV2-017: the overview's branches that the e2e workspace does not reach. An admin who is not an internal
// admin of the whole workspace sees who manages the plan, never its figures; an admin whose only invitations lapsed is
// alone, so the empty state shows.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Overview, type OverviewView } from "./Overview";

const WS = "20000000-0000-4000-8110-00000000000a";
const view = (extra: Partial<OverviewView> = {}): OverviewView => ({
  workspaceId: WS,
  people: [{ id: "m1", name: "Ada", email: "ada@example.test", role: "Admin", signing: "None", signingTone: "none", last: "Just now" }],
  invitations: 0,
  workspace: [],
  plan: { kind: "read", lines: [{ k: "Plan", v: "Free" }] },
  ...extra,
});

describe("Settings & roles overview (S-NV2-017)", () => {
  it("[T-1110] an admin without billing access sees who manages the plan, not its figures or its link", () => {
    const html = renderToStaticMarkup(<Overview view={view({ plan: { kind: "no-billing" } })} />);
    expect(html).toContain("data-no-billing");
    expect(html).toContain("The plan is managed by an internal admin of the whole workspace.");
    expect(html).not.toContain(`/w/${WS}/settings/billing`);
    expect(html).not.toContain("Free");
  });

  it("[T-1110] the plan card shows its figures and links Plan and allowance for a billing admin", () => {
    const html = renderToStaticMarkup(<Overview view={view()} />);
    expect(html).not.toContain("data-no-billing");
    expect(html).toContain(`href="/w/${WS}/settings/billing"`);
  });

  it("[T-1110] an admin alone, with no pending invitation, gets the empty state", () => {
    expect(renderToStaticMarkup(<Overview view={view()} />)).toContain("Nobody else is in this workspace yet");
    const invited = renderToStaticMarkup(<Overview view={view({ invitations: 1 })} />);
    expect(invited).not.toContain("Nobody else is in this workspace yet");
    expect(invited).toContain("1 PENDING INVITATION ·");
  });
});
