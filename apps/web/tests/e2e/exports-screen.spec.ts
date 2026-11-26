// T-1112 · S-NV2-018 Exports at /w/[workspace]/exports (I01, O03), on the full local stack (scripts/ci/e2e.sh: the
// worker renders the report and writes the export). A product is checked as report.spec seeds it; the admin generates
// the Report of Check from this screen (app.request_report), the worker renders it, and the PDF downloads through a link
// Storage signs under the person's own session. The full export runs from the same screen (app.request_export), free
// on every plan (BE-44). A viewer reads the reports but gets no Generate button and no export controls; another
// workspace's admin reaches nothing. States visited here: loaded, empty and no-permission (a person with no seat gets
// the workspace's NoAccess); loading is the shared ShellLoading and an error goes to the workspace error boundary, both
// tested with the shell. axe runs on every state; the crawl follows every link and names every button.
import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { expectLikeBaseline, type Region } from "./support/baseline";
import { CHECK_MS, runCheck, seedProduct } from "./support/checks";
import { admin, haveStack, person, signIn, workspace, type Person } from "./support/people";
import { axe, maxDiffPixelRatio, watch } from "./support/public";

const REPORT_MS = 150_000;
const PRODUCT = "Salmon & Rice Adult 12 kg";

// Regions of the S-NV2-018 baseline at 1600 px: the Report of Check card's number and title, which the design draws the
// same for any workspace (the card is wider here: the design keeps the Compliance Worker open beside it).
const S_NV2_018: Record<string, Region> = {
  reportTitle: { x: 263, y: 442, width: 180, height: 26 },
};

const rows = (page: Page) => page.locator("tr[data-check]");
const exportCard = (page: Page) => page.locator("[data-export-state]");

async function personId(who: Person) {
  const { data, error } = await admin().schema("app").from("people").select("id").eq("user_id", who.userId).single();
  if (error) throw error;
  return data.id as string;
}

async function reportJobs(ws: string) {
  const { data, error } = await admin()
    .schema("app")
    .from("jobs")
    .select("id, status, payload, idempotency_key")
    .eq("workspace_id", ws)
    .eq("kind", "report");
  if (error) throw error;
  return data;
}

