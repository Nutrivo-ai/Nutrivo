// stripe-webhook Edge Function (T-702): the Deno wiring for webhook.js. Stripe sends no Supabase JWT, so
// supabase/config.toml sets verify_jwt = false for this function; Stripe's signature is what is verified.
// STRIPE_WEBHOOK_SECRET is the endpoint's signing secret; SENTRY_DSN_FUNCTIONS, NUTRIVO_ENV and NUTRIVO_RELEASE come
// with it (scripts/deploy/function-secrets.sh, config/secrets.yaml); SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
// provided by the platform.
//
// Sentry (docs/17, project nutrivo-functions, EU region D-17) receives only the failures Stripe will retry, as a
// message with the event id, type and outcome as tags: no default integrations (no breadcrumbs of console or fetch),
// no request, no user, no payload (the Deno SDK sends no PII by default).
import * as Sentry from "npm:@sentry/deno@11.9.0";
import { makeHandler } from "./webhook.js";

const dsn = Deno.env.get("SENTRY_DSN_FUNCTIONS") ?? "";
if (dsn) {
  Sentry.init({
    dsn,
    environment: Deno.env.get("NUTRIVO_ENV") ?? "unknown",
    release: Deno.env.get("NUTRIVO_RELEASE") || undefined,
    defaultIntegrations: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      delete event.request;
      delete event.user;
      delete event.extra;
      event.breadcrumbs = [];
      return event;
    },
  });
}

async function report(line: Record<string, unknown>): Promise<void> {
  if (!dsn) return;
  Sentry.withScope((scope) => {
    for (const [key, value] of Object.entries(line)) {
      if (value !== null && value !== undefined) scope.setTag(key, String(value));
    }
    Sentry.captureMessage(`stripe-webhook ${String(line.outcome)}`, "error");
  });
  await Sentry.flush(2000);
}

Deno.serve(makeHandler({
  secret: Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "",
  supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
  serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  report,
}));
