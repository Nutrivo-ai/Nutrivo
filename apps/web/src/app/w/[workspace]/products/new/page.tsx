import { AddProduct } from "@/components/products/AddProduct";
import { Screen } from "@/components/shell";
import { readAddProductData } from "@/lib/products/queries";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Add a product · Nutrivo" };

// S-NV2-022 Add a product (spec/screens.yaml), T-401: C01 creates a product and its family, C03 adds a variant to a
// family (`?family=<id>`), and the label-file card creates a product from an artwork (C02, #43 Q3). Writes go only
// through app.create_product and app.create_product_from_artwork.
export default async function Page({ params, searchParams }: PageProps<"/w/[workspace]/products/new">) {
  const { workspace } = await params;
  const query = await searchParams;
  const family = typeof query.family === "string" ? query.family : null;
  const db = await createClient();
  const data = await readAddProductData(db, workspace);
  return (
    <Screen route="/w/[workspace]/products/new" crumb="Portfolio · New product">
      <AddProduct workspaceId={workspace} data={data} initialFamily={family} />
    </Screen>
  );
}
