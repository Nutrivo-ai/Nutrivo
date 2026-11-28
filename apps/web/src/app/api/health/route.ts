import { connection, NextResponse } from "next/server";

// Liveness for scripts/ci/e2e.sh and the staging smoke tests; touches no service and returns no secrets. Rendered per
// request (connection()), never prerendered: a liveness answer from the CDN would not show the function is up, and the
// load test's web_floor would leave out the hop to fra1 (issue 348).
export async function GET() {
  await connection();
  return NextResponse.json({ status: "ok", release: process.env.NEXT_PUBLIC_SENTRY_RELEASE ?? null });
}
