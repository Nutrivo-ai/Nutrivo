// T-802 · Supplier links on the full local stack (scripts/ci/e2e.sh): H02 an editor asks a supplier for a document on
// Suppliers (S-NV2-014); the worker mints the link, stores only its hash and emails it (Mailpit); H03 the supplier,
// with no account, opens the link on the Supplier portal (S-NV2-028) and uploads a PDF through the supplier-upload
// Edge Function; the worker scans it (CI's worker scans with SCAN_MODE=eicar_only, refused when deployed) and promotes
// it as a new row; the request reads Received and the document reaches Documents once. A used, unknown or malformed
// link reads the same (H03.fail.1).
//
// One synthetic document requirement (EU-MT, a market no other spec sells in) is inserted so a type is "encoded", and
// removed after the run: no requirement is encoded yet (#68 question 1, #69 question 3). Each screen is compared with
// its baseline on the regions the design draws the same for any data.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { expectLikeBaseline } from "./support/baseline";
import { supplierLinkFromEmail } from "./support/mail";
import { admin, haveStack, person, signIn, workspace, type Person } from "./support/people";
import { axe, maxDiffPixelRatio, watch } from "./support/public";

const FIXTURE_BASIS = "synthetic e2e fixture (T-802): not regulatory content";
const DOC_TYPE = "t802_e2e_specification";
// Regions of the baselines at 1600 px (design boxes measured from the design file's "suppliers" and "supp" screens).
const REGION = {
  heading: { x: 242, y: 90, width: 71, height: 19, fractionY: 0.6875 },
  kicker: { x: 869, y: 109, width: 302, height: 15, fractionY: 0.6875 },
  intro: { x: 242, y: 90, width: 606, height: 40, fractionY: 0.6875 },
  canDo: { x: 889, y: 350, width: 282, height: 15, fractionY: 0.609375 },
} as const;
const PDF = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");

const suppliersOf = (ws: string) => `/w/${ws}/library/suppliers`;
const functionUrl = () => `${process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "")}/functions/v1/supplier-upload`;

