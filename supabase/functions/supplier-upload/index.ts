// supplier-upload Edge Function (T-802, H03): the Deno wiring for upload.js. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
// are provided by the platform; APP_BASE_URL (config/secrets.yaml) is the only origin the portal page calls from, and
// "*" when it is not set (the function takes no cookies: the token in the body is the only credential). JWT
// verification stays on; the portal page presents the anon key.
import { makeHandler } from "./upload.js";

Deno.serve(makeHandler({
  supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
  serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  allowedOrigin: Deno.env.get("APP_BASE_URL") ?? "*",
}));
