import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { EXPIRED_LINK, RESET_AFTER_MFA, callbackFailure, linkType, needsStepUp, safeNext } from "@/lib/auth/rules";
import { sessionGate } from "@/lib/auth/session";
import { REQUEST_ID_HEADER } from "@/lib/observability/request-id";
import { createClient } from "@/lib/supabase/server";

// Every email link returns here: signup confirmation, sign-in link, password reset, email change. Supabase Auth sends
// either a PKCE code or a token hash; both become a session in this browser. An expired, used or malformed link goes
// to the recovery page, which offers a fresh one (A07.fail.1). Nothing from the link is logged.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const to = (path: string) => NextResponse.redirect(new URL(path, request.url));
  const failed = callbackFailure(params);
  if (failed) return to(failed);

  const next = safeNext(params.get("next"));
  const supabase = await createClient();
  const code = params.get("code");
  const type = linkType(params.get("type"));
  if (!code && !type) return to(EXPIRED_LINK);
  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({ token_hash: params.get("token_hash")!, type: type! });
  if (error) {
    if (!error.status || error.status >= 500) {
      Sentry.captureMessage(`auth callback failed: ${error.code ?? "unknown"}`, {
        level: "error",
        tags: { area: "auth", auth_step: "callback", request_id: request.headers.get(REQUEST_ID_HEADER) ?? undefined },
      });
    }
    return to(EXPIRED_LINK);
  }
  // A reset link signs the person in only to choose a new password, at aal1: two-step comes first when they have it.
  if (type === "recovery" || next === "/auth/reset") {
    const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    return to(level && needsStepUp(level) ? RESET_AFTER_MFA : "/auth/reset");
  }

  const { data } = await supabase.auth.getUser();
  if (!data.user) return to(EXPIRED_LINK);
  const gate = await sessionGate(supabase, data.user.id);
  return to(gate === "ok" ? next : `/auth/mfa?next=${encodeURIComponent(next)}`);
}
