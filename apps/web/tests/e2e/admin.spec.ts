// T-205 · the /admin content console: K03 term register and K04 coverage management, staff only.
// Every row these tests write is synthetic (TEST.T205.* rule keys, TEST-T205 sources and terms that are not
// regulatory text), written as the service role in setup only; every decision is a person's click in the browser,
// through the T-204 staff RPCs. They write to the shared `ref` tables, including insert-only accepted rule versions,
// so they run on the local stack only (@local-only, #35 question 7), never against staging.
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { parse } from "yaml";
import { REPO_ROOT } from "../visual/screens";
import { expectLikeBaseline } from "./support/baseline";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/database.types";
import { admin, haveStack, person, signIn, workspace, type Person } from "./support/people";
import { totp } from "./support/totp";

const nfr = parse(fs.readFileSync(path.join(REPO_ROOT, "spec/nfr.yaml"), "utf8")) as { quality: { visual_max_diff_pixel_ratio: number } };

function watch(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) errors.push(`${response.status()} ${response.url()}`);
  });
  return errors;
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

const run = randomBytes(4).toString("hex");
const RUN = run.toUpperCase();

type Staff = Person & { secret: string | null; enrolledAt: number };

/**
 * A staff person: app_metadata.nutrivo_staff set through the admin API (the only way it can be set) and a person
 * row. Staff work at aal2 (#35 Q6), so by default they enrol TOTP and the session proves it, as auth.spec.ts does.
 */
async function staffPerson(label: string, { totp: enrol = true } = {}): Promise<Staff> {
  const who = await person(label);
  await workspace(who, `${label} home`); // the person row a staff RPC needs (private.require_staff)
  let secret: string | null = null;
  if (enrol) {
    const enrolled = await who.db.auth.mfa.enroll({ factorType: "totp" });
    if (enrolled.error) throw enrolled.error;
    secret = enrolled.data.totp.secret;
    const verified = await who.db.auth.mfa.challengeAndVerify({ factorId: enrolled.data.id, code: totp(secret) });
    if (verified.error) throw verified.error;
  }
  const enrolledAt = Date.now();
  const set = await admin().auth.admin.updateUserById(who.userId, { app_metadata: { nutrivo_staff: true } });
  if (set.error) throw set.error;
  const refreshed = await who.db.auth.refreshSession(); // carries the new app_metadata, and keeps aal2
  if (refreshed.error || !refreshed.data.session) throw refreshed.error ?? new Error("no refreshed session");
  return { ...who, session: refreshed.data.session, secret, enrolledAt };
}

/** A new sign-in for the same account by a magic link: aal1 until the second factor is proved. */
async function freshSession(who: Person): Promise<Person> {
  const link = await admin().auth.admin.generateLink({ type: "magiclink", email: who.email });
  if (link.error) throw link.error;
  const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const verified = await db.auth.verifyOtp({ type: "email", token_hash: link.data.properties.hashed_token });
  if (verified.error || !verified.data.session) throw verified.error ?? new Error("no session from the magic link");
  return { ...who, session: verified.data.session, db };
}

async function personId(userId: string) {
  const { data, error } = await admin().schema("app").from("people").select("id").eq("user_id", userId).single();
  if (error) throw error;
  return data.id;
}

