// The label report's read failure (T-404). Since T-1114 the report is read as Fix mode by fix-queries.ts, under the
// person's own session; a read that fails throws this, and the page shows S-FIX-011 with the response's request id.
export class ReportReadError extends Error {
  constructor(what: string, cause: { message: string; code?: string }) {
    super(`could not read the label report (${what}): ${cause.code ?? "error"} ${cause.message}`);
    this.name = "ReportReadError";
  }
}
