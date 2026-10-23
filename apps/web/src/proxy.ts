import { NextResponse, type NextRequest } from "next/server";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/observability/request-id";

export function proxy(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  const headers = new Headers(request.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
