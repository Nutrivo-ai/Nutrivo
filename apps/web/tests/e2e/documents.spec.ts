// T-801 · Document library (H01, S-NV2-010) on the full local stack. Products are made the way the app makes them
// (app.create_product as their admin). Documents arrive through T-802's upload path, which does not exist yet, so the
// service role inserts the rows here, as the worker will. Two document requirements for Belgium are synthetic fixture
// rows, removed after the run: no requirement is encoded yet (issue #68, question 1). The screen reads under the
// viewer's session (RLS), is compared with its design baseline on the regions the design draws the same for any
// workspace (the introduction and the list's heading), and axe runs on every state.
import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { parse } from "yaml";
import { REPO_ROOT } from "../visual/screens";
import { expectLikeBaseline } from "./support/baseline";
import { admin, haveStack, person, signIn, workspace, type Person } from "./support/people";

const nfr = parse(fs.readFileSync(path.join(REPO_ROOT, "spec/nfr.yaml"), "utf8")) as {
  quality: { visual_max_diff_pixel_ratio: number; axe_serious_or_critical: number };
};
const maxDiff = nfr.quality.visual_max_diff_pixel_ratio;

// Regions of the S-NV2-010 baseline at 1600 px (design boxes, measured from the design file's "documents" screen).
const REGION = {
  intro: { x: 242, y: 90, width: 948, height: 23, fractionY: 0.6875 },
  heading: { x: 242, y: 466, width: 948, height: 27 },
} as const;

const FIXTURE_BASIS = "synthetic e2e fixture (T-801): not regulatory content";

function watch(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
  });
  return errors;
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  expect(serious.length).toBeLessThanOrEqual(nfr.quality.axe_serious_or_critical);
}

async function personId(who: Person) {
  const { data, error } = await admin().schema("app").from("people").select("id").eq("user_id", who.userId).single();
  if (error) throw error;
  return data.id as string;
}

async function product(who: Person, ws: string, name: string, nodes: string[]) {
  const { data, error } = await who.db.schema("app").rpc("create_product", {
    p_ws: ws,
    p_name: name,
    p_family_name: name,
    p_stage: "active",
    p_nodes: nodes,
  });
  if (error) throw error;
  return data as string;
}

async function familyOf(productId: string) {
  const { data, error } = await admin().schema("app").from("products").select("family_id").eq("id", productId).single();
  if (error) throw error;
  return data.family_id;
}

