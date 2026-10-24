// What an extraction says, in the words the S-NV2-002 and S-NV2-025 designs use. Pure, so it is unit-tested.
import type { ArtworkSummary, PanelRow, RunSummary } from "./queries";

/** docs/06 failure taxonomy, as the per-panel source column of S-NV2-025 reads it. */
export const FAILURE_LABEL: Record<string, string> = {
  outlined_text: "Outlined · no live text",
  rasterised: "Raster image · no live text",
  missing_font: "Fonts not embedded",
  colour_space: "Unsupported colour space",
  no_true_scale: "No physical scale",
  unreadable: "Could not be read",
};

/** What a person can do about each failure: the design's "How to get the geometry check". */
export const FAILURE_REMEDY: Record<string, string> = {
  outlined_text: "Ask the artwork studio for the print PDF with live text, or the packaged file with its fonts.",
  rasterised: "Upload the print PDF with live text. A photo or flat image has no text or scale to measure.",
  missing_font: "Export the PDF with every font embedded (PDF/X does this), then upload it again.",
  colour_space: "Export the PDF in CMYK or RGB, then upload it again.",
  no_true_scale: "Upload the print PDF, which carries the physical page size.",
  unreadable: "Upload an unencrypted PDF that opens in a PDF reader.",
};

const names = new Intl.DisplayNames(["en"], { type: "language" });

/** A panel's language by name; 'und' or none is "Language not detected", never a guess. */
export function languageName(code: string | null): string {
  if (!code || code === "und") return "Language not detected";
  try {
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

export type CardStatus = { label: string; tone: "clear" | "action" | "blocked" | "neutral" };

/** The Artwork card's status (S-NV2-002 "1 · What you have"): Complete only when every panel was read. */
export function cardStatus(run: RunSummary | null): CardStatus {
  switch (run?.status) {
    case "succeeded":
      return { label: "Complete", tone: "clear" };
    case "partial":
      return { label: "Partial", tone: "action" };
    case "failed":
      return { label: "Not readable", tone: "blocked" };
    default:
      return { label: "Reading", tone: "neutral" };
  }
}

/** The card's mono line: "<file> · vector text extracted" and its kin. */
export function fileLine(art: ArtworkSummary): string {
  const name = art.fileName ?? `artwork v${art.version}`;
  switch (art.run?.status) {
    case "succeeded":
      return `${name} · vector text extracted`;
    case "partial":
      return `${name} · ${art.run.failureCodes.map((c) => FAILURE_LABEL[c]?.toLowerCase() ?? c).join(", ")} on some panels`;
    case "failed":
      return `${name} · ${art.run.failureCodes.map((c) => FAILURE_LABEL[c]?.toLowerCase() ?? c).join(", ") || "no live text"}`;
    default:
      return `${name} · extraction in progress`;
  }
}

export function unlocks(art: ArtworkSummary): string {
  switch (art.run?.status) {
    case "succeeded":
      return "Geometry, character heights, panel placement, mandatory particulars in position.";
    case "partial":
      return "Geometry and character heights on the panels we read. The others are not assessed, never passed.";
    case "failed":
      return "Nothing on this file can be measured, so the geometry check is not assessed rather than passed.";
    default:
      return "Panels, languages, and both heights on every line of text, read from the file itself.";
  }
}

export type RunHeadline = { tag: string; title: string; body: string; tone: "clear" | "action" | "blocked" };

export function runHeadline(run: RunSummary, panels: PanelRow[]): RunHeadline {
  const read = panels.filter((p) => p.status === "extracted").length;
  const failures = [...new Set(panels.flatMap((p) => (p.failureCode ? [p.failureCode] : [])))];
  const what = failures.map((c) => FAILURE_LABEL[c]?.toLowerCase() ?? c).join(", ");
  if (run.status === "succeeded") {
    return {
      tag: `Extraction complete · ${panels.length} of ${panels.length} panels`,
      title: "Every panel was read: its language, its text, and both heights on every line.",
      body: "Character height, position and legibility can be measured on every panel when a check runs.",
      tone: "clear",
    };
  }
  if (run.status === "partial") {
    return {
      tag: `Partial extraction · ${read} of ${panels.length} panels`,
      title: "We read the text we could and stopped where we could not.",
      body: `${panels.length - read} of ${panels.length} panels could not be read (${what}). Character height, position and legibility cannot be measured on them, so the geometry check is not assessed there rather than passed.`,
      tone: "action",
    };
  }
  return {
    tag: `Not readable · 0 of ${panels.length} panels`,
    title: "We could not read this artwork, so nothing on it is measured.",
    body: `No panel has live text we can measure (${what || "no live text"}). The geometry check is not assessed rather than passed, and no market reads clear on the strength of this file.`,
    tone: "blocked",
  };
}

export function formatPageSize(size: number[] | null): string {
  if (!size || size.length !== 2) return "—";
  return `${Number(size[0]).toFixed(0)} × ${Number(size[1]).toFixed(0)} mm`;
}
