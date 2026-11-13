import { ScreenPlaceholder } from "@/components/shell";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Settings & roles · Nutrivo" };

// S-NV2-017 (spec/screens.yaml): built by a later task; until then the shell and a neutral placeholder.
export default function Page() {
  return <ScreenPlaceholder route="/w/[workspace]/settings" />;
}
