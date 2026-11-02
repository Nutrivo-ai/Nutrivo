// verify Edge Function (T-406, I04): the Deno wiring for verify.js. SUPABASE_URL and SUPABASE_ANON_KEY are provided by
// the platform. The anon key is deliberate: anon can execute public.verify_reference and read no table (BE-28), so the
// function cannot reach tenant data even by mistake. JWT verification stays on; callers present the anon key.
import { makeHandler } from "./verify.js";

Deno.serve(makeHandler({
  supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
  anonKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
}));
