import { NextResponse, type NextRequest } from "next/server";
import { landingPath, sessionGate } from "@/lib/auth/session";
import { safeNext, signInHref } from "@/lib/auth/rules";
import { createClient } from "@/lib/supabase/server";

// Where a signed-in person goes when no page was asked for: past two-step when it is required, then their first
// workspace. Signed out, it is /sign-in.
export async function GET(request: NextRequest) {
  const to = (path: string) => NextResponse.redirect(new URL(path, request.url));
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return to(signInHref());
  if ((await sessionGate(supabase, data.user.id)) !== "ok") return to("/auth/mfa");
  return to(safeNext(request.nextUrl.searchParams.get("next"), await landingPath(supabase, data.user.id)));
}
