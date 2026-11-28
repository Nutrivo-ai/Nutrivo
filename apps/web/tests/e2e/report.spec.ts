// T-404, T-1114: the label report (D07), since T-1114 as Fix mode (S-FIX-001, D-33), and re-checking from it (D08). A
// product's artwork is seeded as the extract job would write it (two printed panels, the German one with the design's
// text where it was printed), an editor runs the check through app.request_check, the worker evaluates it against the
// released ruleset (T-403), and a viewer reads the results: per market, one result set per printed language panel,
// every Not assessed linked to its coverage gap. Runs on the full local stack (scripts/ci/e2e.sh). The local stack
// releases only 0000.00-empty, so every result is honestly Not assessed and no finding offers a wording to copy; Copy
// required term is tested on the model (src/lib/report/fix.test.ts).
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { allResultSets, checklist, chooseMarket, fixReport, marketsOf, panelChecks } from "./support/fix";
import { admin, haveStack, person, signIn, workspace, type Person } from "./support/people";
import { axe, watch } from "./support/public";

const CHECK_MS = 90_000;
const MARKETS = ["EU-AT", "EU-BE", "EU-DE", "EU-FR"];
const EMPTY = "0000.00-empty";

// The German panel of Salmon & Rice as printed (the demo seed's, supabase/tests/app/fixtures/demo_halden.psql).
const GERMAN: [string, number[]][] = [
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

/** An artwork version with a succeeded extraction of two panels (German with text, French without), as the service role writes it. */
async function seedArtwork(workspaceId: string, productId: string, version: number) {
  const service = admin().schema("app");
  const sha = randomUUID().replace(/-/g, "").padEnd(64, "0");
  const av = await service
    .from("artwork_versions")
    .insert({
      workspace_id: workspaceId,
      product_id: productId,
      version,
      file_sha256: sha,
      storage_path: `${workspaceId}/${productId}/${sha}.pdf`,
      file_name: `SR-ADULT-12KG-v${version + 6}.pdf`,
      mime_type: "application/pdf",
      page_count: 1,
      is_new_artwork: version === 1,
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
  return { id: av.data.id as string, sha };
}

/** A product with its markets and a first artwork. */
async function seedProduct(workspaceId: string, name: string, markets: string[]) {
  const service = admin().schema("app");
  const fam = await service.from("families").insert({ workspace_id: workspaceId, name }).select("id").single();
  if (fam.error) throw fam.error;
  const prod = await service
    .from("products")
    .insert({ workspace_id: workspaceId, family_id: fam.data.id, name, stage: "in_development" })
    .select("id")
    .single();
  if (prod.error) throw prod.error;
  const productId = prod.data.id as string;
  if (markets.length) {
    const nodes = await service.from("product_nodes").insert(markets.map((node_id) => ({ product_id: productId, node_id, workspace_id: workspaceId })));
    if (nodes.error) throw nodes.error;
  }
  const artwork = await seedArtwork(workspaceId, productId, 1);
  return { productId, artwork };
}

/** Runs the check as `editor` through app.request_check and waits for the worker to finish it. */
async function runCheck(editor: Person, productId: string) {
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

async function databaseSets(productId: string, job?: string) {
  const service = admin().schema("app");
  let jobs: string[];
  if (job) jobs = [job];
  else {
    const nodes = await service.from("product_nodes").select("last_check_job_id").eq("product_id", productId);
    if (nodes.error) throw nodes.error;
    jobs = [...new Set(nodes.data.map((n) => n.last_check_job_id).filter((j): j is string => !!j))];
  }
  const checks = await service
    .from("checks")
    .select("id, job_id, node_id, panel_id, language, label_state, ruleset_version, artwork_version_id, artwork_sha, at")
    .eq("product_id", productId)
    .in("job_id", jobs)
    .order("id");
  if (checks.error) throw checks.error;
  const findings = await service
    .from("check_findings")
    .select("id, check_id, state, provenance, rule_key, gap_id, reason_code, message")
    .in("check_id", checks.data.map((c) => c.id))
    .order("id");
  if (findings.error) throw findings.error;
  return { checks: checks.data, findings: findings.data };
}

async function allowanceOf(ws: string) {
  const a = await admin().schema("app").from("allowances").select("labels_used, labels_allowed").eq("workspace_id", ws).single();
  if (a.error) throw a.error;
  return a.data;
}

const short = (sha: string) => `${sha.slice(0, 4)}…${sha.slice(-4)}`;

test.describe("label report as Fix mode", () => {
  test.skip(!haveStack(), "needs the local Supabase stack and the worker: run through scripts/ci/e2e.sh (make e2e)");
  test.describe.configure({ mode: "serial" });
  test.use({ viewport: { width: 1600, height: 1000 } });

  let editor: Person, viewer: Person;
  let ws: string, productId: string, firstSha: string, firstJob: string;
  let first: Awaited<ReturnType<typeof databaseSets>>;

  test.beforeAll(async () => {
    test.setTimeout(CHECK_MS + 60_000);
    [editor, viewer] = await Promise.all([person("t1114-editor"), person("t1114-viewer")]);
    ws = await workspace(editor, "Halden Fix Mode Test");
    await workspace(viewer, "Viewer's own"); // app.people rows are made by the RPCs; this one makes the viewer's
    const service = admin();
    const { data: v, error } = await service.schema("app").from("people").select("id").eq("user_id", viewer.userId).single();
    if (error) throw error;
    const grant = await service.schema("app").from("memberships").insert({ workspace_id: ws, person_id: v.id, role: "viewer" });
    if (grant.error) throw grant.error;
    const seeded = await seedProduct(ws, "Salmon & Rice Adult Dry", MARKETS);
    productId = seeded.productId;
    firstSha = seeded.artwork.sha;
    firstJob = await runCheck(editor, productId);
    first = await databaseSets(productId);
  });

  test("[D07.main] View the results: the main path works end to end", async ({ page, context, baseURL }) => {
    await signIn(context, viewer, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/products/${productId}/report`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Salmon & Rice Adult Dry");
    await expect(fixReport(page)).toBeVisible();

    // A Market button per market; the check is pinned to its ruleset and artwork (CLAUDE.md 5).
    expect(await marketsOf(page)).toEqual(MARKETS);
    await expect(page.locator("[data-pinned]")).toHaveText(new RegExp(`^Pinned to ruleset ${EMPTY} · artwork ${short(firstSha)} · checked `));
    await expect(page.getByRole("link", { name: `RULESET ${EMPTY} · current` })).toBeVisible();

    // Germany: its German panel is drawn with its text where it was printed and carries the state chip; the French
    // panel is not a German-language panel and carries none.
    await chooseMarket(page, "EU-DE");
    const panels = page.locator('[data-region="artwork"] [data-panel]');
    await expect(panels).toHaveCount(2);
    const german = panels.filter({ has: page.locator('[lang="de"]') });
    await expect(german.locator("[data-text-object]")).toHaveCount(GERMAN.length);
    await expect(german.locator("[data-text-object]").first()).toContainText("Alleinfuttermittel");
    await expect(german.locator("[data-panel-state]")).toHaveAttribute("data-panel-state", "not_assessed");
    await expect(panels.nth(1)).toContainText("Not a German-language panel");
    await expect(panels.nth(1).locator("[data-panel-state]")).toHaveCount(0);

    // Against the empty ruleset nothing is open and everything is withheld: the heading is grey Not assessed, never
    // label clear, and the checklist holds only Not assessed items, each with its provenance and its gap.
    const heading = checklist(page).getByRole("heading", { level: 2 });
    await expect(heading).toHaveText("Germany: not assessed");
    await expect(heading).toHaveAttribute("data-heading-tone", "not_assessed");
    await expect(heading.locator('[data-glyph="not_assessed"]')).toHaveCount(1);
    await expect(checklist(page).locator('[data-finding-state="action"]')).toHaveCount(0);
    const items = checklist(page).locator('[data-finding-state="not_assessed"]');
    await expect(items.first()).toBeVisible();
    await expect(items.first().locator('[data-provenance="not_assessed"]')).toBeVisible();
    await expect(page.locator('[data-panel-state="clear"]')).toHaveCount(0);
    await expect(page.getByText(/is label clear/)).toHaveCount(0);

    // Selecting an item marks it, and only it, as pressed.
    const select = items.first().getByRole("button");
    await select.click();
    await expect(select).toHaveAttribute("aria-pressed", "true");

    // A viewer reads; only an editor uploads a revision or re-checks.
    await expect(page.getByRole("link", { name: "Upload revision" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Download report (PDF)" })).toHaveAttribute("href", `/w/${ws}/products/${productId}/report/send`);

    // Zoom 50 to 150 percent.
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect(page.getByRole("group", { name: "Zoom" })).toContainText("125%");
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect(page.getByRole("button", { name: "Zoom in" })).toBeDisabled();
    await page.getByRole("button", { name: "Fit" }).click();
    await expect(page.getByRole("group", { name: "Zoom" })).toContainText("100%");

    await axe(page);
    expect(errors).toEqual([]);
  });

  test("[D07.must.1] One result set per language panel: each panel is its own check, holding only its own findings", async ({ page, context, baseURL }) => {
    // Two printed panels in four markets: eight checks, so eight result sets.
    expect(first.checks).toHaveLength(MARKETS.length * 2);
    await signIn(context, viewer, baseURL!);
    await page.goto(`/w/${ws}/products/${productId}/report`);
    await expect(fixReport(page)).toBeVisible();
    const sets = await allResultSets(page);
    expect(sets.map((s) => s.checkId).sort()).toEqual(first.checks.map((c) => c.id).sort());
    for (const s of sets) expect(first.checks.find((c) => c.id === s.checkId)!.node_id).toBe(s.node);

    // In every market, each item sits under its own check, and every withheld finding of that market's checks is shown.
    for (const node of MARKETS) {
      await chooseMarket(page, node);
      const own = new Set(await panelChecks(page));
      const shown = await checklist(page)
        .locator("[data-finding-state]")
        .evaluateAll((els) => els.map((e) => ({ id: e.getAttribute("data-finding-id")!, check: e.getAttribute("data-check-id")! })));
      for (const s of shown) {
        expect(own.has(s.check)).toBe(true);
        expect(first.findings.find((f) => f.id === s.id)!.check_id).toBe(s.check);
      }
      const expected = first.findings.filter((f) => own.has(f.check_id) && f.state !== "info").map((f) => f.id).sort();
      expect(shown.map((s) => s.id).sort()).toEqual(expected);
    }
  });

  test("[D07.must.2] Every Not assessed links to its gap", async ({ page, context, baseURL }) => {
    await signIn(context, viewer, baseURL!);
    await page.goto(`/w/${ws}/products/${productId}/report`);
    await expect(fixReport(page)).toBeVisible();
    const gaps = await admin().schema("ref").from("coverage_gaps").select("gap_id, node_id");
    if (gaps.error) throw gaps.error;
    const nodeOf = new Map(gaps.data.map((g) => [g.gap_id, g.node_id]));
    let linked = 0;
    for (const node of MARKETS) {
      await chooseMarket(page, node);
      const own = new Set(await panelChecks(page));
      const withheld = first.findings.filter((f) => own.has(f.check_id) && f.state === "not_assessed");
      await expect(checklist(page).locator('[data-finding-state="not_assessed"]')).toHaveCount(withheld.length);
      for (const f of withheld) {
        expect(f.gap_id, "the engine gives every coverage withhold its gap").toBeTruthy();
        const item = checklist(page).locator(`[data-finding-id="${f.id}"]`);
        await expect(item.locator(`[data-gap-id="${f.gap_id}"] a`)).toHaveAttribute("href", `/w/${ws}/library/coverage/${nodeOf.get(f.gap_id!)}#${f.gap_id}`);
        linked++;
      }
    }
    expect(linked).toBe(first.findings.filter((f) => f.state === "not_assessed").length);
    expect(linked).toBeGreaterThan(0);

    // The link opens the coverage node that names the gap.
    const link = checklist(page).locator("[data-gap-id] a").first();
    const href = (await link.getAttribute("href"))!;
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${href.split("#")[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  });

  test("[D08.main] Re-check a new artwork version: the main path works end to end", async ({ page, context, baseURL }) => {
    test.setTimeout(CHECK_MS + 60_000);
    await signIn(context, editor, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/products/${productId}/report`);
    await expect(fixReport(page)).toBeVisible();
    // The editor's way to a revision: Upload revision opens Upload & scope.
    await expect(page.getByRole("link", { name: "Upload revision" }).first()).toHaveAttribute("href", `/w/${ws}/products/${productId}/check`);

    // A revision, extracted; while its check is in flight the report says so and links to its progress. The job is
    // queued without a queue message, so it stays in flight for as long as this part of the test reads it.
    const v2 = await seedArtwork(ws, productId, 2);
    const pending = await admin()
      .schema("app")
      .from("jobs")
      .insert({
        workspace_id: ws,
        product_id: productId,
        kind: "check",
        idempotency_key: `e2e-pending:${randomUUID()}`,
        status: "queued",
        node_ids: MARKETS,
        payload: { artwork_version_id: v2.id },
      })
      .select("id")
      .single();
    if (pending.error) throw pending.error;
    await page.reload();
    const banner = page.locator('[data-banner="rechecking"]');
    await expect(banner).toContainText("Revision uploaded. The new artwork is being checked. Pins turn clear only when that check passes.");
    await expect(banner.getByRole("link", { name: "View check in progress" })).toHaveAttribute("href", `/w/${ws}/products/${productId}/checks/${pending.data.id}`);
    await axe(page);
    const cancelled = await admin().schema("app").from("jobs").update({ status: "cancelled" }).eq("id", pending.data.id);
    if (cancelled.error) throw cancelled.error;

    // The re-check, as Re-check and Run the check call it: app.request_check, then the worker.
    await runCheck(editor, productId);
    await page.reload();
    await expect(page.locator("[data-banner]")).toHaveCount(0);
    await expect(page.locator("[data-pinned]")).toContainText(`artwork ${short(v2.sha)}`);
    const sets = await allResultSets(page);
    expect(sets).toHaveLength(MARKETS.length * 2);
    const now = await databaseSets(productId);
    expect(new Set(now.checks.map((c) => c.artwork_version_id))).toEqual(new Set([v2.id]));
    expect(sets.map((s) => s.checkId).sort()).toEqual(now.checks.map((c) => c.id).sort());

    // The first result is still there, read-only: a newer result exists, and nothing on it can be acted on.
    await page.goto(`/w/${ws}/products/${productId}/report?job=${firstJob}`);
    const old = page.locator('[data-banner="superseded"]');
    await expect(old).toContainText("A newer result exists. This one is read-only.");
    await expect(page.locator("[data-pinned]")).toContainText(`artwork ${short(firstSha)}`);
    await expect(page.getByRole("link", { name: "Upload revision" })).toHaveCount(0);
    await old.getByRole("link", { name: "Open it" }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${ws}/products/${productId}/report$`));
    await expect(page.locator("[data-pinned]")).toContainText(`artwork ${short(v2.sha)}`);
    expect(errors).toEqual([]);
  });

  test("[D08.must.1] Revisions are free (BE-32).", async () => {
    // The re-check and the revision used nothing: checks are never metered, and a revision is not a new artwork.
    const before = await allowanceOf(ws);
    await runCheck(editor, productId); // the same revision, ruleset and markets: the same job, nothing counted
    expect(await allowanceOf(ws)).toEqual(before);
    const versions = await admin().schema("app").from("artwork_versions").select("id, version, is_new_artwork").eq("product_id", productId).order("version");
    if (versions.error) throw versions.error;
    expect(versions.data.map((v) => [v.version, v.is_new_artwork])).toEqual([
      [1, true],
      [2, false],
    ]);
    const consumed = await admin().schema("app").from("allowance_consumptions").select("artwork_version_id").eq("artwork_version_id", versions.data[1].id);
    if (consumed.error) throw consumed.error;
    expect(consumed.data).toEqual([]);
  });

  test("[D08.must.2] History is never rewritten (BE-05).", async ({ page, context, baseURL }) => {
    // Every row of the first check is still there, exactly as it was written, and the report still opens it.
    const again = await databaseSets(productId, firstJob);
    expect(again).toEqual(first);
    await signIn(context, viewer, baseURL!);
    await page.goto(`/w/${ws}/products/${productId}/report?job=${firstJob}`);
    await expect(page.locator('[data-banner="superseded"]')).toBeVisible();
    const sets = await allResultSets(page);
    expect(sets.map((s) => s.checkId).sort()).toEqual(first.checks.map((c) => c.id).sort());
    // The database refuses to change the old rows, even for the service role.
    const update = await admin().schema("app").from("checks").update({ label_state: "clear" }).eq("id", first.checks[0].id);
    expect(["42501", "P0005"]).toContain(update.error?.code);
    expect(await databaseSets(productId, firstJob)).toEqual(first);
  });

  test("[T-1114] the report's states: never checked, no access, and no dead controls", async ({ page, context, baseURL }) => {
    // S-FIX-009: a product with an artwork and no check offers Run check to an editor, and Upload a label.
    const unchecked = await seedProduct(ws, "Senior Joint Support Wet", ["EU-DE"]);
    await signIn(context, editor, baseURL!);
    await page.goto(`/w/${ws}/products/${unchecked.productId}/report`);
    await expect(page.locator('[data-fix-state="never"]')).toContainText("This product has no check yet");
    await expect(page.locator("[data-pinned]")).toHaveText("Not checked yet");
    await expect(page.getByRole("button", { name: "Run check" })).toBeEnabled();
    await expect(page.getByRole("link", { name: "Upload a label" })).toHaveAttribute("href", `/w/${ws}/products/${unchecked.productId}/check`);
    await axe(page);
    await page.getByRole("button", { name: "Run check" }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${ws}/products/${unchecked.productId}/checks/[0-9a-f-]{36}$`));

    // S-FIX-012: a product RLS does not return reads the same as one that does not exist; no Request access.
    await page.goto(`/w/${ws}/products/${randomUUID()}/report`);
    await expect(page.locator('[data-fix-state="no-permission"]')).toContainText("You don’t have access to this label report");
    await expect(page.getByRole("button", { name: /request access/i })).toHaveCount(0);

    // No dead controls (docs/20 §4) in the report itself; the shell's own controls are crawled by its tests.
    const errors = watch(page);
    await page.goto(`/w/${ws}/products/${productId}/report`);
    await expect(fixReport(page)).toBeVisible();
    const hrefs = await page.locator("main a").filter({ visible: true }).evaluateAll((links) => links.map((a) => a.getAttribute("href")));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of new Set(hrefs)) {
      expect(href, "every link in the report stays on the site").toMatch(/^\//);
      const response = await page.request.get(href!.split("#")[0], { maxRedirects: 0 });
      expect(response.status(), href!).toBeLessThan(400);
    }
    // Every button does something: a market or an item becomes the pressed one, a zoom control changes the zoom.
    for (const node of await marketsOf(page)) {
      const button = page.locator(`[data-region="markets"] [data-node="${node}"]`);
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
      const selects = checklist(page).locator("button[aria-pressed]");
      for (let i = 0; i < (await selects.count()); i++) {
        await selects.nth(i).click();
        await expect(selects.nth(i)).toHaveAttribute("aria-pressed", "true");
      }
      const pins = page.locator('[data-region="artwork"] button[data-pin]');
      for (let i = 0; i < (await pins.count()); i++) {
        await pins.nth(i).click();
        await expect(pins.nth(i)).toHaveAttribute("aria-pressed", "true");
      }
    }
    const zoom = page.getByRole("group", { name: "Zoom" });
    for (const [name, after] of [["Zoom out", "75%"], ["Zoom in", "100%"], ["Zoom in", "125%"], ["Fit", "100%"]] as const) {
      await zoom.getByRole("button", { name }).click();
      await expect(zoom).toContainText(after);
    }
    const unexpected = await page
      .locator("main button")
      .filter({ visible: true })
      .evaluateAll((buttons) =>
        buttons
          .filter((b) => !b.hasAttribute("aria-pressed") && !b.closest('[aria-label="Zoom"]'))
          .map((b) => b.textContent?.trim() ?? ""),
      );
    // Nothing else is a button here: Download and Upload revision are links, and Copy required term appears only with
    // an accepted term, which the empty ruleset never links.
    expect(unexpected).toEqual([]);
    expect(errors).toEqual([]);
  });
});
