import type { Breadcrumb, ErrorEvent, init } from "@sentry/nextjs";

// @sentry/nextjs 11 does not export TransactionEvent; take it from the init options.
type SentryOptions = NonNullable<Parameters<typeof init>[0]>;
export type TransactionEvent = Parameters<NonNullable<SentryOptions["beforeSendTransaction"]>>[0];

// docs/17: send_default_pii off, a before_send scrubber for emails and tokens, environment per deployment,
// release = git SHA, traces 1.0 in staging and 0.2 in production. Without a DSN the SDK stays disabled.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BEARER = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const SECRET_PARAM = /([?&](?:token|access_token|refresh_token|code|apikey|key)=)[^&#\s]+/gi;
const SENSITIVE_KEY = /authorization|cookie|token|secret|password|apikey|api_key/i;
// A04, I02 and H03: invitation, share and supplier-link tokens are bearer secrets carried in the path
// (/invite/<token>, /share/<token>, /supplier/<token>), also URL-encoded inside a next= parameter
// (%2Finvite%2F<token>). Path segments are not query parameters, so SECRET_PARAM misses them.
const TOKEN_PATH = /(\/(?:invite|share|supplier)\/|%2F(?:invite|share|supplier)%2F)[^/?#&\s"']+/gi;

export function scrubString(value: string): string {
  return value
    .replace(JWT, "[jwt]")
    .replace(BEARER, "$1 [token]")
    .replace(SECRET_PARAM, "$1[redacted]")
    .replace(TOKEN_PATH, "$1[token]")
    .replace(EMAIL, "[email]");
}

function scrub(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return scrubString(value);
  if (depth > 8 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? "[redacted]" : scrub(v, depth + 1)]),
  );
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const { user, ...rest } = event;
  const scrubbed = scrub(rest) as ErrorEvent;
  // Only an opaque id may stay on the user; never an email, name or IP address.
  return user?.id ? { ...scrubbed, user: { id: String(user.id) } } : scrubbed;
}

// T-1103: P0049 is the database's rate limit on RPCs that queue work. It is an expected refusal the person is told
// about, never an error; the call sites skip it, and this drops any event that still carries the code as its error
// code (a tag or extra named code/error_code) or as a whole word in its message or exception values. Nothing else
// is dropped.
const RATE_LIMITED = /\bP0049\b/;
const CODE_KEYS = ["code", "error_code"] as const;

export function isRateLimitEvent(event: ErrorEvent): boolean {
  for (const bag of [event.tags, event.extra] as (Record<string, unknown> | undefined)[]) {
    if (bag && CODE_KEYS.some((k) => bag[k] === "P0049")) return true;
  }
  if (typeof event.message === "string" && RATE_LIMITED.test(event.message)) return true;
  return (event.exception?.values ?? []).some((v) => typeof v.value === "string" && RATE_LIMITED.test(v.value));
}

/** beforeSend: drop a rate-limit refusal, scrub everything else. */
export function beforeSend(event: ErrorEvent): ErrorEvent | null {
  return isRateLimitEvent(event) ? null : scrubEvent(event);
}

// Transactions and breadcrumbs carry URLs too (the request URL, span descriptions, navigation from/to), so they get
// the same scrubber as errors.
export function scrubTransaction(event: TransactionEvent): TransactionEvent {
  return scrubEvent(event as unknown as ErrorEvent) as unknown as TransactionEvent;
}

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  return scrub(breadcrumb) as Breadcrumb;
}

export function tracesSampleRate(environment: string): number {
  return environment === "prod" ? 0.2 : 1.0;
}

export function sentryOptions(dsn: string | undefined, environment: string | undefined, release: string | undefined) {
  const env = environment || "dev";
  return {
    dsn,
    enabled: Boolean(dsn),
    environment: env,
    release: release || undefined,
    sendDefaultPii: false,
    tracesSampleRate: tracesSampleRate(env),
    beforeSend,
    beforeSendTransaction: scrubTransaction,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}
