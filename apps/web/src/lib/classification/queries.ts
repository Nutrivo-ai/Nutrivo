// D03 (T-402): the product's latest classification, under the person's own session (RLS). Insert-only: the latest row
// is the classification (docs/03), exactly as app.request_check picks it.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { ShellReadError } from "@/lib/workspace/memberships";
import type { ClassificationRow } from "./describe";

type Db = SupabaseClient<Database>;

export async function readClassification(db: Db, productId: string): Promise<ClassificationRow | null> {
  const { data, error } = await db
    .schema("app")
    .from("classifications")
    .select("id, species, life_stage, product_class, intended_use, parnut_status, citation, provenance, confirmed_at, created_at")
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new ShellReadError("classification", error);
  return data;
}
