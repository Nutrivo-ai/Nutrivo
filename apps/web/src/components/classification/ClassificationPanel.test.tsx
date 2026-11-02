// S-NV2-002 "3 · Which rulebook applies" (D03): every state renders, an empty field is never filled in, and a person
// can confirm or correct the values wherever there is something to confirm (app.confirm_classification).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ClassificationRow } from "@/lib/classification/describe";
import { ClassificationPanel as Panel } from "./ClassificationPanel";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/classification/actions", () => ({ confirmClassification: async () => ({ ok: true, id: "x" }) }));

const PRODUCT = "40000000-0000-4000-8402-0000000000a1";
const ClassificationPanel = (props: { state: Parameters<typeof Panel>[0]["state"] }) => <Panel {...props} productId={PRODUCT} />;

const row: ClassificationRow = {
  id: "c-1",
  species: "cat",
  life_stage: null,
  product_class: "complete",
  intended_use: null,
  parnut_status: null,
  provenance: "model_judgement",
  confirmed_at: null,
  created_at: "2026-11-02T10:00:00Z",
  citation: JSON.stringify({
    fields: {
      species: { quote: "Complete feed for adult cats", panel_index: 0, language: "en" },
      product_class: { quote: "Complete feed for adult cats", panel_index: 0, language: "en" },
    },
    empty: { life_stage: "low_confidence", intended_use: "abstained", parnut_status: "abstained" },
  }),
};

describe("ClassificationPanel", () => {
  it("[D03.main] the loaded state lists the five values with their label evidence, unconfirmed", () => {
    const html = renderToStaticMarkup(<ClassificationPanel state={{ kind: "loaded", row }} />);
    expect(html).toContain("3 · Which rulebook applies");
    expect(html).toContain("Classification, determined before any check runs");
    for (const label of ["Species", "Life stage", "Product class", "Intended use", "PARNUT status"]) expect(html).toContain(label);
    expect(html).toContain("Complete feed");
    expect(html).toContain("Label text “Complete feed for adult cats” · panel 1 · EN");
    expect(html).toContain('data-confirmed="false"');
    expect(html).toContain("A person confirms these values before any rule uses them.");
  });

  it("[D03.fail.1] an unsure field reads Not determined with why it was left empty", () => {
    const html = renderToStaticMarkup(<ClassificationPanel state={{ kind: "loaded", row }} />);
    expect(html.match(/Not determined/g)).toHaveLength(3);
    expect(html).toContain("Left for you: the suggestion was not sure enough");
  });

  it.each([
    [{ kind: "loading" } as const, "READING THE LABEL"],
    [{ kind: "empty" } as const, "No classification yet."],
    [{ kind: "error" } as const, "The classification could not be read."],
  ])("renders the %o state", (state, text) => {
    const html = renderToStaticMarkup(<ClassificationPanel state={state} />);
    expect(html).toContain(text);
    expect(html).toContain("3 · Which rulebook applies");
  });

  it("[D03.main] an unconfirmed suggestion offers confirmation; a confirmed one offers the design's challenge", () => {
    const html = renderToStaticMarkup(<ClassificationPanel state={{ kind: "loaded", row }} />);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain("Confirm or correct these values");
    const confirmed = renderToStaticMarkup(
      <ClassificationPanel state={{ kind: "loaded", row: { ...row, provenance: "person", confirmed_at: "2026-11-03T08:00:00Z" } }} />,
    );
    expect(confirmed).toContain("Challenge this determination");
    expect(confirmed).toContain('data-confirmed="true"');
  });

  it("with nothing to classify from, a person can still classify; loading and error offer nothing to press", () => {
    expect(renderToStaticMarkup(<ClassificationPanel state={{ kind: "empty" }} />)).toContain("Confirm or correct these values");
    for (const state of [{ kind: "loading" } as const, { kind: "error" } as const]) {
      expect(renderToStaticMarkup(<ClassificationPanel state={state} />)).not.toMatch(/<button|<select/);
    }
  });
});
