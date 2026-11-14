// T-1103: the RPCs that queue work are rate limited in the database. A refusal is PostgREST code P0049, message
// "too many <kind> requests: try again later", and a hint holding JSON {"kind": "<job kind>", "retry_after_s": <n>}.
// Nothing was queued when it happens. This is an expected refusal, never an error for Sentry.

export const RATE_LIMIT_CODE = "P0049";

export type RpcErrorLike = { code?: string | null; hint?: string | null };
type MaybeError = RpcErrorLike | null | undefined;

/** A mapper's input: the PostgREST error itself (so the hint is available) or just its code. */
export function asRpcError(input: string | RpcErrorLike | null | undefined): RpcErrorLike | undefined {
  if (input == null) return undefined;
  return typeof input === "string" ? { code: input } : input;
}

export function isRateLimited(error: MaybeError): boolean {
  return !!error && error.code === RATE_LIMIT_CODE;
}

/** Seconds until the limit lifts, from the hint's JSON; null when the hint is missing, malformed or not a usable number. */
export function retryAfterSeconds(error: MaybeError): number | null {
  const hint = error?.hint;
  if (typeof hint !== "string" || hint === "") return null;
  try {
    const parsed: unknown = JSON.parse(hint);
    if (!parsed || typeof parsed !== "object") return null;
    const s = (parsed as { retry_after_s?: unknown }).retry_after_s;
    return typeof s === "number" && Number.isFinite(s) && s >= 0 ? s : null;
  } catch {
    return null;
  }
}

/** "1 minute", "N minutes" or "a few minutes". */
export function retryWait(error: MaybeError): string {
  const s = retryAfterSeconds(error);
  if (s === null) return "a few minutes";
  const minutes = Math.max(1, Math.ceil(s / 60));
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

export type RateLimitMessage = { title: string; body: string };

/** What the person sees. `nothingQueued` is the surrounding copy's own sentence (e.g. "Nothing was run and nothing was counted."). */
export function rateLimitMessage(error: MaybeError, nothingQueued?: string): RateLimitMessage {
  const body = `Too many requests; try again in ${retryWait(error)}.`;
  return { title: "Too many requests", body: nothingQueued ? `${body} ${nothingQueued}` : body };
}
