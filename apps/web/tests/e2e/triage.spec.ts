// T-304: triage panels (D02) on S-NV2-025 "Artwork we cannot read". An artwork's extraction is seeded as the extract job
// writes it: a German and a French panel with live text, and a Polish panel supplied as outlines. The screen shows every
// detected panel with its language and its state. An editor runs the check through app.request_check, the worker
// evaluates it (T-403), and the screen then shows each panel's state over its markets' latest checks. A panel that
// cannot be assessed reads Not assessed with its reason code before and after the check, and its check findings carry
// that reason in the database. Runs on the full local stack (scripts/ci/e2e.sh).
//
// D02 step 2 (a person corrects a language or marks a panel not assessable) has no write path yet: no RPC, no reason
// code for a person's choice, no design control (asked on #42). The screen therefore draws no correction control, and
// these tests cover the path that exists.
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { admin, haveStack, person, signIn, workspace, type Person } from "./support/people";
import { axe, watch } from "./support/public";

const CHECK_MS = 90_000;
const MARKETS = ["EU-DE", "EU-FR"];
const LINE = (text: string, y: number, i: number) => ({ text, bbox_mm: [8, y, 97, y + 6], reading_order: i + 1 });

/** A product with its markets and a partial extraction: two live-text panels and one outlined, as the extract job writes them. */
async function seedArtwork(workspaceId: string, name: string) {
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
  const nodes = await service.from("product_nodes").insert(MARKETS.map((node_id) => ({ product_id: productId, node_id, workspace_id: workspaceId })));
  if (nodes.error) throw nodes.error;
  const sha = randomUUID().replace(/-/g, "").padEnd(64, "0");
  const av = await service
    .from("artwork_versions")
    .insert({
      workspace_id: workspaceId,
      product_id: productId,
      version: 1,
      file_sha256: sha,
      storage_path: `${workspaceId}/${productId}/${sha}.pdf`,
      file_name: "TRIAGE-3LANG-v2.pdf",
      mime_type: "application/pdf",
      page_count: 1,
      page_size_mm: [315, 297],
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
      status: "partial",
      failure_codes: ["outlined_text"],
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
      { ...base, page: 1, panel_index: 1, bbox_mm: [105, 0, 210, 297], language: "fr", language_confidence: 0.98, status: "extracted" },
      { ...base, page: 1, panel_index: 2, bbox_mm: [210, 0, 315, 297], language: "pl", status: "not_assessable", failure_code: "outlined_text" },
    ])
    .select("id, panel_index");
  if (panels.error) throw panels.error;
  const byIndex = new Map(panels.data.map((p) => [p.panel_index, p.id as string]));
  const text: Record<number, string[]> = {
    0: ["Alleinfuttermittel für ausgewachsene Hunde", "Zusammensetzung: Lachs (26 %), Reis, Geflügelfett"],
    1: ["Aliment complet pour chiens adultes", "Composition : saumon (26 %), riz, graisse de volaille"],
  };
  for (const [index, lines] of Object.entries(text)) {
    const inserted = await service.from("text_objects").insert(
      lines.map((t, i) => ({
        workspace_id: workspaceId,
        product_id: productId,
        panel_id: byIndex.get(Number(index))!,
        font_name: "Inter",
        font_size_pt: 9,
        x_height_mm: 1.6,
        cap_height_mm: 2.2,
        is_ocr: false,
        confidence: 1,
        ...LINE(t, 14 + 10 * i, i),
      })),
    );
    if (inserted.error) throw inserted.error;
  }
  return { productId, artworkId: av.data.id as string, panelIds: byIndex };
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

/** The screen's state per panel, as rows tagged by the component. */
async function shownStates(page: Page) {
  return page.locator("tr[data-panel]").evaluateAll((rows) =>
    rows.map((r) => ({
      panel: Number(r.getAttribute("data-panel")),
      state: r.getAttribute("data-panel-state"),
      reasons: (r.getAttribute("data-reason-codes") ?? "").split(" ").filter(Boolean),
    })),
  );
}

test.describe("triage panels", () => {
  test.skip(!haveStack(), "needs the local Supabase stack and the worker: run through scripts/ci/e2e.sh (make e2e)");
  test.describe.configure({ mode: "serial" });

  let editor: Person, viewer: Person;
  let ws: string;
  let seeded: Awaited<ReturnType<typeof seedArtwork>>;

  test.beforeAll(async () => {
    [editor, viewer] = await Promise.all([person("t304-editor"), person("t304-viewer")]);
    ws = await workspace(editor, "Halden Triage Test");
    await workspace(viewer, "Viewer's own"); // app.people rows are made by the RPCs; this one makes the viewer's
    const service = admin();
    const { data: v, error } = await service.schema("app").from("people").select("id").eq("user_id", viewer.userId).single();
    if (error) throw error;
    const grant = await service.schema("app").from("memberships").insert({ workspace_id: ws, person_id: v.id, role: "viewer" });
    if (grant.error) throw grant.error;
    seeded = await seedArtwork(ws, "Salmon & Rice Adult Triage");
  });

  const url = () => `/w/${ws}/products/${seeded.productId}/artwork/${seeded.artworkId}`;

  test("[D02.main] Triage panels: the main path works end to end", async ({ page, context, baseURL }) => {
    test.setTimeout(CHECK_MS + 60_000);
    await signIn(context, editor, baseURL!);
    const errors = watch(page);

    // 1. Detected panels and their languages, before any check: no verdict is drawn for a panel no check has reached.
    await page.goto(url());
    await expect(page.getByRole("heading", { level: 1, name: "Partial extraction" })).toBeVisible();
    const rows = page.locator("tr[data-panel]");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0).getByRole("rowheader")).toHaveText("German");
    await expect(rows.nth(1).getByRole("rowheader")).toHaveText("French");
    await expect(rows.nth(2).getByRole("rowheader")).toHaveText("Polish");
    expect(await shownStates(page)).toEqual([
      { panel: 0, state: "not_checked", reasons: [] },
      { panel: 1, state: "not_checked", reasons: [] },
      { panel: 2, state: "not_assessed", reasons: ["outlined_text"] },
    ]);
    await expect(rows.nth(0)).toContainText("Not checked");
    await expect(rows.nth(2)).toContainText("Not assessed");
    // No correction control is drawn until D02 step 2 has a write path (#42): nothing on the table is a dead control.
    await expect(page.locator("[data-panel-table] button, [data-panel-table] select, [data-panel-table] input")).toHaveCount(0);
    await axe(page);

    // 2. The check runs, and each panel's state is its markets' latest checks, worst first.
    await runCheck(editor, seeded.productId);
    await page.reload();
    const service = admin().schema("app");
    const checks = await service
      .from("checks")
      .select("panel_id, node_id, label_state, at")
      .eq("product_id", seeded.productId)
      .order("at", { ascending: false });
    if (checks.error) throw checks.error;
    const shown = await shownStates(page);
    for (const [index, panelId] of seeded.panelIds) {
      const latest = new Map<string, string>();
      for (const c of checks.data.filter((c) => c.panel_id === panelId)) if (!latest.has(c.node_id)) latest.set(c.node_id, c.label_state);
      const states = [...latest.values()];
      expect(states.length, `panel ${index} is checked once per market`).toBe(MARKETS.length);
      const worst = states.includes("action") ? "action" : states.includes("not_assessed") ? "not_assessed" : "clear";
      expect(shown.find((s) => s.panel === index)?.state, `panel ${index}`).toBe(worst);
    }
    await axe(page);

    // A viewer reads the same screen.
    await signIn(context, viewer, baseURL!);
    await page.goto(url());
    await expect(page.locator("tr[data-panel]")).toHaveCount(3);
    expect(await shownStates(page)).toEqual(shown);
    expect(errors).toEqual([]);
  });

  test("[D02.must.1] A panel that cannot be assessed produces Not assessed findings with a reason code, never silence.", async ({ page, context, baseURL }) => {
    const polish = seeded.panelIds.get(2)!;
    const service = admin().schema("app");
    const checks = await service.from("checks").select("id, node_id, label_state").eq("panel_id", polish);
    if (checks.error) throw checks.error;
    // One check per market for the panel, each Not assessed: never missing, never Clear.
    expect(checks.data.map((c) => c.node_id).sort()).toEqual([...MARKETS].sort());
    for (const c of checks.data) expect(c.label_state).toBe("not_assessed");
    const findings = await service
      .from("check_findings")
      .select("check_id, state, provenance, reason_code, gap_id, rule_key")
      .in("check_id", checks.data.map((c) => c.id));
    if (findings.error) throw findings.error;
    for (const c of checks.data) {
      const mine = findings.data.filter((f) => f.check_id === c.id);
      expect(mine.length, `check ${c.node_id} names what it did not assess`).toBeGreaterThan(0);
      for (const f of mine) {
        expect(f.state).toBe("not_assessed");
        expect(f.reason_code, "every Not assessed finding carries a reason code").toBeTruthy();
        expect(f.rule_key ?? f.gap_id, "and a rule_key or gap_id").toBeTruthy();
      }
    }

    // The screen says so too: Not assessed, with the panel's reason first, as text and to assistive technology.
    await signIn(context, viewer, baseURL!);
    const errors = watch(page);
    await page.goto(url());
    const row = page.locator('tr[data-panel="2"]');
    await expect(row).toHaveAttribute("data-panel-state", "not_assessed");
    await expect(row).toHaveAttribute("data-reason-codes", /^outlined_text\b/);
    await expect(row).toContainText("Not assessed");
    await expect(row).toContainText("Outlined · no live text");
    await expect(row.locator("td").last()).toContainText("reason: Outlined · no live text (outlined_text)");
    await expect(page.getByText("Not assessed because of this file")).toBeVisible();
    await axe(page);
    expect(errors).toEqual([]);
  });

  test("no dead controls on the triage screen: every link in it goes somewhere", async ({ page, context, baseURL }) => {
    await signIn(context, editor, baseURL!);
    const errors = watch(page);
    await page.goto(url());
    await expect(page.locator("tr[data-panel]")).toHaveCount(3);
    const hrefs = await page.locator("main a").filter({ visible: true }).evaluateAll((links) => links.map((a) => a.getAttribute("href")));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of new Set(hrefs)) {
      expect(href, "every link stays on the site").toMatch(/^\//);
      const response = await page.request.get(href!.split("#")[0], { maxRedirects: 0 });
      expect(response.status(), href!).toBeLessThan(400);
    }
    // The screen's only actions are links; it has no button of its own.
    await expect(page.locator("main [data-panel-table] button")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
