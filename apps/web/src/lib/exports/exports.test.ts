import { describe, expect, it } from "vitest";
import { EXPORT_TTL_S, archivePath, exportState, formatBytes, type ExportJobRow } from "./exports";

const WS = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

function row(over: Partial<ExportJobRow> = {}): ExportJobRow {
  return {
    id: "job-1",
    status: "succeeded",
    progress: { stage: "ready", path: `${WS}/job-1.zip`, bytes: 2048 },
    last_error: null,
    created_at: "2026-10-24T10:00:00.000Z",
    updated_at: "2026-10-24T10:05:00.000Z",
    ...over,
  };
}

const NOW = new Date("2026-10-25T00:00:00.000Z");

describe("[O03.main] export state", () => {
  it("is none before the first request", () => {
    expect(exportState(null, WS, NOW)).toEqual({ kind: "none" });
  });

  it("is preparing while the job is queued or running", () => {
    for (const status of ["queued", "running"]) {
      expect(exportState(row({ status, progress: {} }), WS, NOW)).toMatchObject({ kind: "preparing", jobId: "job-1" });
    }
  });

  it("is ready for seven days after the archive was written", () => {
    expect(exportState(row(), WS, NOW)).toEqual({
      kind: "ready",
      jobId: "job-1",
      readyAt: "2026-10-24T10:05:00.000Z",
      expiresAt: new Date(Date.parse("2026-10-24T10:05:00.000Z") + EXPORT_TTL_S * 1000).toISOString(),
      bytes: 2048,
    });
    expect(exportState(row(), WS, new Date("2026-10-31T10:05:00.000Z"))).toMatchObject({ kind: "expired" });
  });

  it("never offers an archive outside the workspace's folder, or a failed job, as a download", () => {
    expect(exportState(row({ progress: { path: `${OTHER}/job-1.zip` } }), WS, NOW)).toMatchObject({ kind: "failed" });
    expect(exportState(row({ progress: { path: `${WS}/../${OTHER}/x.zip` } }), WS, NOW)).toMatchObject({ kind: "failed" });
    expect(exportState(row({ status: "failed", progress: {} }), WS, NOW)).toMatchObject({ kind: "failed" });
    expect(exportState(row({ status: "cancelled" }), WS, NOW)).toMatchObject({ kind: "failed" });
  });

  it("reads the path only from progress, never a URL", () => {
    expect(archivePath(row(), WS)).toBe(`${WS}/job-1.zip`);
    expect(archivePath(row({ progress: null }), WS)).toBeNull();
  });
});

describe("formatBytes", () => {
  it("rounds to a readable unit", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
