import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";

// Browser client under the user's session: reads go through RLS, writes only through app RPCs (.claude/rules/web.md).
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
