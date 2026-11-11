// T-1002 · E02 Compute the compliance envelope on Design envelope (S-NV2-005), on the full local stack
// (scripts/ci/e2e.sh: database, worker, web). The editor's "Screen this brief" calls app.request_envelope and the worker's
// envelope job writes it. The local stack releases only the empty ruleset (no coverage, no rules), so the honest
// answer for every market is Not assessed with no coverage recorded (E02.must.1). The richer path (requirements,
// wording, limits, gaps) is proven against a seeded ruleset in worker/tests/test_envelope_pg.py; here a second brief
// gets an envelope written as the worker writes it (service role, synthetic rows), to read the screen's every section.
// @local-only, never against staging.
import { expect, test } from "@playwright/test";
import { expectLikeBaseline } from "./support/baseline";
import { admin, haveStack, person, signIn, workspace, type Person } from "./support/people";
import { axe, maxDiffPixelRatio, watch } from "./support/public";

// S-NV2-005 at 1600 px: "The envelope" heading row (heading, its mono note and the 1 px ink rule) is the box at x 242,
// y 258, 948 wide in the baseline. Its text is the design's own; the table beneath carries the design's sample brief.
const ENVELOPE_HEAD = { x: 242, y: 255, width: 948, height: 30 };

test.describe("@local-only Design envelope (E02)", () => {
  test.skip(!haveStack(), "needs the local stack (scripts/ci/e2e.sh)");
  test.describe.configure({ mode: "serial" });
  test.use({ viewport: { width: 1600, height: 1000 } });

  let editor: Person, viewer: Person, ws: string;

  async function brief(name: string) {
    const created = await editor.db.schema("app").rpc("create_product", {
      p_ws: ws,
      p_name: name,
      p_family_name: name,
      p_stage: "brief",
      p_species: "dog",
      p_nodes: ["EU-DE"],
    });
    if (created.error) throw created.error;
    return created.data as string;
  }

  test.beforeAll(async () => {
    [editor, viewer] = await Promise.all([person("t1002-editor"), person("t1002-viewer")]);
    ws = await workspace(editor, "T-1002 envelopes");
    await workspace(viewer, "Viewer's own");
    const { data: p, error } = await admin().schema("app").from("people").select("id").eq("user_id", viewer.userId).single();
    if (error) throw error;
    const grant = await admin().schema("app").from("memberships").insert({ workspace_id: ws, person_id: p.id, role: "viewer" });
    if (grant.error) throw grant.error;
  });

  test("[E02.main] Compute the compliance envelope: the main path works end to end", async ({ page, context, baseURL }) => {
    const productId = await brief("Senior Joint Support Wet");
    const errors = watch(page);
    await signIn(context, editor, baseURL!);
    await page.goto(`/w/${ws}/briefs/${productId}/envelope`);
    await expect(page.getByRole("heading", { name: "Senior Joint Support Wet — what you may build" })).toBeVisible();
    // Empty: never screened.
    await expect(page.getByText("This brief has not been screened yet")).toBeVisible();
    await axe(page);

    await page.getByRole("button", { name: "Screen this brief" }).click();
    // The worker computes it; the screen follows the job and shows the envelope when it is written.
    await expect(page.locator("[data-envelope]")).toBeVisible({ timeout: 60_000 });
    // E02.must.1: nothing is encoded for EU-DE in the local ruleset, so it is Not assessed, never Clear, and says why.
    await expect(page.locator('[data-card="not_assessed"]')).toContainText("DE");
    await expect(page.locator('[data-card="clear"]')).toContainText("None");
    await expect(page.locator("[data-envelope-withheld]")).toContainText("DE · No coverage recorded for this market");
    // E02.must.2: nutrient adequacy is stated as out of scope.
    await expect(page.locator('[data-scope="nutrient_adequacy"]')).toContainText("out of scope until the FEDIAF guidelines are licensed");
    await axe(page);

    // Cached by inputs_hash: screening again with the same inputs is the same job and the same envelope.
    const before = await page.locator("[data-envelope]").getAttribute("data-envelope");
    await page.getByRole("button", { name: "Screen again" }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${ws}/briefs/${productId}/envelope$`));
    await expect(page.locator("[data-envelope]")).toHaveAttribute("data-envelope", before!);
    const { count } = await admin().schema("app").from("envelopes").select("id", { count: "exact", head: true }).eq("product_id", productId);
    expect(count).toBe(1);
    expect(errors).toEqual([]);
  });

  test("[E02.must.1] every section reads as written: limits, wording with citations, and withheld items with their gap", async ({ page, context, baseURL }) => {
    const productId = await brief("Adult Maintenance Wet");
    // Written as the worker writes it (service role), on the empty ruleset: synthetic rule keys and wording.
    const app = admin().schema("app");
    const { data: env, error } = await app
      .from("envelopes")
      .insert({ workspace_id: ws, product_id: productId, ruleset_version: "0000.00-empty", inputs_hash: `e2e-${productId}`, node_ids: ["EU-DE"] })
      .select("id")
      .single();
    if (error) throw error;
    const base = { workspace_id: ws, product_id: productId, envelope_id: env.id, node_id: "EU-DE" };
    const items = await app.from("envelope_items").insert([
      { ...base, language: "de", kind: "permitted", rule_key: "TEST.E02.DESIG", rule_version: 1, provenance: "deterministic_rule", citation: "TEST Art. 1", payload: { title: "Test designation", wordings: ["Testfutter für Hunde"] } },
      { ...base, kind: "limit", rule_key: "TEST.E02.MAX", rule_version: 1, provenance: "deterministic_rule", citation: "TEST Art. 2", payload: { check: "within_max_content", additive_ref: "TEST-E02", ingredient: "Test zinc", amount: 180, unit: "mg/kg", max_content: { value: 150, unit: "mg/kg" }, outcome: "exceeds" } },
      { ...base, language: "de", kind: "not_assessed", rule_key: "TEST.E02.BATCH", rule_version: 1, provenance: "not_assessed", reason_code: "data_missing", citation: "TEST Art. 3", payload: { title: "Test batch" } },
    ]);
    if (items.error) throw items.error;
    const node = await app.from("envelope_nodes").insert({ ...base, state: "action", open_items: 1, withheld: 1 });
    if (node.error) throw node.error;

    const errors = watch(page);
    await signIn(context, viewer, baseURL!);
    await page.goto(`/w/${ws}/briefs/${productId}/envelope`);
    await expect(page.locator('[data-card="action"]')).toContainText("DE");
    await expect(page.locator('[data-cell="TEST-E02:EU-DE"]')).toHaveAttribute("data-state", "action");
    await expect(page.locator('[data-cell="TEST-E02:EU-DE"]')).toContainText("150 max");
    await expect(page.locator("[data-envelope-wording]")).toContainText("Testfutter für Hunde");
    await expect(page.locator("[data-envelope-wording]")).toContainText("TEST Art. 1");
    await expect(page.locator("[data-envelope-withheld]")).toContainText("NO COVERAGE GAP RECORDED");
    await axe(page);
    await expectLikeBaseline(page, page.getByRole("heading", { name: "The envelope" }).locator(".."), "S-NV2-005", ENVELOPE_HEAD, maxDiffPixelRatio);

    // A viewer reads the envelope; the database refuses the viewer's request for a new one, and the screen says why.
    await page.getByRole("button", { name: "Screen again" }).click();
    await expect(page.locator("[data-screen-refused]")).toHaveAttribute("data-screen-refused", "no-permission");
    expect(errors).toEqual([]);
  });

  test("no dead controls on Design envelope: every button and link in the screen does something", async ({ page, context, baseURL }) => {
    const productId = await brief("Puppy Starter Wet");
    await signIn(context, editor, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/briefs/${productId}/envelope`);
    await page.waitForLoadState("networkidle");
    const controls = page.locator('main[data-screen="S-NV2-005"]').locator("a, button").filter({ visible: true });
    const names = (await controls.evaluateAll((els) => els.map((e) => e.textContent ?? ""))).map((t) => t.trim()).sort();
    expect(names).toEqual(["Screen this brief"]);
    await page.getByRole("button", { name: "Screen this brief" }).click();
    await expect(page.locator("[data-envelope], [data-envelope-job]").first()).toBeVisible({ timeout: 60_000 });
    expect(errors).toEqual([]);
  });
});