/** A synthetic stored source: kind eurlex with a sha256 and a storage path, as T-201 stores one. Not a real act. */
async function source(language: string) {
  const { data, error } = await admin()
    .schema("ref")
    .from("sources")
    .insert({
      kind: "eurlex",
      celex: `TEST-T205-${RUN}`,
      title: `TEST T-205 synthetic act ${RUN}`,
      url: `https://example.test/t205/${run}/${language}`,
      language,
      licence: "eu_reuse",
      retrieved_at: new Date().toISOString(),
      sha256: randomBytes(32).toString("hex"),
      storage_path: `test/t205/${run}/${language}.xhtml`,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function term(termKey: string, language: string, text: string, sourceId: string) {
  const { data, error } = await admin()
    .schema("ref")
    .from("term_entries")
    .insert({ term_key: termKey, language, term: text, kind: "prescribed_designation", article_ref: "TEST Art. 1(1)", source_id: sourceId })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function termRow(id: string) {
  const { data, error } = await admin().schema("ref").from("term_entries").select("status").eq("id", id).single();
  if (error) throw error;
  return data.status;
}

test.describe("@local-only /admin content console", () => {
  test.skip(!haveStack(), "needs the local Supabase stack: run through scripts/ci/e2e.sh (make e2e)");
  test.describe.configure({ mode: "serial" });

  let staff: Staff, ann: Person;
  let plSource: string, enSource: string;
  let plTerm: string, plReject: string, derived: string, held: string, gated: string;
  let candidate: string;
  const RULE = `TEST.T205.${RUN}`;
  const DRAFT = `2026.11-t205${run}`;
  const GAP = `GAP-TEST-T205-${RUN}`;
  const PL_TEXT = `TEST pełna karma ${run}`;
  const EN_TEXT = `TEST complete feed ${run}`;

  test.beforeAll(async () => {
    [staff, ann] = await Promise.all([staffPerson("t205-staff"), person("t205-ann")]);
    await workspace(ann, "Ann's own");
    [plSource, enSource] = await Promise.all([source("pl"), source("en")]);
    plTerm = await term(`TEST_T205_${RUN}_A`, "pl", PL_TEXT, plSource);
    await term(`TEST_T205_${RUN}_A`, "en", EN_TEXT, enSource);
    plReject = await term(`TEST_T205_${RUN}_B`, "pl", `TEST odrzucony ${run}`, plSource);
    gated = await term(`TEST_T205_${RUN}_E`, "pl", `TEST dwuetapowy ${run}`, plSource);
    held = await term(`TEST_T205_${RUN}_D`, "pl", `TEST wstrzymany ${run}`, plSource);
    // K03.must.1: a Polish string whose source is the English text, i.e. derived or translated.
    derived = await term(`TEST_T205_${RUN}_C`, "pl", `TEST przetłumaczony ${run}`, enSource);
    const value = { verified: true, extraction: { found: true, article_ref: "TEST Art. 1(1)", excerpt: `TEST synthetic excerpt ${run}`, params: { value: 1 } } };
    const inserted = await admin()
      .schema("ref")
      .from("rule_candidates")
      .insert({ source_id: plSource, article: "TEST Art. 1", proposed_rule_key: RULE, first_value: value, second_value: value, agree: true, decision: "needs_review" })
      .select("id")
      .single();
    if (inserted.error) throw inserted.error;
    candidate = inserted.data.id;
  });

  test("a signed-out visitor goes to sign-in, and a person who is not staff reads nothing", async ({ page, context, baseURL }) => {
    await context.clearCookies();
    await page.goto("/admin/terms");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fadmin%2Fterms$/);

    await signIn(context, ann, baseURL!);
    const errors = watch(page);
    for (const route of ["/admin/terms", "/admin/rules", "/admin/coverage", "/admin/glossary"]) {
      await page.goto(route);
      await expect(page.getByText("This console is for Nutrivo staff")).toBeVisible();
      await expect(page.getByText(PL_TEXT)).toHaveCount(0);
      await expect(page.locator("[data-term-detail], [data-candidate], [data-release-gate]")).toHaveCount(0);
    }
    await axe(page);
    // Under her own session every staff RPC refuses (42501), and the staff tables give her nothing.
    const refused = await ann.db.schema("app").rpc("decide_term", { p_term_entry: plTerm, p_decision: "accept" });
    expect(refused.error?.code).toBe("42501");
    const read = await ann.db.schema("ref").from("rule_candidates").select("id").eq("id", candidate);
    expect(read.data ?? []).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("[T-205] staff need aal2: an aal1 session is sent to two-step, its actions are refused, and aal2 gets through", async ({ page, context, baseURL }) => {
    test.setTimeout(120_000); // may wait once for the next 30-second TOTP window
    const errors = watch(page);
    const aal1 = await freshSession(staff);

    // A page opened at aal2, whose cookies then turn into an aal1 session: the layout is not rendered again, so the
    // action itself refuses, and nothing is written.
    await signIn(context, staff, baseURL!);
    await page.goto(`/admin/terms?entry=${gated}`);
    await expect(page.locator(`[data-term-detail="${gated}"]`)).toBeVisible();
    await signIn(context, aal1, baseURL!);
    await page.locator(`[data-term-detail="${gated}"]`).getByRole("button", { name: "ACCEPT" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Two-step sign-in is needed first" })).toBeVisible();
    expect(await termRow(gated)).toBe("candidate");

    // Every /admin route sends the aal1 session to the challenge, and shows no content first.
    for (const route of ["/admin/terms", "/admin/rules", "/admin/coverage", "/admin/glossary"]) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/auth\/mfa\?next=%2Fadmin$/);
      await expect(page.getByRole("heading", { name: "Type your two-step code" })).toBeVisible();
      await expect(page.getByText(PL_TEXT)).toHaveCount(0);
    }
    // Codes are single-use per 30-second window: wait for the next one if enrolment used this one.
    if (Math.floor(staff.enrolledAt / 30_000) === Math.floor(Date.now() / 30_000)) await page.waitForTimeout(31_000 - (Date.now() % 30_000));
    await page.getByLabel("Six-digit code").fill(totp(staff.secret!));
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/admin\/terms$/);
    await expect(page.getByRole("heading", { level: 1, name: "Acceptance queue" })).toBeVisible();

    // Staff without a factor enrol before anything of the console is shown.
    const newcomer = await staffPerson("t205-newcomer", { totp: false });
    await signIn(context, newcomer, baseURL!);
    await page.goto("/admin/coverage");
    await expect(page).toHaveURL(/\/auth\/mfa\?next=%2Fadmin$/);
    await expect(page.getByRole("heading", { name: "Set up two-step sign-in" })).toBeVisible();
    await expect(page.locator("[data-release-gate], [data-coverage]")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("the service-role key never reaches the browser", async ({ page, context, baseURL }) => {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    await signIn(context, staff, baseURL!);
    const bodies: Promise<string>[] = [];
    page.on("response", (r) => {
      if (/javascript|html|x-component|json/.test(r.headers()["content-type"] ?? "")) bodies.push(r.text().catch(() => ""));
    });
    for (const route of ["/admin/terms", "/admin/rules", "/admin/coverage", "/admin/glossary"]) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
    }
    const texts = await Promise.all(bodies);
    expect(texts.length).toBeGreaterThan(4);
    expect(texts.filter((t) => t.includes(key))).toEqual([]);
  });

  test("[K03.main] Term register: the main path works end to end", async ({ page, context, baseURL }) => {
    await signIn(context, staff, baseURL!);
    const errors = watch(page);
    await page.goto(`/admin/terms?entry=${plTerm}`);
    await expect(page.getByRole("heading", { level: 1, name: "Acceptance queue" })).toBeVisible();
    const detail = page.locator(`[data-term-detail="${plTerm}"]`);
    await expect(detail.getByRole("heading", { level: 2, name: PL_TEXT })).toBeVisible();
    await expect(detail.locator('[data-fact="Instrument language"]')).toHaveText("Polish — extracted, not translated");
    await expect(detail.locator('[data-fact="English reference only"]')).toHaveText(EN_TEXT);
    await axe(page);

    // Accept: the person's click, through app.decide_term; the entry leaves the queue.
    await detail.getByRole("button", { name: "ACCEPT" }).click();
    await expect(page.getByRole("status").filter({ hasText: `Accepted: ${PL_TEXT} (PL)` })).toBeVisible();
    await expect(page.locator(`[data-term-id="${plTerm}"]`)).toHaveCount(0);
    expect(await termRow(plTerm)).toBe("accepted");
    const decisions = await admin().schema("ref").from("term_decisions").select("decision, decided_by").eq("term_entry_id", plTerm);
    expect(decisions.data).toEqual([{ decision: "accept", decided_by: await personId(staff.userId) }]);

    // Reject records a decision too, and the entry never becomes accepted.
    await page.goto(`/admin/terms?entry=${plReject}`);
    await page.locator(`[data-term-detail="${plReject}"]`).getByRole("button", { name: "REJECT" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Rejected:" })).toBeVisible();
    expect(await termRow(plReject)).toBe("rejected");

    // Hold for review writes nothing and moves on (#35 question 3).
    await page.goto(`/admin/terms?entry=${derived}`);
    await page.getByRole("button", { name: "HOLD FOR REVIEW" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Held for review" })).toBeVisible();
    expect(await termRow(derived)).toBe("candidate");
    expect(errors).toEqual([]);
  });

  test("[K03.must.1] Never derived from an English row or translated (BE-11).", async ({ page, context, baseURL }) => {
    await signIn(context, staff, baseURL!);
    const errors = watch(page);
    await page.goto(`/admin/terms?entry=${derived}`);
    const detail = page.locator(`[data-term-detail="${derived}"]`);
    // The screen says why, and offers no acceptance of a string that is not from the Polish text.
    await expect(detail.locator('[data-be11="refused"]')).toContainText("never derived from another language or translated (BE-11)");
    await expect(detail.locator('[data-fact="Instrument language"]')).toHaveText("English — not this term's language");
    await expect(detail.getByRole("button", { name: "ACCEPT" })).toBeDisabled();
    // The English row is reference only: it is never what the queue offers as the Polish term.
    await page.goto(`/admin/terms?entry=${derived}`);
    await expect(detail.getByRole("heading", { level: 2 })).not.toHaveText(EN_TEXT);
    // The database refuses it too, under the staff person's own session.
    const refused = await staff.db.schema("app").rpc("decide_term", { p_term_entry: derived, p_decision: "accept" });
    expect(refused.error?.code).toBe("22023");
    expect(refused.error?.message).toContain("BE-11");
    expect(await termRow(derived)).toBe("candidate");
    expect(errors).toEqual([]);
  });

  test("[K04.main] Coverage management: the main path works end to end", async ({ page, context, baseURL }) => {
    test.setTimeout(120_000);
    await signIn(context, staff, baseURL!);
    const errors = watch(page);

    // A rule version is accepted by the person, from the stored extraction (K01/K02 → J02).
    await page.goto("/admin/rules");
    const card = page.locator(`[data-candidate="${candidate}"]`);
    await card.getByLabel("First key").check();
    await card.getByLabel("Title").fill(`TEST T-205 rule ${run}`);
    await card.getByLabel("Shape").selectOption("mandatory_particular");
    await card.getByLabel("Domain").selectOption("composition");
    await card.getByLabel("Held on node").selectOption("EU-SE");
    await card.getByLabel(/Applicability/).fill('{"all": []}');
    await card.getByLabel(/Effect of the change/).selectOption("new_obligation");
    await card.getByRole("button", { name: "Accept this rule version" }).click();
    await expect(page.locator('[data-said="rules"]')).toHaveText(`Accepted as ${RULE} v1, with your name and the time.`);
    await expect(card).toHaveCount(0);
    await axe(page);

    // A draft, a member, a gap, and the node × domain set to partial with that gap.
    await page.goto("/admin/coverage");
    const create = page.getByRole("form", { name: "Start a draft" });
    await create.getByLabel("New draft id").fill(DRAFT);
    await create.getByRole("button", { name: "Start a draft" }).click();
    await expect(page).toHaveURL(new RegExp(`draft=${DRAFT.replace(".", "\\.")}`));
    const add = page.getByRole("form", { name: "Add a rule version" });
    await add.getByLabel("Accepted rule version").selectOption(`${RULE}:1`);
    await add.getByRole("button", { name: "Put in the draft" }).click();
    await expect(page.locator(`[data-member="${RULE}"]`)).toContainText("MISSING");

    const gap = page.getByRole("form", { name: "Open a gap" });
    await gap.getByLabel("Gap id").fill(GAP);
    await gap.getByLabel("Node").selectOption("EU-SE");
    await gap.getByLabel("Domain").selectOption("composition");
    await gap.getByLabel("Reason").selectOption("partially_encoded");
    await gap.getByLabel("What is missing").fill(`TEST T-205 synthetic gap ${run}`);
    await gap.getByRole("button", { name: "Open the gap" }).click();
    await expect(page.locator('[data-said="open-gap"]')).toHaveText(`Gap ${GAP} is open.`);

    await page.goto(`/admin/coverage?draft=${DRAFT}&node=EU-SE`);
    const cell = page.locator('[data-coverage="EU-SE:composition"]');
    await cell.getByLabel("State").selectOption("partial");
    await cell.getByLabel(/^Gap/).selectOption(GAP);
    await cell.getByLabel("Last checked").fill("2026-10-26");
    await cell.getByRole("button", { name: "Save" }).click();
    await expect(cell).toHaveAttribute("data-state", "partial");
    const row = await admin().schema("ref").from("ruleset_draft_coverage").select("state, gap_id, last_checked_at")
      .eq("draft_id", DRAFT).eq("node_id", "EU-SE").eq("domain", "composition").single();
    expect(row.data).toEqual({ state: "partial", gap_id: GAP, last_checked_at: "2026-10-26" });

    // The release is refused, and the screen says why: no fixture run is recorded yet (T-206).
    const gate = page.locator("[data-release-gate]");
    await expect(gate).toHaveAttribute("data-release-gate", "blocked");
    await expect(gate.locator("[data-blockers]")).toContainText("No fixture run is recorded for this draft");
    await gate.getByRole("button", { name: `Release ${DRAFT}` }).click();
    await expect(page.locator('[data-said="release"]')).toContainText("Refused by the release gate (K05)");
    const released = await admin().schema("ref").from("ruleset_versions").select("id").eq("id", DRAFT);
    expect(released.data).toEqual([]);
    await axe(page);
    expect(errors).toEqual([]);
  });

  test("[K04.must.1] Complete only when every rule the domain needs is accepted and tested (BE-10).", async ({ page, context, baseURL }) => {
    await signIn(context, staff, baseURL!);
    const errors = watch(page);
    await page.goto(`/admin/coverage?draft=${DRAFT}&node=EU-SE`);
    const cell = page.locator('[data-coverage="EU-SE:composition"]');
    // The member rule has no fixtures: complete is refused by the database (P0010) and the state stays partial.
    await cell.getByLabel("State").selectOption("complete");
    await cell.getByRole("button", { name: "Save" }).click();
    await expect(page.locator('[data-said="coverage-composition"]')).toContainText("Refused by BE-10");
    await page.reload();
    await expect(page.locator('[data-coverage="EU-SE:composition"]')).toHaveAttribute("data-state", "partial");

    // Synthetic fixtures for passed, failed and withheld (setup, as the worker's fixture drafting would write them).
    const fixtures = await admin().schema("ref").from("rule_fixtures").insert(
      (["passed", "failed", "withheld"] as const).map((o) => ({ rule_key: RULE, version: 1, name: `TEST ${o} ${run}`, input: { test: o }, expected_outcome: o })),
    );
    if (fixtures.error) throw fixtures.error;
    await page.reload();
    await expect(page.locator(`[data-member="${RULE}"]`)).toContainText("TESTED");
    const tested = page.locator('[data-coverage="EU-SE:composition"]');
    await tested.getByLabel("State").selectOption("complete");
    await tested.getByRole("button", { name: "Save" }).click();
    await expect(tested).toHaveAttribute("data-state", "complete");

    // Still no release: tested is not passed, and no run is recorded. The screen shows it, never hides it.
    await expect(page.locator("[data-blockers]")).toContainText("No fixture run is recorded for this draft");
    // A domain the draft's rules do not cover cannot be complete.
    const other = page.locator('[data-coverage="EU-SE:type_geometry"]');
    await other.getByLabel("State").selectOption("complete");
    await other.getByRole("button", { name: "Save" }).click();
    await expect(page.locator('[data-said="coverage-type_geometry"]')).toContainText("Refused by BE-10");
    expect(errors).toEqual([]);
  });

  test("a draft holding every accepted rule's latest version offers nothing more, and reads cleanly", async ({ page, context, baseURL }) => {
    await signIn(context, staff, baseURL!);
    const errors = watch(page);
    // Set up on purpose, so this state never depends on rows another test left behind.
    const full = `2026.11-t205n${run}`;
    const made = await staff.db.schema("app").rpc("create_ruleset_draft", { p_id: full });
    expect(made.error).toBeNull();
    const accepted = await admin().schema("ref").from("rule_versions").select("rule_key, version").eq("status", "accepted");
    if (accepted.error) throw accepted.error;
    const latest = new Map<string, number>();
    for (const v of accepted.data) latest.set(v.rule_key, Math.max(v.version, latest.get(v.rule_key) ?? 0));
    expect(latest.get(RULE)).toBe(1);
    for (const [key, version] of latest) {
      const set = await staff.db.schema("app").rpc("set_draft_member", { p_draft: full, p_rule_key: key, p_version: version });
      expect(set.error, key).toBeNull();
    }
    await page.goto(`/admin/coverage?draft=${full}&node=EU-SE`);
    await expect(page.locator(`[data-member="${RULE}"]`)).toBeVisible();
    await expect(page.locator('[data-offer="none"]')).toContainText("Every accepted rule version is already in the draft.");
    await expect(page.getByRole("form", { name: "Add a rule version" })).toHaveCount(0);
    await axe(page);
    expect(errors).toEqual([]);
  });

  test("S-NV2-029: the term queue's routing note and decision row match the design at 1600 px", async ({ page, context, baseURL }) => {
    await signIn(context, staff, baseURL!);
    await page.goto(`/admin/terms?entry=${held}`);
    await expect(page.locator(`[data-term-detail="${held}"]`).getByRole("button", { name: "ACCEPT" })).toBeEnabled();
    const maxDiff = nfr.quality.visual_max_diff_pixel_ratio;
    // Regions without mock data (#35 question 2): measured in the design file at 1600 px.
    await expectLikeBaseline(page, page.locator('[data-region="routing"]'), "S-NV2-029", { x: 242, y: 527, width: 280, height: 297, fractionY: 0.625 }, maxDiff);
    await expectLikeBaseline(page, page.locator('[data-region="decision"]'), "S-NV2-029", { x: 567, y: 432, width: 600, height: 77, fractionY: 0.15625 }, maxDiff);
  });

  test("no dead controls on any /admin route", async ({ page, context, baseURL }) => {
    test.setTimeout(240_000);
    await signIn(context, staff, baseURL!);
    // A draft of its own, so the crawl's clicks change nothing another test reads.
    const crawlDraft = `2026.11-t205c${run}`;
    const made = await staff.db.schema("app").rpc("create_ruleset_draft", { p_id: crawlDraft });
    expect(made.error).toBeNull();
    // Decisions that write content are exercised by the K03/K04 tests above, not clicked blind here.
    const covered = /^(ACCEPT|REJECT|Reject|Accept this rule version)$/;
    for (const route of [`/admin/terms?entry=${derived}`, "/admin/rules", `/admin/coverage?draft=${crawlDraft}&node=EU-SE`, "/admin/glossary"]) {
      const errors = watch(page);
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.waitForLoadState("networkidle");
      const controls = page.locator("main a, main button, nav[aria-label='Admin'] a").filter({ visible: true });
      const count = await controls.count();
      expect(count, route).toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        await page.goto(route);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await page.waitForLoadState("networkidle");
        const control = page.locator("main a, main button, nav[aria-label='Admin'] a").filter({ visible: true }).nth(i);
        const name = (await control.innerText()).trim();
        const tag = await control.evaluate((el) => el.tagName);
        if (tag === "A") {
          const href = await control.getAttribute("href");
          expect(href, `${route}: link "${name}"`).toBeTruthy();
          expect((await page.request.get(href!)).status(), `${route}: link "${name}"`).toBeLessThan(400);
          continue;
        }
        if (covered.test(name) || (await control.isDisabled())) continue;
        const before = await page.evaluate(() => document.body.innerHTML);
        let requested = false;
        page.on("request", () => (requested = true));
        await control.click();
        const invalid = await page.evaluate(() => document.querySelectorAll("form :invalid").length);
        await expect
          .poll(async () => requested || invalid > 0 || (await page.evaluate(() => document.body.innerHTML)) !== before, { message: `${route}: "${name}" does something`, timeout: 5_000 })
          .toBe(true);
        page.removeAllListeners("request");
      }
      await axe(page);
      expect(errors, route).toEqual([]);
    }
  });
});
