// T-1003 · E04 Promote a brief to artwork on Brief & formula (S-NV2-004): the control shows only at stage brief, says
// what it does, and every refusal has its own words. The end-to-end path is in tests/e2e/briefs.spec.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Brief } from "@/lib/briefs/queries";
import { BriefForm } from "./BriefForm";
import { PROMOTE_NOTE, PROMOTE_REFUSAL } from "./PromoteToArtwork";

vi.mock("@/lib/briefs/actions", () => ({
  saveFormula: async () => ({ ok: true, count: 0 }),
  saveClaims: async () => ({ ok: true, count: 0 }),
  findInRegister: async () => ({ ok: true, rows: [] }),
  promoteBrief: async () => ({ ok: false, reason: "error" }),
}));

const WS = "20000000-0000-4000-8101-00000000000b";
const brief: Brief = {
  id: "40000000-0000-4000-8101-00000000000b",
  name: "Senior Joint Support Wet",
  stage: "brief",
  species: "dog",
  lifeStage: null,
  productClass: null,
  nodes: ["EU-DE"],
  lines: [],
  claims: {},
  languages: ["de"],
};

describe("PromoteToArtwork", () => {
  it("[E04.main] a brief offers Promote to artwork, with what it does", () => {
    const html = renderToStaticMarkup(<BriefForm workspaceId={WS} brief={brief} />);
    expect(html).toContain("Promote to artwork");
    expect(html).toContain("data-promote");
    expect(html).toContain(PROMOTE_NOTE.replace("&", "&amp;"));
  });

  it("a product past the brief stage has no promote control", () => {
    for (const stage of ["in_development", "active", "discontinued"]) {
      const html = renderToStaticMarkup(<BriefForm workspaceId={WS} brief={{ ...brief, stage }} />);
      expect(html).not.toContain("Promote to artwork");
    }
  });

  it("every refusal has its own message", () => {
    const texts = Object.values(PROMOTE_REFUSAL);
    expect(new Set(texts).size).toBe(texts.length);
    expect(PROMOTE_REFUSAL["no-permission"]).toMatch(/role/);
  });
});
