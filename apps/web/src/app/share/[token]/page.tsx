import type { Metadata } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { ShareLoading, SharePage, ShareResult } from "@/components/share/ShareScreen";
import { REQUEST_ID_HEADER } from "@/lib/observability/request-id";
import { openSharedReport } from "@/lib/public/share";
import { visitorOf } from "@/lib/public/verify";

// /share/[token] (I02, D-30, T-604): the recipient of a share link reads the report's face facts and downloads its PDF,
// through the `share` Edge Function only. No account, no session: nothing is read under a user. Read at request time: a
// share can be revoked or expire at any moment, and every open is logged (app.share_access_log).
export const metadata: Metadata = {
  title: "Shared report · Nutrivo",
  // The link is a bearer token: keep it out of search indexes and out of the Referer of any link followed.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <SharePage>
      <Suspense fallback={<ShareLoading />}>
        <Answer params={params} />
      </Suspense>
    </SharePage>
  );
}

async function Answer({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const token = (await params).token;
  const h = await headers();
  const outcome = await openSharedReport(token, {
    requestId: h.get(REQUEST_ID_HEADER),
    visitor: visitorOf(h),
    userAgent: h.get("user-agent"),
  });
  return <ShareResult token={token} outcome={outcome} />;
}
