import type { ErrorEvent } from "@sentry/nextjs";

// docs/17: send_default_pii off, a before_send scrubber for emails and tokens, environment per deployment,
// release = git SHA, traces 1.0 in staging and 0.2 in production. Without a DSN the SDK stays disabled.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BEARER = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const SECRET_PARAM = /([?&](?:token|access_token|refresh_token|code|apikey|key)=)[^&#\s]+/gi;
const SENSITIVE_KEY = /authorization|cookie|token|secret|password|apikey|api_key/i;

export function scrubString(value: string): string {
  return value
    .replace(JWT, "[jwt]")
    .replace(BEARER, "$1 [token]")
    .replace(SECRET_PARAM, "$1[redacted]")
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
    beforeSend: scrubEvent,
  };
}
