// Reads for the upload (S-NV2-002) and artwork (S-NV2-025) screens, under the person's own session (RLS): a product,
// artwork or run in another workspace reads exactly like one that does not exist.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { ShellReadError } from "@/lib/workspace/memberships";

type Db = SupabaseClient<Database>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string) => UUID.test(v);

export type ProductSummary = { id: string; name: string; workspaceId: string };

export type RunSummary = {
  id: string;
  status: "queued" | "running" | "succeeded" | "partial" | "failed";
  failureCodes: string[];
  engineVersion: string;
  finishedAt: string | null;
};

export type ArtworkSummary = {
  id: string;
  version: number;
  fileName: string | null;
  mimeType: string | null;
  sha256: string;
  pageCount: number | null;
  pageSizeMm: number[] | null;
  createdAt: string;
  run: RunSummary | null;
};

export type PanelRow = {
  id: string;
  page: number;
  index: number;
  language: string | null;
  status: "extracted" | "not_assessable";
  failureCode: string | null;
  textObjects: number;
};

export async function readProduct(db: Db, workspaceId: string, productId: string): Promise<ProductSummary | null> {
  if (!isUuid(productId)) return null;
  const { data, error } = await db
    .schema("app")
    .from("products")
    .select("id, name, workspace_id")
    .eq("id", productId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new ShellReadError("product", error);
  return data ? { id: data.id, name: data.name, workspaceId: data.workspace_id } : null;
}

const ARTWORK_COLUMNS =
  "id, version, file_name, mime_type, file_sha256, page_count, page_size_mm, created_at, " +
  "extraction_runs(id, status, failure_codes, engine_version, finished_at, created_at)";

type ArtworkRow = {
  id: string;
  version: number;
  file_name: string | null;
  mime_type: string | null;
  file_sha256: string;
  page_count: number | null;
  page_size_mm: number[] | null;
  created_at: string;
  extraction_runs: {
    id: string;
    status: RunSummary["status"];
    failure_codes: string[];
    engine_version: string;
    finished_at: string | null;
    created_at: string;
  }[];
};

function toSummary(row: ArtworkRow): ArtworkSummary {
  const run = [...row.extraction_runs].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return {
    id: row.id,
    version: row.version,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sha256: row.file_sha256,
    pageCount: row.page_count,
    pageSizeMm: row.page_size_mm,
    createdAt: row.created_at,
    run: run
      ? {
          id: run.id,
          status: run.status,
          failureCodes: run.failure_codes,
          engineVersion: run.engine_version,
          finishedAt: run.finished_at,
        }
      : null,
  };
}

/** The product's latest artwork version and its latest extraction run, or null before the first upload. */
export async function readLatestArtwork(db: Db, productId: string): Promise<ArtworkSummary | null> {
  const { data, error } = await db
    .schema("app")
    .from("artwork_versions")
    .select(ARTWORK_COLUMNS)
    .eq("product_id", productId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new ShellReadError("artwork", error);
  return data ? toSummary(data as unknown as ArtworkRow) : null;
}

export async function readArtwork(db: Db, productId: string, artworkId: string): Promise<ArtworkSummary | null> {
  if (!isUuid(artworkId)) return null;
  const { data, error } = await db
    .schema("app")
    .from("artwork_versions")
    .select(ARTWORK_COLUMNS)
    .eq("id", artworkId)
    .eq("product_id", productId)
    .maybeSingle();
  if (error) throw new ShellReadError("artwork", error);
  return data ? toSummary(data as unknown as ArtworkRow) : null;
}

/** One row per printed panel of a run, in panel order, with how many text objects each carries. */
export async function readPanels(db: Db, runId: string): Promise<PanelRow[]> {
  const { data, error } = await db
    .schema("app")
    .from("artwork_panels")
    .select("id, page, panel_index, language, status, failure_code, text_objects(count)")
    .eq("extraction_run_id", runId)
    .order("panel_index");
  if (error) throw new ShellReadError("panels", error);
  return (data ?? []).map((p) => ({
    id: p.id,
    page: p.page,
    index: p.panel_index,
    language: p.language,
    status: p.status as PanelRow["status"],
    failureCode: p.failure_code,
    textObjects: (p.text_objects as unknown as { count: number }[])[0]?.count ?? 0,
  }));
}
