// T-1111 · S-NV2-024: every state of the check-in-progress screen rendered, including those the local stack cannot
// reach end to end (done with verdicts needs an encoded ruleset; failed and stalled need a broken worker).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProgressView } from "@/lib/checks/inProgress";
import { CheckProgressView } from "./CheckInProgress";

const WS = "20000000-0000-4000-8111-00000000000a";
const PR = "20000000-0000-4000-8111-00000000000b";
const render = (view: ProgressView, took: string | null = "41 seconds", moving = false) =>
  renderToStaticMarkup(
    <CheckProgressView
      workspaceId={WS}
      productId={PR}
      product="Salmon & Rice Adult 12 kg"
      markets={9}
      languages={11}
      view={view}
      took={took}
      moving={moving}
      report={`/w/${WS}/products/${PR}/report`}
      onCheckAgain={() => {}}
    />,
  );

const counts = { checks: 4, clear: 1, action: 2, notAssessed: 1, again: false };

describe("Check in progress view (S-NV2-024)", () => {
  it("[T-1111] running: elapsed time and scope, no rule counts, stages or tallies, no verdict colour", () => {
    const html = render({ kind: "running" });
    expect(html).toContain("Running");
    expect(html).toContain("41 seconds elapsed");
    expect(html).toContain("Salmon &amp; Rice Adult 12 kg · 9 nodes · 11 languages");
    expect(html).not.toMatch(/rules applied|Stage by stage|so far/i);
    expect(html).not.toContain("data-results");
    expect(html).not.toMatch(/text-(clear|action|blocked)\b/);
    expect(html).toContain("In progress is neutral");
  });

  it("[T-1111] queued, before the clock starts, shows no elapsed time rather than a wrong one", () => {
    const html = render({ kind: "queued", retrying: false }, null);
    expect(html).toContain("Queued");
    expect(html).not.toContain("elapsed");
  });

  it("[T-1111] done: the job's counts with glyphs and names, and Open the report", () => {
    const html = render({ kind: "done", ...counts }, "1 minute", true);
    expect(html).toContain('data-check-terminal="done"');
    expect(html).toContain("4 result sets");
    for (const s of ["clear", "action", "not_assessed"]) expect(html).toContain(`data-glyph="${s}"`);
    // A clear label says nothing about registration (CLAUDE.md 8, the report's wording since #85): never a bare Clear.
    expect(html).toContain("Label clear");
    expect(html).not.toMatch(/<\/span>Clear</);
    expect(html).not.toContain('data-glyph="blocked"');
    expect(html).toContain(`href="/w/${WS}/products/${PR}/report"`);
    expect(html).toContain("OPENING THE REPORT");
    expect(html).not.toContain("1 minute"); // the clock is the running card's; a finished job's duration is not read
    expect(html).not.toContain("In progress is neutral");
  });

  it("[D04.must.1] withheld: every result Not assessed, linked to the report's reasons, and nothing reads Clear", () => {
    const html = render({ kind: "withheld", checks: 2, clear: 0, action: 0, notAssessed: 2, again: false });
    expect(html).toContain('data-check-terminal="withheld"');
    expect(html).toContain("Withheld · nothing could be assessed");
    expect(html).toContain("Nothing is Clear.");
    expect(html).toContain(">Open the report<");
    expect(html).not.toContain("OPENING THE REPORT");
    // It names no cause: a result is withheld for a coverage gap, an unavailable model or an unreadable panel, and the
    // report gives each one's reason.
    expect(html).not.toMatch(/encoded|model|coverage gap/i);
  });

  it("[D04.must.1] withheld with no result set written says so, not \"0 result sets, every one\"", () => {
    const html = render({ kind: "withheld", checks: 0, clear: 0, action: 0, notAssessed: 0, again: false });
    expect(html).toContain("No result set was written");
    expect(html).not.toContain("0 result sets");
  });

  it("[D04.fail.1] failed: what did not happen, and the way back to run it again", () => {
    const html = render({ kind: "failed", reason: "The ruleset this check was pinned to is not released, so nothing was assessed. Run the check again." });
    expect(html).toContain("The check did not finish");
    expect(html).toContain("not released");
    expect(html).toContain(`href="/w/${WS}/products/${PR}/check"`);
    expect(html).not.toContain("Open the report");
  });

  it("[T-1111] stalled and unreadable: said, with Check again, never an endless spinner", () => {
    expect(render({ kind: "stalled" })).toContain("This is taking longer than usual");
    expect(render({ kind: "stalled" })).toContain(">Check again<");
    expect(render({ kind: "unreadable" })).toContain("Progress cannot be read just now");
  });
});
