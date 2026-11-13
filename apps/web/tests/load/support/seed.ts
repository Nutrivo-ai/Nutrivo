// T-1105: the data a load run needs, written the way the e2e suite writes it (tests/e2e/support/people.ts): people
// through the Auth admin API and a magic-link session, the workspace through app.create_workspace, and the rows the
// worker would leave (products, markets, reports) through the service role. Every run makes its own workspace, named
// "Load test <profile> <time>", so runs never share data and a staging run is easy to find.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../../visual/screens";
import { admin, person, workspace, type Person } from "../../e2e/support/people";
import { OUT, profile } from "./budgets";

/** Insert-or-throw for the service role's writes. */
async function must<R>(what: string, p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<R> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  if (data == null) throw new Error(`${what}: no row`);
  return data as R;
}

/** The EU markets the seeded recipes are sold in: the region that exists at launch (D-03). */
export const MARKETS = ["EU-DE", "EU-FR", "EU-NL", "EU-AT", "EU-BE", "EU-IT", "EU-ES", "EU-PL"];

export type LoadWorkspace = { owner: Person; ws: string; products: string[] };

/**
 * A workspace on a paid plan (so register_artwork's free allowance never refuses, BE-32) holding `recipes` active
 * products, one family each, in `markets_per_recipe` markets, with a spread of market states as the check worker leaves
 * them, so the board renders every kind of cell.
 */
export async function loadWorkspace(recipes: number): Promise<LoadWorkspace> {
  const owner = await person(`load-${profile.name}`);
  const ws = await workspace(owner, `Load test ${profile.name} ${new Date().toISOString().slice(0, 16)}`);
  const app = admin().schema("app");
  await must("plan", app.from("workspaces").update({ plan: "advanced" }).eq("id", ws).select("id"));
  const products: string[] = [];
  const batch = 100;
  for (let start = 0; start < recipes; start += batch) {
    const n = Math.min(batch, recipes - start);
    const names = Array.from({ length: n }, (_, i) => `Load recipe ${String(start + i + 1).padStart(3, "0")}`);
    const fams = await must<{ id: string }[]>("families", app.from("families").insert(names.map((name) => ({ workspace_id: ws, name }))).select("id"));
    const rows = await must<{ id: string }[]>(
      "products",
      app
        .from("products")
        .insert(
          fams.map((f, i) => ({
            workspace_id: ws,
            family_id: f.id,
            name: names[i],
            stage: "active",
            species: i % 2 ? "cat" : "dog",
            life_stage: "adult",
            format: "dry",
          })),
        )
        .select("id"),
    );
    products.push(...rows.map((r) => r.id));
  }
  const nodes = products.flatMap((product, i) =>
    Array.from({ length: profile.markets_per_recipe }, (_, k) => ({
      product_id: product,
      node_id: MARKETS[(i + k) % MARKETS.length],
      workspace_id: ws,
    })),
  );
  for (let start = 0; start < nodes.length; start += 500) {
    await must("markets", app.from("product_nodes").insert(nodes.slice(start, start + 500)).select("node_id"));
  }
  // A fifth of the markets with open actions, so the board draws Action needed cells and counts as well as Not assessed.
  const action = products.filter((_, i) => i % 5 === 0);
  for (let start = 0; start < action.length; start += 100) {
    await must(
      "action markets",
      app.from("product_nodes").update({ label_state: "action", open_actions: 2 }).in("product_id", action.slice(start, start + 100)).select("node_id"),
    );
  }
  return { owner, ws, products };
}

/** One product with one market, for an artwork's extraction and check. */
export async function product(ws: string, name: string): Promise<string> {
  const app = admin().schema("app");
  const fam = await must<{ id: string }>("family", app.from("families").insert({ workspace_id: ws, name }).select("id").single());
  const p = await must<{ id: string }>(
    "product",
    app
      .from("products")
      .insert({ workspace_id: ws, family_id: fam.id, name, stage: "in_development", species: "dog", life_stage: "adult", format: "dry" })
      .select("id")
      .single(),
  );
  await must("market", app.from("product_nodes").insert({ product_id: p.id, node_id: "EU-DE", workspace_id: ws }).select("node_id"));
  return p.id;
}

