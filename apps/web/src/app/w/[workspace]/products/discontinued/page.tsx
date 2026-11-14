import { Discontinued } from "@/components/products/Discontinued";
import { Screen } from "@/components/shell";
import { readDiscontinued } from "@/lib/products/queries";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Discontinued · Nutrivo" };

// S-NV2-023 Discontinued (spec/screens.yaml), T-401, C04: discontinued products, read under RLS, never deleted.
export default async function Page({ params }: PageProps<"/w/[workspace]/products/discontinued">) {
  const { workspace } = await params;
  const db = await createClient();
  const { rows, total } = await readDiscontinued(db, workspace);
  return (
    <Screen route="/w/[workspace]/products/discontinued" crumb="Portfolio · Discontinued" title="Discontinued products">
      <Discontinued workspaceId={workspace} rows={rows} total={total} />
    </Screen>
  );
}
