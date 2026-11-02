import { describe, expect, it } from "vitest";
import { cardStatus, fileLine, languageName, panelVerdict, reasonLabel, runHeadline } from "./describe";
import type { ArtworkSummary, PanelCheck, PanelRow, RunSummary } from "./queries";

const run = (status: RunSummary["status"], failureCodes: string[] = []): RunSummary => ({
  id: "r", status, failureCodes, engineVersion: "1", finishedAt: null,
});
const art = (r: RunSummary | null): ArtworkSummary => ({
  id: "a", version: 1, fileName: "label.pdf", mimeType: "application/pdf", sha256: "f".repeat(64), pageCount: 1,
  pageSizeMm: [234, 120], createdAt: "2026-10-24T10:00:00Z", run: r,
});
const panel = (index: number, failureCode: string | null): PanelRow => ({
  id: String(index), page: 0, index, language: failureCode ? "und" : "de",
  status: failureCode ? "not_assessable" : "extracted", failureCode, textObjects: failureCode ? 0 : 12,
});

describe("what an extraction says", () => {
  it("the card is Complete only when every panel was read", () => {
    expect(cardStatus(run("succeeded"))).toEqual({ label: "Complete", tone: "clear" });
    expect(cardStatus(run("partial")).label).toBe("Partial");
    expect(cardStatus(run("failed")).label).toBe("Not readable");
    expect(cardStatus(null).label).toBe("Reading");
    expect(fileLine(art(run("succeeded")))).toBe("label.pdf · vector text extracted");
    expect(fileLine(art(run("failed", ["rasterised"])))).toBe("label.pdf · raster image · no live text");
  });

  it("names every failure and counts panels, never a file-level error", () => {
    const h = runHeadline(run("partial", ["outlined_text"]), [panel(0, null), panel(1, "outlined_text"), panel(2, null)]);
    expect(h.tag).toBe("Partial extraction · 2 of 3 panels");
    expect(h.body).toContain("outlined · no live text");
    expect(h.body).toContain("not assessed there rather than passed");
  });

  it("an undetected language is said so, never guessed", () => {
    expect(languageName("und")).toBe("Language not detected");
    expect(languageName(null)).toBe("Language not detected");
    expect(languageName("de")).toBe("German");
    expect(languageName("en-GB")).toBe("English (GB)");
  });
});

const check = (panelId: string, nodeId: string, labelState: PanelCheck["labelState"], reasonCodes: string[] = []): PanelCheck => ({
  panelId, nodeId, labelState, at: "2026-11-02T10:00:00Z", reasonCodes,
});

describe("a panel's state over its markets' checks (D02)", () => {
  it("[D02.must.1] a panel that cannot be assessed is Not assessed with its reason code, before and after a check", () => {
    const outlined = panel(1, "outlined_text");
    expect(panelVerdict(outlined, [])).toEqual({ state: "not_assessed", label: "Not assessed", reasonCodes: ["outlined_text"] });
    const after = panelVerdict(outlined, [check("1", "EU-DE", "not_assessed", ["outlined_text", "not_encoded"])]);
    expect(after.state).toBe("not_assessed");
    expect(after.reasonCodes).toEqual(["outlined_text", "not_encoded"]);
    // Never Clear, even if a check row claimed it.
    expect(panelVerdict(outlined, [check("1", "EU-DE", "clear")]).state).toBe("not_assessed");
  });

  it("an extracted panel reads Not checked before any check, with no verdict and no reason", () => {
    expect(panelVerdict(panel(0, null), [])).toEqual({ state: "not_checked", label: "Not checked", reasonCodes: [] });
    // Another panel's checks are not this one's.
    expect(panelVerdict(panel(0, null), [check("9", "EU-DE", "clear")]).state).toBe("not_checked");
  });

  it("rolls up worst first across markets: action, then not assessed, then clear", () => {
    const p = panel(0, null);
    expect(panelVerdict(p, [check("0", "EU-DE", "clear"), check("0", "EU-AT", "clear")])).toEqual({
      state: "clear", label: "Clear", reasonCodes: [],
    });
    const na = panelVerdict(p, [check("0", "EU-DE", "clear"), check("0", "EU-AT", "not_assessed", ["not_encoded"])]);
    expect(na).toEqual({ state: "not_assessed", label: "Not assessed", reasonCodes: ["not_encoded"] });
    const action = panelVerdict(p, [check("0", "EU-DE", "action"), check("0", "EU-AT", "not_assessed", ["not_encoded"])]);
    expect(action.state).toBe("action");
    expect(action.label).toBe("Action needed");
  });

  it("names reason codes in the failure taxonomy's words, otherwise as the code", () => {
    expect(reasonLabel("outlined_text")).toBe("Outlined · no live text");
    expect(reasonLabel("not_encoded")).toBe("not encoded");
  });
});
