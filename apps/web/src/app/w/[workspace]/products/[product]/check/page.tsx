import { ScreenPlaceholder } from "@/components/shell";

// S-NV2-002 · S-PLN-004 · S-PLN-005 (spec/screens.yaml): built by a later task; until then the shell and a neutral placeholder.
export default function Page() {
  return <ScreenPlaceholder route="/w/[workspace]/products/[product]/check" />;
}
