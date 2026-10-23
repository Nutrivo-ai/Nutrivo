"use client";

// Every kit component in every state it defines, for the kit's visual, axe and keyboard tests (tests/e2e/kit.spec.ts).
// The sample content is the design files' own demo data (Nutrivo 2.0); gap and rule links point at the coverage
// route proposed in spec/screens.yaml and are not built yet (T-102 onwards).
import { useState, type ReactNode } from "react";
import {
  Button,
  ButtonLink,
  CitationLink,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  Finding,
  GapLink,
  LoadingState,
  NoPermissionState,
  Panel,
  ProvenanceTag,
  PROVENANCES,
  SectionHeading,
  StateBadge,
  StateCell,
  StateLegend,
  stateTint,
  useToast,
  VERDICT_STATES,
  type Column,
  type FindingProps,
  type VerdictState,
} from "@/components/kit";

// Sample rule_keys (the shape ref.rules uses), named so they read as data rather than credentials.
const RULE = {
  charHeight: "eu.767-2009.annex-ii.1b.char-height",
  zinc: "eu.1831-2003.3b606.zinc-max",
  dateFormat: "ch.vlth.art-12.date-format",
  designation: "eu.767-2009.art-15a.designation.de",
  identity: "eu.1831-2003.annex-i.identity",
  art15a: "eu.767-2009.art-15a",
};

const COVERAGE = "/w/demo/library/coverage/EU-PL";

const FINDINGS: FindingProps[] = [
  { pin: "3", title: "Analytical constituents heading below minimum character height", state: "action",
    action: "Increase the heading to at least 2.0 mm x-height. Affects DE, AT and CH — one prepress change clears the heading in all three.",
    ruleKey: RULE.charHeight, citation: "EU 767/2009 Annex II 1(b)", provenance: "deterministic_rule",
    measure: "Measured 1.91 mm · required 2.00 mm" },
  { pin: "4", title: "Zinc declared at 180 mg/kg — above the permitted maximum", state: "blocked",
    action: "Reformulate to 150 mg/kg or below. No label change resolves this; the declaration is accurate and the level is not permitted.",
    ruleKey: RULE.zinc, citation: "EU 1831/2003 · max total zinc 150 mg/kg", provenance: "deterministic_rule",
    measure: "Declared 180 mg/kg" },
  { pin: "6", title: "Best-before date format may not satisfy the GB requirement", state: "action",
    action: "Confirm whether MM/YYYY is accepted in GB for this product class, or move to DD.MM.YYYY to satisfy all three German-language markets at once.",
    ruleKey: RULE.dateFormat, citation: "CH VLtH Art. 12", provenance: "model_judgement", measure: "Coverage: CH partial" },
  { pin: "1", title: "Product designation wording differs from the prescribed German form", state: "action",
    action: "Replace with the register designation: “Alleinfuttermittel für Hunde”.",
    ruleKey: RULE.designation, citation: "Term register v2026.08 · DE designation", citationHref: "#rule-designation",
    provenance: "authored_definition", measure: "Not a translation issue" },
  { title: "Feed additive declaration format, Poland", state: "not_assessed",
    action: "We hold no encoded rules for national additive presentation requirements on this node.",
    provenance: "not_assessed", reasonCode: "not_encoded", gapId: "PL-02", gapHref: COVERAGE },
  { title: "Three additive rules could not be assessed", state: "not_assessed",
    action: "The PMX-118 premix specification expired on 3 June. Until a current spec is supplied, additive identity and inclusion cannot be verified for BE.",
    provenance: "not_assessed", reasonCode: "data_missing", gapId: "BE-07", gapHref: COVERAGE,
    ruleKey: RULE.identity, citation: "EU 1831/2003 Annex I", measure: "1 document outstanding" },
];

