import { describe, expect, it } from "vitest";
import { describeJob, safeReason, type JobRow } from "./progress";

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
    expect(view).toEqual({ phase: "failed", reason: "The file never reached storage. Upload it again." });
    expect(safeReason("RuntimeError")).toMatch(/after its retries/);
  });
});
