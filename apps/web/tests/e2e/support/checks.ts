// Seeding shared by the specs that need a checked product (T-404 report.spec, T-1112 exports-screen.spec): a product
// with its markets and a succeeded extraction of a two-panel artwork, written as the service role (test setup only), and
// a check run as an editor through app.request_check, which the worker evaluates.
import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { admin, type Person } from "./people";

export const CHECK_MS = 90_000;

// The German panel of Salmon & Rice as printed (the demo seed's, supabase/tests/app/fixtures/demo_halden.psql).
export const GERMAN: [string, number[]][] = [
  ["Alleinfuttermittel für ausgewachsene Hunde", [8, 14, 97, 22]],
  ["Für Haut und Fell", [8, 36, 60, 44]],
  ["Zusammensetzung: Lachs (26 %), Reis, Geflügelfett, Rübentrockenschnitzel, Leinsamen, Hefe", [8, 60, 97, 74]],
  ["Analytische Bestandteile", [8, 80, 62, 85]],
  ["Rohprotein 26,0 % · Rohfett 15,0 % · Rohfaser 2,4 % · Rohasche 7,1 %", [8, 86, 97, 92]],
  ["Ernährungsphysiologische Zusatzstoffe: Vitamin A 18 000 IE, Zink (Chelat) 180 mg", [8, 98, 97, 108]],
  ["Fütterungsempfehlung nach Körpergewicht. Frisches Wasser bereitstellen.", [8, 120, 97, 130]],
  ["12 kg ℮ · L2608-114 · MHD 11/2027", [8, 250, 70, 256]],
  ["Nutrivo GmbH, Musterstraße 4, 20095 Hamburg · Zul.-Nr. αDE0114", [8, 262, 97, 268]],
];

/** A product with its markets and a succeeded extraction of a two-panel artwork, as the service role writes them. */
export async function seedProduct(workspaceId: string, name: string, markets: string[]) {
  const service = admin().schema("app");
  const fam = await service.from("families").insert({ workspace_id: workspaceId, name }).select("id").single();
  if (fam.error) throw fam.error;
  const prod = await service
    .from("products")
    .insert({ workspace_id: workspaceId, family_id: fam.data.id, name, stage: "in_development" })
    .select("id")
    .single();
  if (prod.error) throw prod.error;
  const productId = prod.data.id;
  if (markets.length) {
    const nodes = await service.from("product_nodes").insert(markets.map((node_id) => ({ product_id: productId, node_id, workspace_id: workspaceId })));
    if (nodes.error) throw nodes.error;
  }
  const sha = randomUUID().replace(/-/g, "").padEnd(64, "0");
  const av = await service
    .from("artwork_versions")
    .insert({
      workspace_id: workspaceId,
      product_id: productId,
      version: 1,
      file_sha256: sha,
      storage_path: `${workspaceId}/${productId}/${sha}.pdf`,
      file_name: "SR-ADULT-12KG-v7.pdf",
      mime_type: "application/pdf",
      page_count: 1,
      is_new_artwork: true,
    })
    .select("id")
    .single();
  if (av.error) throw av.error;
  const run = await service
    .from("extraction_runs")
    .insert({
      workspace_id: workspaceId,
      product_id: productId,
      artwork_version_id: av.data.id,
      engine: "pdfium",
      engine_version: "e2e",
      idempotency_key: `e2e:${av.data.id}`,
      status: "succeeded",
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (run.error) throw run.error;
  const base = { workspace_id: workspaceId, product_id: productId, artwork_version_id: av.data.id, extraction_run_id: run.data.id };
  const panels = await service
    .from("artwork_panels")
    .insert([
      { ...base, page: 1, panel_index: 0, bbox_mm: [0, 0, 105, 297], language: "de", language_confidence: 0.99, status: "extracted" },
      { ...base, page: 1, panel_index: 1, bbox_mm: [105, 0, 210, 297], language: "fr", language_confidence: 0.99, status: "extracted" },
    ])
    .select("id, language");
  if (panels.error) throw panels.error;
  const de = panels.data.find((p) => p.language === "de")!.id;
  const text = await service.from("text_objects").insert(
    GERMAN.map(([t, bbox], i) => ({
      workspace_id: workspaceId,
      product_id: productId,
      panel_id: de,
      text: t,
      bbox_mm: bbox,
      font_name: "Inter",
      font_size_pt: 9,
      x_height_mm: 1.6,
      cap_height_mm: 2.2,
      is_ocr: false,
      confidence: 1,
      reading_order: i + 1,
    })),
  );
  if (text.error) throw text.error;
  return productId;
}

/** Runs the check as `editor` through app.request_check and waits for the worker to finish it. */
export async function runCheck(editor: Person, productId: string) {
  const { data: jobId, error } = await editor.db.schema("app").rpc("request_check", { p_product: productId });
  if (error) throw error;
  await expect
    .poll(
      async () => {
        const job = await admin().schema("app").from("jobs").select("status").eq("id", jobId).single();
        if (job.error) throw job.error;
        return job.data.status;
      },
      { timeout: CHECK_MS, intervals: [500, 1000, 2000] },
    )
    .toBe("succeeded");
  return jobId as string;
}
