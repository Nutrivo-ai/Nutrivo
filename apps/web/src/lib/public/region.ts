/**
 * The Supabase Edge Function region the app asks for (x-region): the database's, eu-central-1 (D-02, non-negotiable
 * 10). Without it the platform runs a function in the region nearest the caller, and every database read crosses to
 * Frankfurt (issue 311). No imports, so the load test can share it.
 */
export const FUNCTION_REGION = "eu-central-1";
