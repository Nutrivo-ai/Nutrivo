import { describe, expect, it } from "vitest";
import { describeJob, safeReason, type JobRow } from "./progress";
import { visibleFor } from "@/lib/jobs/watch";

const row = (over: Partial<JobRow>): JobRow => ({ id: "j", status: "queued", progress: {}, last_error: null, attempts: 0, ...over });

describe("extraction progress from app.jobs", () => {
  it("queued, retrying, running by stage, then done with the run's counts", () => {
    expect(describeJob(null)).toEqual({ phase: "waiting" });
    expect(describeJob(row({}))).toEqual({ phase: "queued", retrying: false });
    expect(describeJob(row({ attempts: 1 }))).toEqual({ phase: "queued", retrying: true });
    expect(describeJob(row({ status: "running", progress: { stage: "extracting" } }))).toMatchObject({ phase: "running", stage: "extracting" });
    expect(describeJob(row({ status: "running", progress: { stage: "<script>" } }))).toMatchObject({ stage: "reading" });
    expect(
      describeJob(row({ status: "succeeded", progress: { stage: "done", status: "partial", panels: 9, panels_extracted: 6, failure_codes: ["outlined_text"] } })),
    ).toEqual({ phase: "done", status: "partial", panels: 9, extracted: 6, failureCodes: ["outlined_text"] });
  });

  it("a failed job is a visible terminal state that never shows the raw error", () => {
    const view = describeJob(row({ status: "failed", last_error: "PermanentJobError: artwork version x: the file is missing from storage" }));
    expect(view).toMatchObject({ phase: "failed", reason: expect.stringContaining("The file never reached storage") });
    for (const err of [null, "RuntimeError", "PermanentJobError: x: the stored file does not match its registered hash"]) {
      const reason = safeReason(err);
      expect(reason).not.toMatch(/PermanentJobError|RuntimeError/);
      // The same bytes register as the same version with the same failed job: never offer to upload them again.
      expect(reason).not.toMatch(/upload (it|the file) again/i);
    }
  });
});

describe("the job shown belongs to the artwork being extracted", () => {
  it("a second upload in the same visit never shows the first upload's finished job", () => {
    const first = row({ id: "job-1", status: "succeeded", progress: { status: "succeeded", panels: 3, panels_extracted: 3 } });
    const state = { ref: "key:extract:av-1", generation: 0, row: first, error: false, live: true, stalled: false };
    expect(visibleFor(state, "key:extract:av-1", 0).row).toBe(first);
    expect(visibleFor(state, "key:extract:av-2", 0)).toEqual({ row: null, error: false, live: false, stalled: false });
    expect(describeJob(visibleFor(state, "key:extract:av-2", 0).row)).toEqual({ phase: "waiting" });
    expect(visibleFor({ ...state, row: null, error: true }, "key:extract:av-2", 0).error).toBe(false);
  });

  it("[T-305] after a retry the failed state read before it never shows again", () => {
    const failed = row({ id: "job-1", status: "failed", last_error: "x" });
    const state = { ref: "key:extract:av-1", generation: 0, row: failed, error: false, live: true, stalled: false };
    expect(describeJob(visibleFor(state, "key:extract:av-1", 1).row)).toEqual({ phase: "waiting" });
  });
});
