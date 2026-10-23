// The kit's invariants, rendered to static markup: the four states always carry their glyph and name, findings always
// carry provenance and a rule or a gap, and nothing on a results surface uses the accent (Cobalt §6).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DataTable, EmptyState, ErrorState, Finding, ProvenanceTag, StateBadge, StateCell, StateLegend } from ".";
import { PROVENANCES, STATE_LABEL, VERDICT_STATES } from "./states";

const ACCENT = /accent/;

describe("states", () => {
  it.each(VERDICT_STATES)("%s shows its glyph and its name, never colour alone", (state) => {
    for (const size of ["sm", "md"] as const) {
      const html = renderToStaticMarkup(<StateBadge state={state} size={size} />);
      expect(html).toContain(`data-glyph="${state}"`);
      expect(html).toContain(STATE_LABEL[state]);
      expect(html).not.toMatch(ACCENT);
    }
  });

  it("the four glyphs are four different shapes", () => {
    const shapes = VERDICT_STATES.map((state) =>
      renderToStaticMarkup(<StateBadge state={state} />)
        .match(/style="([^"]*)"/)![1]
        .replace(/var\(--[a-z-]+\)/g, "C"),
    );
    expect(new Set(shapes).size).toBe(4);
  });

  it("a board cell names its state for assistive technology and the legend names all four", () => {
    for (const state of VERDICT_STATES) {
      expect(renderToStaticMarkup(<StateCell state={state} count={2} />)).toContain(STATE_LABEL[state]);
    }
    const legend = renderToStaticMarkup(<StateLegend />);
    for (const state of VERDICT_STATES) expect(legend).toContain(STATE_LABEL[state]);
  });

  it("Not assessed has the same type size and weight as the other states", () => {
    const sized = (state: (typeof VERDICT_STATES)[number]) =>
      renderToStaticMarkup(<StateBadge state={state} />).match(/class="([^"]*)"/)![1].replace(/text-(clear|action|na|blocked)\b/, "");
    expect(new Set(VERDICT_STATES.map(sized)).size).toBe(1);
  });
});

describe("provenance", () => {
  it.each(PROVENANCES)("%s is a mono label in a neutral, never the accent or a verdict colour", (provenance) => {
    const html = renderToStaticMarkup(<ProvenanceTag provenance={provenance} />);
    expect(html).toContain("font-mono");
    expect(html).toContain("text-n600");
    expect(html).not.toMatch(/accent|text-(clear|action|na|blocked)\b/);
  });
});

describe("findings", () => {
  it("an assessed finding shows its state, provenance and rule citation", () => {
    const html = renderToStaticMarkup(
      <Finding state="action" title="Heading below minimum height" action="Increase it." provenance="deterministic_rule"
        ruleKey="eu.767-2009.annex-ii.1b" citation="EU 767/2009 Annex II 1(b)" />,
    );
    expect(html).toContain('data-glyph="action"');
    expect(html).toContain('data-provenance="deterministic_rule"');
    expect(html).toContain('data-rule-key="eu.767-2009.annex-ii.1b"');
    expect(html).not.toContain("data-gap-id");
  });

  it("a Not assessed finding links to its coverage gap and carries its reason code", () => {
    const html = renderToStaticMarkup(
      <Finding state="not_assessed" title="Additive presentation, Poland" action="No rules are encoded for this node."
        provenance="not_assessed" reasonCode="not_encoded" gapId="PL-02" gapHref="/w/demo/library/coverage/EU-PL" />,
    );
    expect(html).toContain('data-glyph="not_assessed"');
    expect(html).toContain('data-provenance="not_assessed"');
    expect(html).toContain('data-reason-code="not_encoded"');
    expect(html).toMatch(/data-gap-id="PL-02"[^]*href="\/w\/demo\/library\/coverage\/EU-PL"/);
  });

  it("the types refuse a Not assessed without a gap, and a verdict without a rule", () => {
    // @ts-expect-error gapId and gapHref are required on a Not assessed finding
    void (<Finding state="not_assessed" title="t" action="a" provenance="not_assessed" reasonCode="not_encoded" />);
    // @ts-expect-error a finding with a verdict names its rule
    void (<Finding state="blocked" title="t" action="a" provenance="deterministic_rule" />);
    // @ts-expect-error a verdict never has not_assessed provenance
    void (<Finding state="action" title="t" action="a" provenance="not_assessed" ruleKey="r" citation="c" />);
    // @ts-expect-error findings are never Clear
    void (<Finding state="clear" title="t" action="a" provenance="deterministic_rule" ruleKey="r" citation="c" />);
    expect(true).toBe(true);
  });

  it("a results surface uses the accent only on links", () => {
    const html = renderToStaticMarkup(
      <Finding state="blocked" title="Zinc above the maximum" action="Reformulate." provenance="deterministic_rule"
        ruleKey="eu.1831-2003.zinc" citation="EU 1831/2003" />,
    );
    expect(html).not.toMatch(ACCENT);
  });
});

describe("empty, error and table states", () => {
  it("empty and error states carry their mark, tag and one action", () => {
    const empty = renderToStaticMarkup(
      <EmptyState title="No recipes yet" body="Add one." action={{ label: "Add a recipe", href: "/r" }} />,
    );
    expect(empty).toContain('data-mark="none"');
    expect(empty).toContain("NOTHING YET");
    expect(empty.match(/<a /g)).toHaveLength(1);
    const error = renderToStaticMarkup(<ErrorState title="Export failed" body="Nothing was lost." action={{ label: "Try again", href: "/e" }} />);
    expect(error).toContain('data-mark="blocked"');
    expect(error).toContain("SOMETHING FAILED");
  });

  it("a table renders loading, error, no-permission and empty in place of its rows, in that order", () => {
    const columns = [{ key: "name", header: "Name", cell: (r: { name: string }) => r.name }];
    const base = { caption: "Recipes", columns, rowKey: (r: { name: string }) => r.name, empty: <span>EMPTY</span> };
    const rows = [{ name: "Senior Light" }];
    expect(renderToStaticMarkup(<DataTable {...base} rows={rows} loading error={<span>ERR</span>} />)).toContain("LOADING");
    expect(renderToStaticMarkup(<DataTable {...base} rows={rows} error={<span>ERR</span>} noPermission={<span>NOPE</span>} />)).toContain("ERR");
    expect(renderToStaticMarkup(<DataTable {...base} rows={rows} noPermission={<span>NOPE</span>} />)).toContain("NOPE");
    expect(renderToStaticMarkup(<DataTable {...base} rows={[]} />)).toContain("EMPTY");
    const loaded = renderToStaticMarkup(<DataTable {...base} rows={rows} />);
    expect(loaded).toContain("Senior Light");
    expect(loaded).toContain("<caption");
  });
});
