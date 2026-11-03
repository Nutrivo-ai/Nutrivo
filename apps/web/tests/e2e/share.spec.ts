// T-601 · I02 Share a report (BE-27) on S-NV2-026 Export, send, share. An editor shares an issued report by link and by
// email, sees and revokes the shares, and downloads the PDF; revoking stops the share and never the verification of the
// document. A report is seeded as the worker writes it (T-405), its PDF in the reports bucket. The recipient's page
// /share/<token> waits on question 1 of #58, so the share's own answer is read from app.open_share as the service
// role here (test setup only), the way that page will read it.
import { createHash, randomBytes } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/database.types";
import { expectLikeBaseline, type Region } from "./support/baseline";
import { haveMail, shareLinkFromEmail } from "./support/mail";
import { admin, haveStack, person, signIn, workspace, type Person } from "./support/people";
import { maxDiffPixelRatio } from "./support/public";

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
}

/** 128 random bits in base32, 26 characters: the reference shape the worker mints. */
function newRef() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  return Array.from(randomBytes(26), (b) => alphabet[b % 32]).join("");
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const MIN_PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

/** The screen, once the route has streamed in behind w/[workspace]/loading.tsx (see triage.spec.ts). */
function screen(page: Page) {
  return page.locator('main[data-screen="S-NV2-026"]').filter({ visible: true });
}
async function openSend(page: Page, url: string, state: "loaded" | "no-report") {
  await page.goto(url);
  await expect(screen(page).locator(`[data-send-state="${state}"]`)).toBeVisible();
}

