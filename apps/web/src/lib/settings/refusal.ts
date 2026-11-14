// The settings RPCs' error codes (docs/04) as the refusal a screen reads. Pure, so actions.ts and its tests share it.
// T-1103: P0049 is the database's rate limit on RPCs that queue work (an invitation email, a sign-out): an expected
// refusal with its own wait in `problem`, never an error for Sentry.
import { isRateLimited, rateLimitMessage, type RpcErrorLike } from "@/lib/rate-limit";

/** Why a write did not happen, in the RPCs' own error codes (docs/04). */
export type Refusal =
  | "no-permission" // 42501
  | "no-seat" // P0033: BE-33, then the upsell
  | "last-admin" // P0043
  | "ended" // P0044: the membership ended meanwhile
  | "accepted" // P0040 on revoke: accepted meanwhile
  | "invalid" // 22023, or refused before the call
  | "rate-limited" // P0049: too many requests (T-1103)
  | "error";

const CODES: Record<string, Refusal> = {
  "42501": "no-permission",
  P0033: "no-seat",
  P0043: "last-admin",
  P0044: "ended",
  P0040: "accepted",
  "22023": "invalid",
};

export function settingsRefusal(error: RpcErrorLike | null | undefined): { reason: Refusal; problem?: string } {
  if (isRateLimited(error)) return { reason: "rate-limited", problem: rateLimitMessage(error, "Nothing was changed.").body };
  return { reason: (error?.code && CODES[error.code]) || "error" };
}
