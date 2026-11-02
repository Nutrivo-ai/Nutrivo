// stripe-webhook Edge Function (T-702): the Deno wiring for webhook.js. Stripe sends no Supabase JWT, so
// supabase/config.toml sets verify_jwt = false for this function; Stripe's signature is what is verified.
// STRIPE_WEBHOOK_SECRET is the endpoint's signing secret (config/secrets.yaml); SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
import { makeHandler } from "./webhook.js";

Deno.serve(makeHandler({
  secret: Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "",
  supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
  serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
}));