async function askFunction(token: string) {
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const res = await fetch(functionUrl(), {
    method: "POST",
    headers: { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  return { status: res.status, body: await res.text() };
}

async function stateOf(page: Page, supplier: string) {
  return page.getByRole("row").filter({ hasText: supplier }).locator("[data-request-state]").getAttribute("data-request-state");
}

test.describe("Supplier links", () => {
  test.skip(!haveStack(), "needs the local Supabase stack: run through scripts/ci/e2e.sh (make e2e)");
  test.describe.configure({ mode: "serial" });

  let ada: Person, vera: Person;
  let ws: string;
  let link = "";
  const supplierEmail = `t802-specs-${randomUUID().slice(0, 8)}@supplier.test`;
  const requirementIds: string[] = [];

  test.beforeAll(async () => {
    [ada, vera] = await Promise.all([person("t802-ada"), person("t802-vera")]);
    ws = await workspace(ada, "Kruuse Pet Nutrition");
    await workspace(vera, "Vera's own");   // her people row comes with her first workspace
    const service = admin();
    const who = await service.schema("app").from("people").select("id").eq("user_id", vera.userId).single();
    if (who.error) throw who.error;
    const grant = await service.schema("app").from("memberships").insert({ workspace_id: ws, person_id: who.data.id, role: "viewer" });
    if (grant.error) throw grant.error;
    const reqs = await service
      .schema("ref")
      .from("document_requirements")
      .insert({ node_id: "EU-MT", product_class: "pet_food", doc_type: DOC_TYPE, legal_basis: FIXTURE_BASIS })
      .select("id");
    if (reqs.error) throw reqs.error;
    requirementIds.push(...reqs.data.map((r) => r.id));
  });

  test.afterAll(async () => {
    if (requirementIds.length) await admin().schema("ref").from("document_requirements").delete().in("id", requirementIds);
  });

  test("[H02.main] an editor asks a supplier for a document and the supplier is emailed a link", async ({ page, context, baseURL }) => {
    await signIn(context, ada, baseURL!);
    const errors = watch(page);
    await page.goto(suppliersOf(ws));
    await expect(page.getByRole("heading", { level: 1, name: "Specifications, expiry and requests" })).toBeVisible();
    await expect(page.getByText("No suppliers added")).toBeVisible();
    await axe(page);
    await expectLikeBaseline(page, page.getByRole("heading", { level: 2, name: "Suppliers" }), "S-NV2-014", REGION.heading, maxDiffPixelRatio);
    await expectLikeBaseline(page, page.getByText("Spec request · draft"), "S-NV2-014", REGION.kicker, maxDiffPixelRatio);

    const form = page.getByTestId("request-form");
    await form.getByLabel("Supplier name").fill("Aldrich Nutrition");
    await form.getByLabel("Supplier email").fill(supplierEmail);
    await form.getByLabel("What you need").fill("Current premix specification for PMX-118");
    await form.getByLabel("Document type").selectOption(DOC_TYPE);
    await form.getByRole("button", { name: "Send through the supplier portal" }).click();
    await expect(page.getByTestId("request-result")).toHaveText(/Request sent/);

    // The worker sends the email; the row reads Awaiting upload once the link is issued.
    await expect.poll(async () => {
      await page.reload();
      return stateOf(page, "Aldrich Nutrition");
    }, { timeout: 90_000 }).toBe("sent");
    link = await supplierLinkFromEmail(supplierEmail);
    expect(link).toMatch(/^\/supplier\/[A-Za-z0-9_-]{43}$/);
    expect(errors).toEqual([]);
  });

  test("[H02.must.1] the raw token is never stored, only its hash", async () => {
    const token = link.split("/").pop()!;
    const { data, error } = await admin().schema("app").from("document_requests").select("*").eq("workspace_id", ws);
    if (error) throw error;
    expect(data).toHaveLength(1);
    expect(JSON.stringify(data)).not.toContain(token);
    const stored = String(data[0].token_hash).replace(/^\\x/, "");
    expect(stored).toBe(createHash("sha256").update(token).digest("hex"));
    const jobs = await admin().schema("app").from("jobs").select("payload, progress").eq("workspace_id", ws);
    expect(JSON.stringify(jobs.data)).not.toContain(token);
  });

  test("[H03.main] the supplier uploads through the link, the scan promotes it and the request is received", async ({ browser, baseURL }) => {
    const supplier = await browser.newContext({ baseURL });   // no session: a supplier has no account
    const page = await supplier.newPage();
    const errors = watch(page);
    await page.goto(link);
    await expect(page.getByTestId("supplier-title")).toHaveText("Current premix specification for PMX-118");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("Document request from Kruuse Pet Nutrition");
    await expect(page.getByTestId("supplier-item-state")).toHaveText("OUTSTANDING");
    await axe(page);
    await expectLikeBaseline(page, page.getByText("The supplier's own view, reached by a scoped link."), "S-NV2-028", REGION.intro, maxDiffPixelRatio);
    await expectLikeBaseline(page, page.getByText("What this link can do"), "S-NV2-028", REGION.canDo, maxDiffPixelRatio);

    await page.getByTestId("supplier-file").setInputFiles({ name: "PMX-118 specification.pdf", mimeType: "application/pdf", buffer: PDF });
    await page.getByTestId("supplier-send").click();
    await expect(page.getByTestId("supplier-result")).toHaveAttribute("data-outcome", "received", { timeout: 30_000 });
    await expect(page.getByTestId("supplier-item-state")).toHaveText("RECEIVED");
    await axe(page);
    expect(errors).toEqual([]);
    await supplier.close();

    // The scan job promotes the upload as a new row and fulfils the request.
    await expect.poll(async () => {
      const r = await admin().schema("app").from("document_requests").select("fulfilled_at").eq("workspace_id", ws).single();
      return r.data?.fulfilled_at ?? null;
    }, { timeout: 90_000 }).not.toBeNull();
    const docs = await admin().schema("app").from("supplier_documents").select("scan_status, storage_path, promoted_from").eq("workspace_id", ws);
    expect(docs.data?.map((d) => d.scan_status).sort()).toEqual(["clean", "quarantine"]);
    expect(docs.data?.find((d) => d.scan_status === "clean")?.promoted_from).toBeTruthy();
  });

  test("[H03.main] the editor sees it received, and Documents lists it once", async ({ page, context, baseURL }) => {
    await signIn(context, ada, baseURL!);
    await page.goto(suppliersOf(ws));
    await expect.poll(() => stateOf(page, "Aldrich Nutrition")).toBe("received");
    await expect(page.getByRole("row").filter({ hasText: "Aldrich Nutrition" })).toContainText("1 / 1");
    await page.goto(`/w/${ws}/documents`);
    await expect(page.getByRole("list", { name: "Documents" }).getByRole("listitem")).toHaveCount(1);
    await expect(page.getByText("PMX-118-specification.pdf")).toBeVisible();
  });

  test("[H03.must.1] the link was single use: it opens nothing and accepts nothing more", async ({ browser, baseURL }) => {
    const page = await (await browser.newContext({ baseURL })).newPage();
    await page.goto(link);
    await expect(page.getByTestId("supplier-unavailable")).toContainText("This link is no longer open.");
    await expect(page.getByTestId("supplier-file")).toHaveCount(0);
  });

  test("[H03.fail.1] a used, unknown or malformed link gets the same generic answer", async ({ browser, baseURL }) => {
    const used = link.split("/").pop()!;
    const unknown = randomBytes(32).toString("base64url");
    const answers = await Promise.all([askFunction(used), askFunction(unknown), askFunction("short")]);
    for (const a of answers) expect(a).toEqual({ status: 404, body: JSON.stringify({ error: "link_unavailable" }) });

    const page = await (await browser.newContext({ baseURL })).newPage();
    const texts: string[] = [];
    for (const path of [link, `/supplier/${unknown}`, "/supplier/short"]) {
      await page.goto(path);
      // textContent, not innerText: the words, independent of whether the styles had applied when it was read.
      texts.push((await page.getByTestId("supplier-unavailable").textContent()) ?? "");
    }
    expect(texts[0]).toContain("This link is no longer open.");
    expect(texts).toEqual([texts[0], texts[0], texts[0]]);
    expect(texts[0]).not.toMatch(/used|expired|unknown|Kruuse/i);
  });

  test("[H02.main] a viewer is told why they cannot send, never given a dead button", async ({ page, context, baseURL }) => {
    await signIn(context, vera, baseURL!);
    await page.goto(suppliersOf(ws));
    const form = page.getByTestId("request-form");
    await expect(form.getByRole("button", { name: "Send through the supplier portal" })).toBeDisabled();
    await expect(form).toContainText("Only an editor can ask a supplier for a document.");
    await expect(page.getByRole("row").filter({ hasText: "Aldrich Nutrition" })).toBeVisible();
    await axe(page);
  });
});
