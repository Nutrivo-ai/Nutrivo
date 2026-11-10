import type { Metadata } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { SupplierLoading, SupplierPage, SupplierRequest } from "@/components/supplier/SupplierPortal";
import { REQUEST_ID_HEADER } from "@/lib/observability/request-id";
import { describeRequest } from "@/lib/public/supplier";
import { visitorOf } from "@/lib/public/verify";

// S-NV2-028 Supplier portal (H03, T-802): a supplier with no account opens the link from the email and uploads the one
// document asked for, through the `supplier-upload` Edge Function only. No session, nothing read under a user. Read at
// request time: a link can be used or expire at any moment.
export const metadata: Metadata = {
  title: "Upload a requested document · Nutrivo",
  // The link is a bearer token: keep it out of search indexes and out of the Referer of any link followed.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function SupplierLinkPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <SupplierPage>
      <Suspense fallback={<SupplierLoading />}>
        <Request params={params} />
      </Suspense>
    </SupplierPage>
  );
}

async function Request({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const token = (await params).token;
  const h = await headers();
  const outcome = await describeRequest(token, { requestId: h.get(REQUEST_ID_HEADER), visitor: visitorOf(h) });
  return <SupplierRequest token={token} outcome={outcome} />;
}
