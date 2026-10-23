import { ScreenPlaceholder } from "@/components/shell";

// S-NV2-008 (spec/screens.yaml): built by a later task; until then the shell and a neutral placeholder.
export default function Page() {
  return <ScreenPlaceholder route="/w/[workspace]/obligations" />;
}
