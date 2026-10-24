import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/observability/request-id";
import { signInHref } from "@/lib/auth/rules";

// Every request: a request id (docs/17), and the Supabase session kept fresh in its cookies (@supabase/ssr), so
// Server Components, which cannot write cookies, always read a live session. A workspace route without a session
// goes to /sign-in and comes back afterwards (T-103).
export async function proxy(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  const headers = new Headers(request.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  let response = NextResponse.next({ request: { headers } });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && key && !request.nextUrl.pathname.startsWith("/api/") && !request.nextUrl.pathname.startsWith("/kit")) {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers } });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });
    // getUser() asks Supabase Auth, so a revoked session (A07 step 2, A06) stops here rather than at its expiry.
    const { data } = await supabase.auth.getUser();
    const path = request.nextUrl.pathname;
    if (!data.user && (path === "/w" || path.startsWith("/w/"))) {
      const target = new URL(signInHref(path + request.nextUrl.search), request.url);
      const redirect = NextResponse.redirect(target);
      response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
      redirect.headers.set(REQUEST_ID_HEADER, requestId);
      return redirect;
    }
  }

  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
