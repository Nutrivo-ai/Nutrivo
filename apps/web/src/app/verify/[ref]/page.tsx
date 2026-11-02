import type { Metadata } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { VerifyLoading, VerifyPage, VerifyResult } from "@/components/verify/VerifyScreen";
import { REQUEST_ID_HEADER } from "@/lib/observability/request-id";
import { normaliseRef, verifyReference, visitorOf } from "@/lib/public/verify";

// S-NV2-027 (I04): anyone holding a reference reads whether Nutrivo issued it, through the `verify` Edge Function only.
// No account, no session: the page reads nothing under a user and nothing about the workspace. Read at request time:
// a document can become superseded at any moment.
export const metadata: Metadata = {
  title: "Verify a reference · Nutrivo",
  // A reference is a bearer of sorts: keep it out of search indexes and out of the Referer of any link followed.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function VerifyReferencePage({ params }: { params: Promise<{ ref: string }> }) {
  return (
    <Suspense
      fallback={
        <VerifyPage reference="">
          <VerifyLoading />
        </VerifyPage>
      }
    >
      <Verify params={params} />
    </Suspense>
  );
}

async function Verify({ params }: { params: Promise<{ ref: string }> }) {
  const reference = normaliseRef((await params).ref);
  return (
    <VerifyPage reference={reference}>
      <Suspense fallback={<VerifyLoading />}>
        <Answer reference={reference} />
      </Suspense>
    </VerifyPage>
  );
}

async function Answer({ reference }: { reference: string }) {
  await connection();
  const h = await headers();
  const outcome = await verifyReference(reference, { requestId: h.get(REQUEST_ID_HEADER), visitor: visitorOf(h) });
  return <VerifyResult reference={reference} outcome={outcome} />;
}
