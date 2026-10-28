import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SEGMENT_CONTENT, segmentBySlug } from "@/components/public/segments/content";
import { SegmentPage } from "@/components/public/segments/SegmentPage";

// S-SEG-001…005: one statically rendered page per segment (design/public/Nutrivo Segment Pages.dc.html). Any other slug
// is a 404. With Partial Prefetching an unlisted slug would first be answered with the App Shell (200) while it renders
// in the background; 'navigation' makes that first request wait for the complete result, so notFound() sets the status.
export const ensureStatic = "navigation";

export function generateStaticParams() {
  return SEGMENT_CONTENT.map((seg) => ({ segment: seg.slug }));
}

export async function generateMetadata({ params }: PageProps<"/for/[segment]">): Promise<Metadata> {
  const seg = segmentBySlug((await params).segment);
  return seg ? { title: `${seg.tab} · Nutrivo` } : {};
}

export default async function SegmentRoute({ params }: PageProps<"/for/[segment]">) {
  const seg = segmentBySlug((await params).segment);
  if (!seg) notFound();
  return <SegmentPage seg={seg} />;
}
