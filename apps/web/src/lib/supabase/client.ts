import { createBrowserClient } from "@supabase/ssr";

// Browser client under the user's session: reads go through RLS, writes only through app RPCs (.claude/rules/web.md).
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
