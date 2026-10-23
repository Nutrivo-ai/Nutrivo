import { ScreenPlaceholder } from "@/components/shell";

// S-NV2-007 · S-MOB-003 (spec/screens.yaml): built by a later task; until then the shell and a neutral placeholder.
export default function Page() {
  return <ScreenPlaceholder route="/w/[workspace]/products/[product]/nodes/[node]" />;
}
