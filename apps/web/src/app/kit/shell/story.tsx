"use client";

import { ScreenHeader, ShellFrame, type RailGroup } from "@/components/shell";

// Nutrivo 2.0's rail exactly as the design file fills it on Home (S-NV2-001): every group and entry, its counts, and
// Home active. The built rail (src/lib/shell/routes.ts) keeps only the entries with a route of their own; this story
// is what tests/e2e/shell.spec.ts compares with the S-NV2-001 baseline to hold the rail's drawing to the design.
const DESIGN_NAV: [string, [string, string?][]][] = [
  ["Start", [["Home"]]],
  ["Check your label", [["Upload & scope"], ["Label report", "7"]]],
  ["New product", [["Brief & formula"], ["Design envelope"]]],
  ["Portfolio", [["Board", "306"], ["Product × node"], ["Obligations", "11"], ["Certificates", "24"], ["Documents", "3"]]],
  ["Screening", [["Ingredients & formulas"]]],
  ["Library", [["Term register"], ["Coverage & confidence"], ["Suppliers", "3"]]],
  ["Operations", [["Monitoring & alerts", "2"], ["Clients & partners"], ["Exports"], ["Settings & roles"]]],
  ["Jurisdictions", [["Jurisdiction tree"], ["Registration pack"], ["Coverage node"]]],
  ["Products", [["Add a product"], ["Discontinued", "6"]]],
  ["Running a check", [["In progress"], ["Artwork we cannot read"]]],
  ["Artefacts", [["Export, send, share"], ["Public verification"], ["Supplier portal"]]],
  ["Across the product", [["Term acceptance queue"], ["Empty and first run"], ["Segment surfaces"], ["Mobile views"]]],
  ["Access", [["Auth, roles, signing"], ["Worker uncertainty"]]],
];

const groups: RailGroup[] = DESIGN_NAV.map(([label, items]) => ({
  label,
  items: items.map(([item, badge], i) => ({
    label: item,
    badge,
    href: `/kit/shell?item=${encodeURIComponent(label)}-${i}`,
    active: item === "Home",
  })),
}));

export function ShellStory() {
  return (
    <ShellFrame groups={groups} regions={["EU", "UK", "US"]} matchedRoute="/w/[workspace]" workspaceId="kit">
      <ScreenHeader crumb="Start" title="Where do you want to begin?" />
      {/* The design's Home is 1831 px tall; the rail runs the full height of the page. */}
      <main className="h-[1764px]" aria-label="Kit: the shell's frame" />
    </ShellFrame>
  );
}
