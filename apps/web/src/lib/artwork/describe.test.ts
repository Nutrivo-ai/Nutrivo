import { describe, expect, it } from "vitest";
import { cardStatus, fileLine, languageName, runHeadline } from "./describe";
import type { ArtworkSummary, PanelRow, RunSummary } from "./queries";

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
