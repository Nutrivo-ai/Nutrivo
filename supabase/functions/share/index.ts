// share Edge Function (T-604, I02, D-30): the Deno wiring for share.js. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
// provided by the platform; the service role is needed because app.open_share is executable by the service role only,
// and it stays here, never in the web server (D-30). SENTRY_DSN_FUNCTIONS, NUTRIVO_ENV and NUTRIVO_RELEASE are the
// project's function secrets (scripts/deploy/function-secrets.sh, config/secrets.yaml). JWT verification stays on; the
// web page /share/[token] presents the anon key, as /verify/[ref] does for `verify`.
//
// Sentry (docs/17, project nutrivo-functions, EU region D-17) receives only the failures (misconfigured, database or
// Storage unreachable, erroring or answering in an unexpected shape), as a message with the outcome and request id as
// tags: no default integrations, no request, no user, no payload, so the token never reaches it.
import * as Sentry from "npm:@sentry/deno@11.9.0";
import { makeHandler } from "./share.js";

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
    Sentry.captureMessage(`share ${String(line.outcome)}`, "error");
  });
  await Sentry.flush(2000);
}

Deno.serve(makeHandler({
  supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
  serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  report,
}));