type BoardRow = { name: string; meta: string; cells: Array<[VerdictState, string]>; fresh: string };
const BOARD: BoardRow[] = [
  { name: "Salmon & Rice Adult 12 kg", meta: "SKU 4410 · active", fresh: "2026.08-b",
    cells: [["clear", ""], ["clear", ""], ["action", "2"], ["not_assessed", "·"], ["action", "1"], ["blocked", "1"]] },
  { name: "Senior Light Chicken", meta: "SKU 4302 · active", fresh: "2026.08-b",
    cells: [["clear", ""], ["action", "1"], ["clear", ""], ["not_assessed", "·"], ["clear", ""], ["action", "2"]] },
  { name: "Puppy Grain Free", meta: "SKU 4520 · in development", fresh: "2026.07-a · stale",
    cells: [["action", "4"], ["action", "3"], ["not_assessed", "·"], ["not_assessed", "·"], ["not_assessed", "·"], ["not_assessed", "·"]] },
];
const NODES = ["DE", "FR", "NL", "PL", "GB", "TX"];
const COLUMNS: Column<BoardRow>[] = [
  { key: "product", header: "Product", width: "30%", cell: (r) => (
    <>
      <span className="block text-[13.5px] font-medium">{r.name}</span>
      <span className="block mt-[2px] font-mono text-[10px] text-n600">{r.meta}</span>
    </>
  ) },
  ...NODES.map((node, i): Column<BoardRow> => ({
    key: node, header: node, align: "center", width: "9%", flush: true,
    cell: (r) => <StateCell state={r.cells[i][0]} count={r.cells[i][1]} />,
    cellClass: (r) => stateTint(r.cells[i][0]),
  })),
  { key: "ruleset", header: "Checked against", cell: (r) => <span className="font-mono text-[10.5px] text-n600">{r.fresh}</span> },
];

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section data-testid={`kit-${id}`} aria-labelledby={`kit-${id}-title`} className="py-[24px] px-[26px] border-b border-rule">
      <div id={`kit-${id}-title`}>
        <SectionHeading note={note}>{title}</SectionHeading>
      </div>
      <div className="mt-[16px]">{children}</div>
    </section>
  );
}

function TableStates() {
  const empty = (
    <EmptyState where="BOARD" title="No recipes yet" body="Add your first recipe, or upload label artwork and we will read the recipe out of it."
      action={{ label: "Add a recipe", variant: "primary", href: "#add-recipe" }} aside="or upload artwork" />
  );
  return (
    <div className="grid grid-cols-2 gap-[26px]">
      <div data-testid="kit-table-loaded" className="col-span-2">
        <DataTable caption="Portfolio board" columns={COLUMNS} rows={BOARD} rowKey={(r) => r.name} empty={empty} />
        <div className="mt-[16px]"><StateLegend /></div>
      </div>
      <div data-testid="kit-table-loading">
        <DataTable caption="Board, loading" columns={COLUMNS.slice(0, 3)} rows={[]} rowKey={(r) => r.name} empty={empty} loading />
      </div>
      <div data-testid="kit-table-empty">
        <DataTable caption="Board, empty" columns={COLUMNS.slice(0, 3)} rows={[]} rowKey={(r) => r.name} empty={empty} />
      </div>
      <div data-testid="kit-table-error">
        <DataTable caption="Board, error" columns={COLUMNS.slice(0, 3)} rows={BOARD} rowKey={(r) => r.name} empty={empty}
          error={<ErrorState where="BOARD" title="The board could not be loaded" body="Nothing was changed. Your recipes and their answers are as you left them."
            action={{ label: "Load the board again", variant: "primary", href: "/kit" }} />} />
      </div>
      <div data-testid="kit-table-no-permission">
        <DataTable caption="Board, no permission" columns={COLUMNS.slice(0, 3)} rows={BOARD} rowKey={(r) => r.name} empty={empty}
          noPermission={<NoPermissionState where="BOARD" title="This board is outside your access" body="Your access covers the Senior range only."
            aside="A. Retzlik, admin, can widen it" />} />
      </div>
    </div>
  );
}

