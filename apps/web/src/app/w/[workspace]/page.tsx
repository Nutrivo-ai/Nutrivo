import { ScreenPlaceholder } from "@/components/shell";

// S-NV2-001 · S-ONB-007 (spec/screens.yaml): built by a later task; until then the shell and a neutral placeholder.
export default function Page() {
  return <ScreenPlaceholder route="/w/[workspace]" />;
}