/**
 * A ten-page artwork made from the synthetic labels (fixtures/synth/out, `make fixtures`), joined with pdfunite
 * (poppler). Each call gets its own bytes (a trailing PDF comment), so every upload is a new file hash.
 */
export function tenPageArtwork(): { buffer: Buffer; sha: string } {
  const synth = path.join(REPO_ROOT, "fixtures/synth/out");
  const labels = fs.existsSync(synth) ? fs.readdirSync(synth).filter((f) => f.endsWith(".pdf")).sort() : [];
  if (!labels.length) throw new Error("no synthetic labels: run make fixtures");
  const joined = path.join(OUT, "ten_pages.pdf");
  if (!fs.existsSync(joined)) {
    fs.mkdirSync(OUT, { recursive: true });
    const pages = Array.from({ length: 10 }, (_, i) => path.join(synth, labels[i % labels.length]));
    execFileSync("pdfunite", [...pages, joined]);
  }
  const buffer = Buffer.concat([fs.readFileSync(joined), Buffer.from(`\n%load ${randomBytes(8).toString("hex")}\n`)]);
  return { buffer, sha: createHash("sha256").update(buffer).digest("hex") };
}

/** Uploads the artwork and registers it as the owner (the RPC the browser calls); returns the artwork version id. */
export async function registerArtwork(owner: Person, ws: string, productId: string): Promise<string> {
  const { buffer, sha } = tenPageArtwork();
  const storagePath = `${ws}/${productId}/${sha}.pdf`;
  const up = await admin().storage.from("artwork").upload(storagePath, buffer, { contentType: "application/pdf", upsert: true });
  if (up.error) throw new Error(`upload: ${up.error.message}`);
  const { error } = await owner.db.schema("app").rpc("register_artwork", {
    p_product: productId,
    p_storage_path: storagePath,
    p_sha256: sha,
    p_file_name: "load-ten-pages.pdf",
    p_mime: "application/pdf",
  });
  if (error) throw new Error(`register_artwork: ${error.message}`);
  const av = await must<{ id: string }>(
    "artwork version",
    admin().schema("app").from("artwork_versions").select("id").eq("product_id", productId).eq("file_sha256", sha).single(),
  );
  return av.id;
}

export type JobRun = { id: string; status: string; seconds: number; last_error: string | null };

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

/** Waits for the job to reach a terminal state; its duration is the database's, created_at to its last update. */
export async function finished(where: { id?: string; key?: string }, timeoutMs: number): Promise<JobRun> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let q = admin().schema("app").from("jobs").select("id, status, created_at, updated_at, last_error");
    q = where.id ? q.eq("id", where.id) : q.eq("idempotency_key", where.key!);
    const { data, error } = await q.maybeSingle();
    if (error) throw new Error(`job: ${error.message}`);
    if (data && TERMINAL.has(data.status)) {
      return {
        id: data.id,
        status: data.status,
        seconds: (Date.parse(data.updated_at) - Date.parse(data.created_at)) / 1000,
        last_error: data.last_error,
      };
    }
    if (Date.now() > deadline) return { id: data?.id ?? "", status: data?.status ?? "missing", seconds: Infinity, last_error: "timed out" };
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** 128 random bits in base32, the shape of a report reference (reporting/model.py new_reference). */
function newRef() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  return Array.from(randomBytes(26), (b) => alphabet[b % 32]).join("");
}

/** An issued report in the workspace, as the report worker writes it; returns its reference. */
export async function issuedReport(ws: string, productId: string): Promise<string> {
  const ref = newRef();
  const ruleset = await must<{ id: string }>(
    "ruleset",
    admin().schema("ref").from("ruleset_versions").select("id").order("released_at", { ascending: false }).limit(1).single(),
  );
  await must(
    "report",
    admin()
      .schema("app")
      .from("reports")
      .insert({
        workspace_id: ws,
        product_id: productId,
        node_id: "EU-DE",
        ref,
        check_ids: [],
        ruleset_version: ruleset.id,
        artwork_sha: "b".repeat(64),
        has_not_assessed: true,
      })
      .select("id")
      .single(),
  );
  return ref;
}
