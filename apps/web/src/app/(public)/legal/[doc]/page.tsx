import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LegalPage } from "@/components/public/legal/LegalPage";
import { LEGAL_DOCS, LEGAL_ORDER, isLegalKey } from "@/components/public/legal";

// S-LGL-001 /legal/terms, S-LGL-002 /legal/dpa, S-LGL-003 /legal/privacy (T-603). Drafts pending Swedish counsel
// (spec/screens.yaml, D-20): each page keeps the design's draft banner and is never indexed (plan on issue #60).
// With cacheComponents, generateStaticParams prerenders the three documents. Any other doc is a 404: without
// ensureStatic = 'navigation' the first request for an unlisted doc would stream the route's fallback shell with a 200
// before notFound() ran (next/dist/docs: route-segment-config/ensureStatic, functions/not-found). 'navigation' makes
// that request wait for the complete render, so notFound() runs before anything is sent.
export const ensureStatic = "navigation";

export function generateStaticParams() {
  return LEGAL_ORDER.map((doc) => ({ doc }));
}

export async function generateMetadata({ params }: PageProps<"/legal/[doc]">): Promise<Metadata> {
  const { doc } = await params;
  if (!isLegalKey(doc)) notFound();
  return {
    title: `${LEGAL_DOCS[doc].title} · Nutrivo`,
    robots: { index: false, follow: false },
  };
}

export default async function LegalDocPage({ params }: PageProps<"/legal/[doc]">) {
  const { doc } = await params;
  if (!isLegalKey(doc)) notFound();
  return <LegalPage doc={doc} />;
}
