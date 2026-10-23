import { NextResponse } from "next/server";

// Liveness for scripts/ci/e2e.sh and the staging smoke tests; touches no service and returns no secrets.
export function GET() {
  return NextResponse.json({ status: "ok", release: process.env.NEXT_PUBLIC_SENTRY_RELEASE ?? null });
}
