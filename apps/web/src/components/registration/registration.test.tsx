// S-NV2-008 and S-NV2-020 rendered to static markup (T-504). Obligation rows are plainly fake test data.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ObligationRow } from "@/lib/registration/model";
import type { RegistrationPage } from "@/lib/registration/queries";
import { ObligationFacts, Obligations } from "./Obligations";
import { RegistrationPack } from "./RegistrationPack";

vi.mock("@/lib/registration/actions", () => ({ recordRegistration: async () => ({ status: "idle" }) }));
vi.mock("posthog-js", () => ({ default: { capture: () => {} } }));

const WS = "10000000-0000-4000-8504-000000000001";
const FORBIDDEN = /submit|file|pay|prepare pack|download form/i;

const page = (over: Partial<Extract<RegistrationPage, { kind: "loaded" }>> = {}): Extract<RegistrationPage, { kind: "loaded" }> => ({
  kind: "loaded",
  product: { id: "20000000-0000-4000-8504-000000000001", name: "Synthetic Dry 2 kg" },
  market: { nodeId: "EU-DE", name: "Germany" },
  displayState: "not_assessed",
  registrationState: "unknown",
  latest: null,
  obligation: null,
  documents: [],
  ...over,
});

/** The accessible names of every button and link in the markup (text content, tags stripped). */
function controls(html: string): string[] {
  return [...html.matchAll(/<(button|a)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => m[2].replace(/<[^>]+>/g, "").trim());
}

describe("Registration pack", () => {
  it("[D06.must.1] an unknown registration never renders the Clear badge, whatever the label says", () => {
    for (const displayState of ["not_assessed", null, "unexpected"]) {
      const html = renderToStaticMarkup(<RegistrationPack page={page({ displayState })} workspaceId={WS} canEdit={false} gap={null} />);
      expect(html).not.toContain('data-state="clear"');
      expect(html).not.toMatch(/>Clear</);
      expect(html).toContain('data-registration-state="unknown"');
      expect(html).toContain("Unknown");
    }
  });

  it("[G02.main] with no sourced obligation the checklist is read only and not assessed", () => {
    const html = renderToStaticMarkup(
      <RegistrationPack page={page()} workspaceId={WS} canEdit={false} gap={{ gapId: "GAP-EU-DE-REGISTRATION", href: `/w/${WS}/library/coverage/EU-DE#GAP-EU-DE-REGISTRATION` }} />,
    );
    expect(html).toContain('data-checklist="not_assessed"');
    expect(html).toContain("No sourced evidence list held. Checklist not assessed.");
    expect(html).toContain("No sourced obligation held for this market.");
    expect(html).toContain("GAP-EU-DE-REGISTRATION");
    expect(html).not.toContain("<input");
    expect(html).toContain('data-testid="record-no-permission"');
  });

  it("[G02.must.1] the registration pack has no submit, file, pay, prepare-pack or download-form control", () => {
    for (const canEdit of [false, true]) {
      const html = renderToStaticMarkup(<RegistrationPack page={page()} workspaceId={WS} canEdit={canEdit} gap={null} />);
      for (const name of controls(html)) expect(name).not.toMatch(FORBIDDEN);
      expect(html).not.toMatch(/PREPARE PACK|DOWNLOAD FORM SET/);
      expect(html).not.toContain('type="radio"');
    }
  });

  it("[G03.main] an editor gets the record form; a recorded registration is shown with its number", () => {
    const html = renderToStaticMarkup(
      <RegistrationPack
        page={page({
          registrationState: "registered",
          displayState: "not_assessed",
          latest: { id: "r1", number: "SYN-001", registeredOn: "2026-10-01", expiresAt: null, evidenceDocType: "certificate_of_analysis", createdAt: "2026-10-01T10:00:00Z" },
        })}
        workspaceId={WS}
        canEdit
        gap={null}
      />,
    );
    expect(html).toContain("data-record-form");
    expect(html).toContain('name="number"');
    expect(html).toContain("SYN-001");
    expect(html).toContain("Certificate of analysis");
    expect(html).toContain("Registered");
  });
});

describe("Obligations", () => {
  const fake: ObligationRow = {
    id: "o1",
    node_id: "EU-DE",
    kind: "registration",
    authority: "SYNTHETIC TEST AUTHORITY",
    legal_basis: null,
    route: null,
    evidence_list: null,
    fee: null,
    lead_time_days: null,
    renewal_cycle: null,
    submission_language: null,
    source_url: "https://example.invalid/o1",
    last_verified_at: "2026-10-01",
  };

  it("[G01.main] an obligation renders every field, not held where it holds nothing, with its source and date", () => {
    const html = renderToStaticMarkup(<ObligationFacts obligation={fake} />);
    expect(html.match(/data-field=/g)).toHaveLength(10);
    expect(html.match(/not held/g)).toHaveLength(7);
    expect(html).toContain("https://example.invalid/o1");
    expect(html).toContain("2026-10-01");
  });

  it("[G01.main] a market with no sourced obligation reads registration not assessed and links its gap", () => {
    const html = renderToStaticMarkup(
      <Obligations
        workspaceId={WS}
        markets={[{ nodeId: "EU-DE", name: "Germany", obligations: [], gap: { gapId: "GAP-EU-DE-REGISTRATION", href: `/w/${WS}/library/coverage/EU-DE#GAP-EU-DE-REGISTRATION` } }]}
      />,
    );
    expect(html).toContain('data-market-state="not_assessed"');
    expect(html).toContain("No sourced obligation held for this market.");
    expect(html).toContain("Registration not assessed.");
    expect(html).toContain("#GAP-EU-DE-REGISTRATION");
    for (const name of controls(html)) expect(name).not.toMatch(FORBIDDEN);
  });

  it("the empty state: a workspace with no market", () => {
    const html = renderToStaticMarkup(<Obligations workspaceId={WS} markets={[]} />);
    expect(html).toContain("No product is on a market yet");
  });
});