test.describe("S-NV2-018 Exports", () => {
  test.skip(!haveStack(), "needs the local Supabase stack and the worker: run through scripts/ci/e2e.sh (make e2e)");
  test.describe.configure({ mode: "serial" });
  test.use({ viewport: { width: 1600, height: 1000 } });

  let ada: Person, vic: Person, otto: Person;
  let ws: string, other: string, productId: string;
  let firstCheck: string;

  test.beforeAll(async () => {
    test.setTimeout(CHECK_MS + 60_000);
    [ada, vic, otto] = await Promise.all(["ada", "vic", "otto"].map((l) => person(`t1112-${l}`)));
    ws = await workspace(ada, "Halden Pet Nutrition");
    other = await workspace(otto, "Otto's own");
    await workspace(vic, "Vic's own"); // a person row, as people who already use Nutrivo have
    const seat = await admin().schema("app").from("memberships").insert({ workspace_id: ws, person_id: await personId(vic), role: "viewer" });
    if (seat.error) throw seat.error;
    productId = await seedProduct(ws, PRODUCT, ["EU-DE", "EU-FR"]);
    await runCheck(ada, productId);
  });

  test("[I01.main] Generate a report: the main path works end to end", async ({ page, context, baseURL }) => {
    test.setTimeout(REPORT_MS + 60_000);
    await signIn(context, ada, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/exports`);
    await expect(page.getByRole("heading", { level: 1, name: "Reports of Check and the full export" })).toBeVisible();
    await expect(rows(page).first()).toBeVisible();
    const row = rows(page).filter({ hasText: "Germany" }).first();
    firstCheck = (await row.getAttribute("data-check"))!;
    await expect(row).toHaveAttribute("data-report-state", "none");
    await expect(row).toContainText(PRODUCT);
    await expectLikeBaseline(
      page,
      page.locator('[data-region="report-card"] [data-card-title]'),
      "S-NV2-018",
      S_NV2_018.reportTitle,
      maxDiffPixelRatio,
    );
    await axe(page);

    await row.getByRole("button", { name: /^Generate the report/ }).click();
    await expect(row).toHaveAttribute("data-report-state", /preparing|issued/);
    const jobs = await reportJobs(ws);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].idempotency_key).toBe(`report:${firstCheck}`);
    expect(Object.keys(jobs[0].payload as object).sort()).toEqual(["check_id", "request_id"]); // ids only, never a token

    // The worker renders the report; the screen re-reads itself while it prepares.
    await expect(row).toHaveAttribute("data-report-state", "issued", { timeout: REPORT_MS });
    const issued = await admin()
      .schema("app")
      .from("reports")
      .select("ref, pdf_sha256, ruleset_version, has_not_assessed")
      .contains("check_ids", [firstCheck])
      .single();
    if (issued.error) throw issued.error;
    expect(issued.data.has_not_assessed).toBe(true); // the local stack's empty ruleset: everything honestly Not assessed
    await expect(row.locator("[data-ref]")).toHaveText(issued.data.ref);
    await axe(page);

    const download = page.waitForEvent("download");
    await row.getByRole("button", { name: /^Download the PDF/ }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`${issued.data.ref}.pdf`);
    const bytes = Buffer.concat((await (await file.createReadStream()).toArray()) as Buffer[]);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(issued.data.pdf_sha256);
    expect(errors).toEqual([]);
  });

  test("[I01.must.1] The same reference re-rendered a year later produces the same document (BE-26).", async ({
    page,
    context,
    baseURL,
  }) => {
    // One check, one job, one reference: a repeat request returns the issued job, and the screen keeps offering the
    // same document, byte for byte the one recorded at issue (the worker's rerender test covers the year later).
    const before = await reportJobs(ws);
    const again = await ada.db.schema("app").rpc("request_report", { p_check: firstCheck });
    expect(again.error).toBeNull();
    expect(again.data).toBe(before[0].id);
    expect(await reportJobs(ws)).toHaveLength(1);
    const issued = await admin().schema("app").from("reports").select("ref, pdf_sha256").contains("check_ids", [firstCheck]);
    if (issued.error) throw issued.error;
    expect(issued.data).toHaveLength(1);

    await signIn(context, ada, baseURL!);
    await page.goto(`/w/${ws}/exports`);
    const row = page.locator(`tr[data-check="${firstCheck}"]`);
    await expect(row).toHaveAttribute("data-report-state", "issued");
    await expect(row.locator("[data-ref]")).toHaveText(issued.data[0].ref);
    const download = page.waitForEvent("download");
    await row.getByRole("button", { name: /^Download the PDF/ }).click();
    const bytes = Buffer.concat((await (await (await download).createReadStream()).toArray()) as Buffer[]);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(issued.data[0].pdf_sha256);
  });

  test("[O03.main] Export everything: the main path works end to end", async ({ page, context, baseURL }) => {
    test.setTimeout(180_000);
    await signIn(context, ada, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/exports`);
    await expect(exportCard(page)).toHaveAttribute("data-export-state", "none");
    await page.getByRole("button", { name: "Request a full export" }).click();
    await expect(exportCard(page)).toHaveAttribute("data-export-state", /preparing|ready/);
    const jobs = await admin().schema("app").from("jobs").select("id, payload").eq("workspace_id", ws).eq("kind", "export");
    expect(jobs.data).toHaveLength(1);
    expect(Object.keys(jobs.data![0].payload as object)).toEqual(["request_id"]); // ids only, never a token
    await expect(exportCard(page)).toHaveAttribute("data-export-state", "ready", { timeout: 150_000 });
    await axe(page);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download the export" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`nutrivo-export-${jobs.data![0].id}.zip`);
    const bytes = Buffer.concat((await (await file.createReadStream()).toArray()) as Buffer[]);
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
    expect(bytes.includes(Buffer.from("reports.csv"))).toBe(true);
    expect(errors).toEqual([]);
  });

  test("[O03.must.1] Free on every plan, never gated (BE-44).", async ({ page, context, baseURL }) => {
    test.setTimeout(180_000);
    // The free plan with the workspace closed: the export is still offered here and runs.
    const set = await admin().schema("app").from("workspaces").update({ plan: "free", status: "closed" }).eq("id", ws);
    if (set.error) throw set.error;
    try {
      await signIn(context, ada, baseURL!);
      await page.goto(`/w/${ws}/exports`);
      await expect(page.locator('[data-region="exports"]')).toContainText("free on every plan, including the free one");
      const before = new Set(((await admin().schema("app").from("jobs").select("id").eq("workspace_id", ws).eq("kind", "export")).data ?? []).map((j) => j.id));
      await page.getByRole("button", { name: /Request (a full|a new) export/ }).click();
      await expect
        .poll(
          async () => {
            const all = (await admin().schema("app").from("jobs").select("id, status").eq("workspace_id", ws).eq("kind", "export")).data ?? [];
            return all.find((j) => !before.has(j.id))?.status;
          },
          { timeout: 150_000, intervals: [500, 1_000, 2_000] },
        )
        .toBe("succeeded");
    } finally {
      await admin().schema("app").from("workspaces").update({ status: "active" }).eq("id", ws);
    }
  });

  test("[T-1112] a viewer reads the reports and downloads one, with no Generate button and no export controls", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, vic, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/exports`);
    const issued = page.locator(`tr[data-check="${firstCheck}"]`);
    await expect(issued).toHaveAttribute("data-report-state", "issued");
    await expect(page.getByRole("button", { name: /^Generate the report/ })).toHaveCount(0);
    await expect(page.locator('tr[data-report-state="none"]').first()).toContainText("An editor can generate it");
    await expect(exportCard(page)).toHaveCount(0);
    await expect(page.locator("[data-export-note]")).toContainText("An admin of Halden Pet Nutrition requests it");
    await axe(page);
    const download = page.waitForEvent("download");
    await issued.getByRole("button", { name: /^Download the PDF/ }).click();
    expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
    // Under the viewer's own session the RPC refuses.
    const refused = await vic.db.schema("app").rpc("request_report", { p_check: firstCheck });
    expect(refused.error?.code).toBe("42501");
    expect(errors).toEqual([]);
  });

  test("[T-1112] signed links never cross tenants: another workspace's admin reaches no report, job or export", async ({
    page,
    context,
    baseURL,
  }) => {
    const report = await admin().schema("app").from("reports").select("id, pdf_path").contains("check_ids", [firstCheck]).single();
    if (report.error) throw report.error;
    const signed = await otto.db.storage.from("reports").createSignedUrl(report.data.pdf_path!, 60);
    expect(signed.data).toBeNull();
    const listed = await otto.db.storage.from("exports").list(ws);
    expect(listed.data ?? []).toEqual([]);
    const read = await otto.db.schema("app").from("reports").select("id").eq("workspace_id", ws);
    expect(read.data ?? []).toEqual([]);
    const refused = await otto.db.schema("app").rpc("request_report", { p_check: firstCheck });
    expect(refused.error?.code).toBe("42501");
    await signIn(context, otto, baseURL!);
    await page.goto(`/w/${ws}/exports`);
    await expect(page.locator('[data-region="exports"]')).toHaveCount(0);
    await expect(page.getByText(PRODUCT)).toHaveCount(0);
  });

  test("[T-1112] empty: a workspace with no checked label says so and points to adding a product", async ({ page, context, baseURL }) => {
    await signIn(context, otto, baseURL!);
    await page.goto(`/w/${other}/exports`);
    const empty = page.locator('[data-region="reports"] [data-pattern="none"]');
    await expect(empty).toContainText("No label has been checked in this workspace yet");
    await expect(empty.getByRole("link", { name: "Add a product" })).toHaveAttribute("href", `/w/${other}/products/new`);
    await expect(exportCard(page)).toHaveAttribute("data-export-state", "none");
    await axe(page);
  });

  test("[T-1112] no dead controls: every link resolves and every button is one this screen tests", async ({ page, context, baseURL }) => {
    await signIn(context, ada, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/exports`);
    const region = page.locator('[data-region="exports"]');
    await expect(region).toBeVisible();
    const hrefs = await region.locator("a").filter({ visible: true }).evaluateAll((links) => links.map((a) => a.getAttribute("href")));
    expect(hrefs).toContain(`/w/${ws}/products/${productId}/report`);
    for (const href of new Set(hrefs)) {
      expect(href, `${href} stays on the site`).toMatch(/^\//);
      const response = await page.request.get(href!, { maxRedirects: 0 });
      expect(response.status(), href!).toBeLessThan(400);
    }
    // Generate, Download the PDF, Request and Download the export: each is pressed in the tests above.
    const names = await region.getByRole("button").evaluateAll((buttons) => buttons.map((b) => b.textContent?.trim()));
    for (const name of names) {
      expect(["Generate the report", "Download the PDF", "Request a full export", "Request a new export", "Download the export"]).toContain(name);
    }
    expect(errors).toEqual([]);
  });
});
