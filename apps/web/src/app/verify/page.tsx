import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { VerifyPage } from "@/components/verify/VerifyScreen";
import { normaliseRef } from "@/lib/public/verify";

// S-NV2-027's form before a reference is entered. The form submits here (GET ?ref=), and the answer lives at
// /verify/<ref>, the address a report's reader is given.
export const metadata: Metadata = { title: "Verify a reference · Nutrivo", referrer: "no-referrer" };

type Search = Promise<{ ref?: string | string[] }>;

export default function VerifyFormPage({ searchParams }: { searchParams: Search }) {
  return (
    <Suspense fallback={<VerifyPage reference="" />}>
      <Form searchParams={searchParams} />
    </Suspense>
  );
}

async function Form({ searchParams }: { searchParams: Search }) {
  const reference = normaliseRef((await searchParams).ref);
  if (reference) redirect(`/verify/${encodeURIComponent(reference)}`);
  return <VerifyPage reference="" />;
}