export function KitGallery() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  return (
    <main className="min-w-[1180px] max-w-[1180px] mx-auto bg-paper">
      <header className="py-[20px] px-[26px] border-b border-ink">
        <p className="m-0 font-mono text-[10px] tracking-[0.1em] uppercase text-n600">Kit · T-101</p>
        <h1 className="mt-[2px] mb-0 text-[22px] font-semibold leading-[1.1]">Cobalt component kit</h1>
      </header>

      <Section id="states" title="States" note="glyph and name, always both">
        <div className="flex flex-col gap-[14px]">
          <div className="flex gap-[28px]">{VERDICT_STATES.map((s) => <StateBadge key={s} state={s} size="md" />)}</div>
          <div className="flex gap-[28px]">{VERDICT_STATES.map((s) => <StateBadge key={s} state={s} />)}</div>
          <StateLegend />
        </div>
      </Section>

      <Section id="provenance" title="Provenance, citation and gap" note="mono, never tinted">
        <div className="flex flex-col gap-[10px] font-mono text-[10px]">
          <div className="flex gap-[24px]">{PROVENANCES.map((p) => <ProvenanceTag key={p} provenance={p} />)}</div>
          <div className="flex gap-[24px]">
            <CitationLink ruleKey={RULE.art15a} citation="EU 767/2009 Art. 15(a)" />
            <CitationLink ruleKey={RULE.art15a} citation="EU 767/2009 Art. 15(a)" href="#rule-15a" />
            <GapLink gapId="PL-02" href={COVERAGE} />
          </div>
        </div>
      </Section>

      <Section id="findings" title="What is missing, and what to do" note="DE · 6 findings">
        <div className="max-w-[560px]">{FINDINGS.map((f) => <Finding key={f.title} {...f} />)}</div>
      </Section>

      <Section id="tables" title="Tables" note="loaded · loading · empty · error · no permission">
        <TableStates />
      </Section>

      <Section id="patterns" title="Empty, error and loading" note="Empty and Error States">
        <div className="grid grid-cols-2 gap-[18px]">
          <EmptyState where="FIRST RUN · HOME" title="No recipes yet" body="Add your first recipe, or upload label artwork and we will read the recipe out of it."
            action={{ label: "Add a recipe", variant: "primary", href: "#add-recipe" }} aside="or upload artwork" />
          <EmptyState kind="action" where="SKIPPED STEP · HOME" title="Your operator details are not set"
            body="Registration obligations are named against the operator on the label."
            action={{ label: "Add operator details", variant: "primary", href: "#operator" }} aside="two fields" />
          <EmptyState where="COVERAGE · WITHHELD" title="We hold no rules for this market"
            body="No verdict is offered, and this market can never show as Clear."
            reference={{ href: COVERAGE, label: "GAP PL-02 · EU-PL" }}
            action={{ label: "See coverage for this market", href: COVERAGE }} />
          <ErrorState where="ARTWORK · U10" title="We could not read three language panels"
            body="Six of nine panels were read and are reported below."
            action={{ label: "Upload a vector PDF", variant: "primary", href: "#upload" }} aside="the six results stand" />
          <LoadingState label="CHECKING · 4 OF 9 PANELS">Reading the Dutch panel.</LoadingState>
        </div>
      </Section>

      <Section id="controls" title="Panels, buttons, dialog and toast">
        <div className="grid grid-cols-2 gap-[18px] items-start">
          <Panel title="Panel header" aside="RULESET 2026.08-b">
            <div className="flex gap-[8px] items-center">
              <Button variant="primary" onClick={() => setOpen(true)}>Open the dialog</Button>
              <Button onClick={() => toast({ text: "Invitation sent to M. Lind." })}>Show a toast</Button>
              <Button variant="ghost" onClick={() => toast({ kind: "blocked", text: "The export could not build. Nothing was lost." })}>
                Show a failure
              </Button>
            </div>
            <div className="mt-[10px] flex gap-[8px] items-center">
              <Button variant="primary" disabled>Disabled</Button>
              <Button disabled>Disabled</Button>
              <ButtonLink href="#plans" size="md">A link as a button</ButtonLink>
            </div>
          </Panel>
        </div>
        <Dialog open={open} onClose={() => setOpen(false)} kicker="Workspace · Halden Pet Nutrition" title="Remove M. Lind from this workspace?"
          confirmLabel="Remove M. Lind" onConfirm={() => { setOpen(false); toast({ text: "M. Lind was removed." }); }}>
          M. Lind loses access at once. Checks and reports they ran stay in the workspace, and the audit log keeps their name.
        </Dialog>
      </Section>
    </main>
  );
}