async function share(id: string) {
  const { data, error } = await admin().schema("app").from("shares").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

/** What the share page will be told for a token (app.open_share, service role only). */
async function openShare(token: string) {
  const { data, error } = await admin().schema("app").rpc("open_share", { p_token: token, p_user_agent: "e2e" });
  if (error) throw error;
  return data as Record<string, unknown>;
}

// The free-labels panel and the "Send it" heading row, where the design draws them at 1600 px. The rest of the left
// column is wider than the design's, which draws the Compliance Worker panel beside it (out of scope, #24).
const S_NV2_026: Record<string, Region> = {
  freePanel: { x: 860, y: 90, width: 330, height: 258, fractionY: 0.6875 },
  sendHeading: { x: 242, y: 556, width: 596, height: 26, fractionY: 0.453125 },
};

test.describe("share a report (I02, S-NV2-026)", () => {
  test.skip(!haveStack(), "needs the local stack: scripts/ci/e2e.sh");
  test.describe.configure({ mode: "serial" });

  let ed: Person, vic: Person;
  let ws: string, productId: string, emptyProductId: string, reportId: string, ref: string;
  const url = (p = productId) => `/w/${ws}/products/${p}/report/send`;

  test.beforeAll(async () => {
    [ed, vic] = await Promise.all([person("t601-ed"), person("t601-vic")]);
    ws = await workspace(ed, "Halden Pet Nutrition");
    await workspace(vic, "Vic's own");
    const db = admin().schema("app");
    const { data: vicPerson, error } = await db.from("people").select("id").eq("user_id", vic.userId).single();
    if (error) throw error;
    const grant = await db.from("memberships").insert({ workspace_id: ws, person_id: vicPerson.id, role: "viewer" });
    if (grant.error) throw grant.error;
    const fam = await db.from("families").insert({ workspace_id: ws, name: "Adult" }).select("id").single();
    if (fam.error) throw fam.error;
    const [prod, empty] = await Promise.all([
      db.from("products").insert({ workspace_id: ws, family_id: fam.data.id, name: "Salmon & Rice Adult 12 kg", stage: "active" }).select("id").single(),
      db.from("products").insert({ workspace_id: ws, family_id: fam.data.id, name: "Duck & Oat", stage: "in_development" }).select("id").single(),
    ]);
    if (prod.error) throw prod.error;
    if (empty.error) throw empty.error;
    productId = prod.data.id;
    emptyProductId = empty.data.id;
    ref = newRef();
    const pdfPath = `${ws}/${productId}/${ref}.pdf`;
    const up = await admin().storage.from("reports").upload(pdfPath, MIN_PDF, { contentType: "application/pdf" });
    if (up.error) throw up.error;
    const report = await db
      .from("reports")
      .insert({
        workspace_id: ws, product_id: productId, node_id: "EU-DE", ref, check_ids: [], ruleset_version: "0000.00-empty",
        artwork_sha: "4f1c" + "0".repeat(56) + "9ab2", has_not_assessed: true, pdf_path: pdfPath, created_at: "2026-08-25T14:08:00Z",
      })
      .select("id")
      .single();
    if (report.error) throw report.error;
    reportId = report.data.id;
  });

  test("[I02.main] Share a report: the main path works end to end", async ({ page, context, baseURL }) => {
    test.setTimeout(180_000);
    await signIn(context, ed, baseURL!);
    const errors = watch(page);
    await openSend(page, url(), "loaded");
    const s = screen(page);
    await expect(s.getByRole("heading", { level: 2, name: "Salmon & Rice Adult 12 kg · Germany" })).toBeVisible();
    await expect(s.getByText(ref, { exact: true })).toBeVisible();
    await expect(s.getByText("Nobody", { exact: true })).toBeVisible();
    await expect(s.locator("[data-shares-empty]")).toBeVisible();
    await axe(page);
    await expectLikeBaseline(page, s.getByRole("region", { name: "On your three free labels" }), "S-NV2-026", S_NV2_026.freePanel, maxDiffPixelRatio);
    await expectLikeBaseline(page, s.getByRole("heading", { name: "Send it" }).locator(".."), "S-NV2-026", S_NV2_026.sendHeading, maxDiffPixelRatio);

    // Share by link: the URL is shown once; only its SHA-256 is stored; the share opens the report and is logged.
    await s.getByRole("button", { name: "Create a link" }).click();
    const field = s.getByLabel("Share link");
    await expect(field).toBeVisible();
    const link = await field.inputValue();
    const token = /\/share\/([A-Za-z0-9_-]{43})$/.exec(link)?.[1];
    expect(token, link).toBeTruthy();
    const { data: rows } = await admin().schema("app").from("shares").select("id, token_hash, channel, expires_at").eq("report_id", reportId);
    expect(rows).toHaveLength(1);
    expect(rows![0].channel).toBe("link");
    expect(String(rows![0].token_hash).replace(/^\\x/, "")).toBe(sha256(token!));
    expect(Date.parse(rows![0].expires_at!) - Date.now()).toBeGreaterThan(29 * 86_400_000);
    const opened = await openShare(token!);
    expect(opened).toMatchObject({ status: "open", ref, product_name: "Salmon & Rice Adult 12 kg", has_not_assessed: true });
    const { data: log } = await admin().schema("app").from("share_access_log").select("share_id").eq("share_id", rows![0].id);
    expect(log).toHaveLength(1);
    await expect(s.locator(`[data-share="${rows![0].id}"]`)).toHaveAttribute("data-share-status", "live");

    // Email: the notify job holds ids only, and the worker emails Template 01 with its own token.
    const recipient = `buyer-${randomBytes(4).toString("hex")}@example.test`;
    await s.getByLabel("Expires").selectOption("never");
    await s.getByLabel("Recipient email").fill(recipient);
    await s.getByRole("button", { name: "Send", exact: true }).click();
    await expect(s.getByText(`Queued for ${recipient}.`)).toBeVisible();
    await expect(s.locator("li[data-share]").filter({ hasText: recipient })).toContainText("NO EXPIRY");
    const { data: mailed } = await admin().schema("app").from("shares").select("id, expires_at").eq("report_id", reportId).eq("channel", "email").single();
    expect(mailed!.expires_at).toBeNull();
    const { data: jobs } = await admin().schema("app").from("jobs").select("payload").eq("idempotency_key", `share:${mailed!.id}`);
    expect(jobs).toHaveLength(1);
    expect(Object.keys(jobs![0].payload as object).sort()).toEqual(["request_id", "share_id", "template"]);
    if (haveMail()) {
      const path = await shareLinkFromEmail(recipient);
      const emailed = path.split("/").pop()!;
      expect((await share(mailed!.id)).token_hash.replace(/^\\x/, "")).toBe(sha256(emailed));
      expect(await openShare(emailed)).toMatchObject({ status: "open", ref });
    }

    // Export: the stored PDF downloads under the editor's own session.
    const download = page.waitForEvent("download");
    await s.getByRole("button", { name: "Download the PDF" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`${ref}.pdf`);
    expect(Buffer.concat((await (await file.createReadStream()).toArray()) as Buffer[]).subarray(0, 5).toString()).toBe("%PDF-");
    await axe(page);
    expect(errors).toEqual([]);
  });

  test("[I02.must.1] Revoking a link stops the page, never verification of the document (BE-27).", async ({ page, context, baseURL }) => {
    await signIn(context, ed, baseURL!);
    const errors = watch(page);
    await openSend(page, url(), "loaded");
    const s = screen(page);
    await s.getByRole("button", { name: "Create a link" }).click();
    const token = /\/share\/([A-Za-z0-9_-]{43})$/.exec(await s.getByLabel("Share link").inputValue())![1];
    expect(await openShare(token)).toMatchObject({ status: "open" });
    const { data } = await admin().schema("app").from("shares").select("id").eq("token_hash", `\\x${sha256(token)}`).single();
    const row = s.locator(`li[data-share="${data!.id}"]`);
    await expect(row).toHaveAttribute("data-share-status", "live");

    await row.getByRole("button", { name: /^Revoke/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("its reference still verifies");
    await axe(page);
    await dialog.getByRole("button", { name: "Revoke" }).click();
    await expect(row).toHaveAttribute("data-share-status", "revoked");
    await expect(row.getByRole("button")).toHaveCount(0);
    expect((await share(data!.id)).revoked_at).not.toBeNull();

    // The share answers exactly as an unknown token does: the page stops.
    expect(await openShare(token)).toEqual({ status: "unknown" });
    expect(await openShare("A".repeat(43))).toEqual({ status: "unknown" });
    // The document still verifies: public.verify_reference as anon, the one function the verify Edge Function calls
    // (contract 8). Not through /verify itself: that page allows 30 checks a minute per visitor, and every e2e test is
    // the same visitor, so this spec leaves that budget to verify.spec.ts, which tests the page.
    const anon = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    const verified = await anon.rpc("verify_reference", { p_ref: ref });
    expect(verified.error).toBeNull();
    expect((verified.data as { status: string }).status).toBe("current");
    expect(errors).toEqual([]);
  });

  test("states: no report yet, not found, and a viewer's no-permission; no dead controls", async ({ page, context, baseURL }) => {
    await signIn(context, ed, baseURL!);
    const errors = watch(page);
    await openSend(page, url(emptyProductId), "no-report");
    await expect(screen(page).getByText("No report has been issued for this product yet")).toBeVisible();
    await axe(page);
    await page.goto(url("00000000-0000-4000-8000-000000000000"));
    await expect(screen(page).getByText("This product is not in this workspace")).toBeVisible();
    await axe(page);

    // Every link on the loaded screen answers, and every button does something visible.
    await openSend(page, url(), "loaded");
    const s = screen(page);
    const hrefs = await s.locator("a").filter({ visible: true }).evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    expect(hrefs).toEqual(expect.arrayContaining([`/verify/${ref}`, `/w/${ws}/billing/plans`]));
    for (const href of new Set(hrefs)) {
      expect(href).toMatch(/^\//);
      // The verification link is checked by its address only, to spare /verify's per-visitor budget (see above).
      if (href === `/verify/${ref}`) continue;
      const response = await page.request.get(href!, { maxRedirects: 0 });
      expect(response.status(), href!).toBeLessThan(400);
    }
    await s.getByLabel("Recipient email").fill("not an address");
    await s.getByRole("button", { name: "Send", exact: true }).click();
    await expect(s.getByRole("alert")).toHaveText("Enter one email address.");
    expect(errors).toEqual([]);

    await context.clearCookies();
    await signIn(context, vic, baseURL!);
    await page.goto(url());
    await expect(page.locator('main[data-screen="S-NV2-026"]').filter({ visible: true }).getByText("Your role cannot open Export, send, share")).toBeVisible();
    await axe(page);
    // RLS lets a viewer read the shares, but app.create_share refuses them.
    const refused = await vic.db.schema("app").rpc("create_share", { p_report: reportId, p_channel: "link" });
    expect(refused.error?.code).toBe("42501");
  });
});