/** Days from today (UTC), as YYYY-MM-DD. */
function day(offset: number) {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

const documentsOf = (ws: string) => `/w/${ws}/documents`;
const lines = (page: Page) => page.getByRole("list", { name: "Documents" }).getByRole("listitem");

test.describe("Document library", () => {
  test.skip(!haveStack(), "needs the local Supabase stack: run through scripts/ci/e2e.sh (make e2e)");
  test.describe.configure({ mode: "serial" });

  let ada: Person, other: Person;
  let ws: string, otherWs: string;
  let salmon: string, joint: string;
  const requirementIds: string[] = [];

  test.beforeAll(async () => {
    [ada, other] = await Promise.all([person("t801-ada"), person("t801-oto")]);
    ws = await workspace(ada, "Halden Pet Nutrition");
    otherWs = await workspace(other, "Other workspace");
    salmon = await product(ada, ws, "Salmon & Rice 12 kg", ["EU-DE", "EU-BE"]);
    joint = await product(ada, ws, "Senior Joint Support", ["EU-DE"]);

    const service = admin().schema("app");
    const sup = await service.from("suppliers").insert({ workspace_id: ws, name: "Aldrich Nutrition" }).select("id").single();
    if (sup.error) throw sup.error;
    const doc = (workspace_id: string, file: string, extra: Record<string, unknown>) => ({
      workspace_id,
      doc_type: "specification",
      storage_path: `${workspace_id}/documents/${file}`,
      file_sha256: Buffer.from(file).toString("hex").padEnd(64, "0").slice(0, 64),
      uploaded_via: "member",
      scan_status: "clean",
      ...extra,
    });
    const add = await service.from("supplier_documents").insert([
      doc(ws, "SPEC-0442-premix-PMX-118.pdf", { supplier_id: sup.data.id, valid_from: day(-400), valid_to: day(-30) }),
      doc(ws, "CERT-0311-fish-oil-coa.pdf", { doc_type: "certificate_of_analysis", valid_to: day(20) }),
      doc(ws, "SPEC-0518-vitamin-premix.pdf", { supplier_id: sup.data.id, valid_to: day(200) }),
      doc(ws, "QA-2024-07-testing-protocol.pdf", { doc_type: "test_protocol", scan_status: "quarantine" }),
      doc(ws, "SPEC-JOINT-rev-A.pdf", { product_id: joint }),
      doc(otherWs, "NOT-OURS.pdf", {}),
    ]);
    if (add.error) throw add.error;

    // Belgium: two synthetic requirements. The vitamin spec (clean, current) meets the first; the only test protocol is
    // still quarantined, so the second is outstanding.
    const reqs = await admin()
      .schema("ref")
      .from("document_requirements")
      .insert([
        { node_id: "EU-BE", product_class: "pet_food", doc_type: "specification", legal_basis: FIXTURE_BASIS },
        { node_id: "EU-BE", product_class: "pet_food", doc_type: "test_protocol", legal_basis: FIXTURE_BASIS },
      ])
      .select("id");
    if (reqs.error) throw reqs.error;
    requirementIds.push(...reqs.data.map((r) => r.id));
  });

  test.afterAll(async () => {
    if (requirementIds.length) {
      await admin().schema("ref").from("document_requirements").delete().in("id", requirementIds);
    }
  });

  test("[H01.main] A member reads documents against each market's requirements, with expiry, and matches the baseline", async ({ page, context, baseURL }) => {
    await signIn(context, ada, baseURL!);
    const errors = watch(page);
    await page.goto(documentsOf(ws));
    // The page streams behind loading.tsx: wait for the content itself.
    await expect(page.getByRole("heading", { level: 1, name: "Completeness stated per market" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Expiring or expired" })).toBeVisible();

    // Germany has no encoded requirements: Not assessed, with no count. Never complete.
    const de = page.locator('[data-market="EU-DE"]');
    await expect(de).toHaveAttribute("data-market-state", "not_encoded");
    await expect(de).toContainText("Not assessed");
    await expect(de).toContainText("No document requirements are encoded for this market yet");
    await expect(de.locator('[data-glyph="not_assessed"]')).toHaveCount(1);
    await expect(de.getByTestId("market-ratio")).toHaveCount(0);

    // Belgium: the clean, current specification meets one; the quarantined test protocol does not count.
    const be = page.locator('[data-market="EU-BE"]');
    await expect(be).toHaveAttribute("data-market-state", "assessed");
    await expect(be.getByTestId("market-ratio")).toHaveText("1 / 2");
    await expect(be).toContainText("Missing or not current: Test protocol.");
    await expect(be).toContainText("1 document outstanding");
    // Germany sells two products, Belgium one: Germany first.
    await expect(page.locator("[data-market]")).toHaveCount(2);
    await expect(page.locator("[data-market]").first()).toHaveAttribute("data-market", "EU-DE");

    // Every document of the workspace, expired first, then expiring, current, undated; another workspace's never.
    await expect(lines(page)).toHaveCount(5);
    await expect(page.getByText("NOT-OURS.pdf")).toHaveCount(0);
    const order = await lines(page).evaluateAll((li) => li.map((l) => l.getAttribute("data-expiry")));
    expect(order).toEqual(["expired", "expiring", "current", "no_expiry", "no_expiry"]);
    const expired = lines(page).first();
    await expect(expired).toContainText("SPEC-0442-premix-PMX-118.pdf");
    await expect(expired).toContainText("Specification");
    await expect(expired).toContainText("Aldrich Nutrition");
    await expect(expired).toContainText(/EXPIRED \d{1,2} [A-Z]{3}/);
    await expect(lines(page).nth(1)).toContainText(/EXPIRES \d{1,2} [A-Z]{3}/);
    await expect(lines(page).nth(1)).toContainText("Own document");
    await expect(lines(page).nth(2)).toContainText(/CURRENT · \d{1,2} [A-Z]{3}/);
    await expect(page.locator('[data-scan="quarantine"]')).toContainText("Being scanned: not counted yet");

    // Read only: nothing on the screen writes, so it has no control to be dead.
    await expect(page.locator("main").getByRole("button")).toHaveCount(0);
    await expect(page.locator("main").getByRole("link")).toHaveCount(0);
    await axe(page);
    await expectLikeBaseline(page, page.getByTestId("documents-intro"), "S-NV2-010", REGION.intro, maxDiff);
    await expectLikeBaseline(page, page.getByTestId("documents-heading"), "S-NV2-010", REGION.heading, maxDiff);
    expect(errors).toEqual([]);
  });

  test("[H01.main] a scoped viewer sees only the documents of products in their scope", async ({ page, context, baseURL }) => {
    const vera = await person("t801-vera");
    await workspace(vera, "Vera's own");
    const grant = await admin()
      .schema("app")
      .from("memberships")
      .insert({ workspace_id: ws, person_id: await personId(vera), role: "viewer", is_external: true, scope_family_ids: [await familyOf(salmon)] });
    if (grant.error) throw grant.error;
    await signIn(context, vera, baseURL!);
    const errors = watch(page);
    await page.goto(documentsOf(ws));
    await expect(page.getByRole("heading", { level: 2, name: "Expiring or expired" })).toBeVisible();
    await expect(page.getByText("SPEC-JOINT-rev-A.pdf")).toHaveCount(0);
    await expect(lines(page)).toHaveCount(4);
    // Only Salmon is in scope: its two markets.
    await expect(page.locator("[data-market]")).toHaveCount(2);
    await axe(page);
    expect(errors).toEqual([]);
  });

  test("a workspace with no products and no documents gets the empty state", async ({ page, context, baseURL }) => {
    await signIn(context, other, baseURL!);
    const fresh = await workspace(other, "Empty workspace");
    const errors = watch(page);
    await page.goto(documentsOf(fresh));
    await expect(page.getByText("No documents yet")).toBeVisible();
    await expect(page.getByText("No product is on a market yet, so no market states its documents.")).toBeVisible();
    await expect(page.locator("[data-market]")).toHaveCount(0);
    await axe(page);
    expect(errors).toEqual([]);
  });

  test("a person who is not a member gets no access and no documents", async ({ page, context, baseURL }) => {
    await signIn(context, other, baseURL!);
    const errors = watch(page);
    await page.goto(documentsOf(ws));
    await expect(page.getByText("This workspace is not open to you")).toBeVisible();
    await expect(page.getByText("SPEC-0442-premix-PMX-118.pdf")).toHaveCount(0);
    await axe(page);
    expect(errors).toEqual([]);
  });
});
