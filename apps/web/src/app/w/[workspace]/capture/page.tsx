import { Capture } from "@/components/mobile/Capture";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Capture · Nutrivo" };

// S-MOB-004 Capture (spec/screens.yaml; design: product/Nutrivo Mobile.dc.html, "Photograph a pack"). Guidance only:
// no endpoint takes or compares a pack photo yet (#57 question 1), so nothing is read or written here. S-MOB-005 Read
// back waits for that answer.
export default function Page() {
  return <Capture route="/w/[workspace]/capture" />;
}
