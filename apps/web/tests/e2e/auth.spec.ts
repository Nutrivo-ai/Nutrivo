// T-103 · Sign in and start a session (A02), change or reset a password (A07), on the full local stack: real Supabase
// Auth, its emails read back from Mailpit, the audit read with the service role. Every person and workspace is new.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { parse } from "yaml";
import { REPO_ROOT } from "../visual/screens";
import { expectLikeBaseline } from "./support/baseline";
import { haveMail, linkFromEmail } from "./support/mail";
import { admin, haveStack, person, signIn, workspace, type Person } from "./support/people";
import { totp } from "./support/totp";

const nfr = parse(fs.readFileSync(path.join(REPO_ROOT, "spec/nfr.yaml"), "utf8")) as {
  quality: { visual_max_diff_pixel_ratio: number; axe_serious_or_critical: number };
};
const maxDiff = nfr.quality.visual_max_diff_pixel_ratio;

// The card regions of the Account Recovery baselines at 1600 px: the card's box starts at x 260, y 156.375.
const CARD = {
  "S-REC-001": { x: 260, y: 156, width: 440, height: 422, fractionY: 0.375 },
  "S-REC-002": { x: 260, y: 156, width: 440, height: 548, fractionY: 0.375 },
  "S-REC-004": { x: 260, y: 156, width: 440, height: 501, fractionY: 0.375 },
} as const;

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

/** A confirmed auth user with a password, and the workspace they admin (created through app.create_workspace). */
async function member(label: string, password: string, workspaceName?: string) {
  const who = await person(label);
  const { error } = await admin().auth.admin.updateUserById(who.userId, { password });
  if (error) throw error;
  const ws = workspaceName ? await workspace(who, workspaceName) : null;
  return { who, ws };
}

/** Adds `who` to `ws` as `role`, the way an accepted invitation would leave it (service role: test setup only). */
async function join(who: Person, ws: string, role: string, extra: Record<string, unknown> = {}) {
  const db = admin().schema("app");
  const { data: me, error: pe } = await db.from("people").upsert(
    { user_id: who.userId, display_name: who.email.split("@")[0], email: who.email },
    { onConflict: "user_id" },
  ).select("id").single();
  if (pe) throw pe;
  const { error } = await db.from("memberships").insert({ workspace_id: ws, person_id: me.id, role, ...extra });
  if (error) throw error;
  return me.id as string;
}

async function signInWithPassword(page: Page, email: string, password: string) {
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function auditOf(personId: string, kind: string) {
  const { data, error } = await admin().schema("app").from("audit_events").select("*").eq("actor_id", personId).eq("kind", kind);
  if (error) throw error;
  return data;
}

async function personIdOf(who: Person) {
  const { data } = await admin().schema("app").from("people").select("id").eq("user_id", who.userId).single();
  return data!.id as string;
}

test.describe("auth screens against the design", () => {
  test("[A07.main] S-REC-001 forgotten password matches its baseline card at 1600 px, and passes axe", async ({ page }) => {
    const errors = watch(page);
    await page.goto("/auth/forgot");
    await expectLikeBaseline(page, page.getByTestId("auth-forgot"), "S-REC-001", CARD["S-REC-001"], maxDiff);
    await axe(page);
    expect(errors).toEqual([]);
  });

  for (const url of ["/sign-in", "/auth/forgot?link=expired"]) {
    test(`axe finds nothing serious or critical on ${url}`, async ({ page }) => {
      const errors = watch(page);
      await page.goto(url);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await axe(page);
      expect(errors).toEqual([]);
    });
  }

  test("every control on /sign-in and /auth/forgot goes somewhere", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByRole("link", { name: "Send yourself a way back in" }).click();
    await expect(page).toHaveURL(/\/auth\/forgot$/);
    await page.getByRole("link", { name: "Sign in instead" }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
  });
});

test.describe("A02 sign in and start a session", () => {
  test.skip(!haveStack() || !haveMail(), "needs the local Supabase stack and Mailpit (scripts/ci/e2e.sh)");

  test("[A02.main] a workspace route signs in with a password, lands in the workspace and audits session.started", async ({ page }) => {
    const password = `pass ${randomUUID()}`;
    const { who, ws } = await member("a02-main", password, "Sign-in Workspace");
    const errors = watch(page);
    await page.goto(`/w/${ws}/board`);
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fw%2F/);
    await signInWithPassword(page, who.email, "not the password at all");
    await expect(page.getByTestId("auth-sign-in").getByRole("alert")).toContainText("do not sign in");
    await signInWithPassword(page, who.email, password);
    await expect(page).toHaveURL(new RegExp(`/w/${ws}/board$`));
    await expect(page.getByRole("navigation").first()).toBeVisible();
    const audits = await auditOf(await personIdOf(who), "session.started");
    expect(audits.some((a) => a.workspace_id === ws && a.object_type === "session")).toBe(true);
    expect(errors).toEqual([]);
  });

  test("[A02.main] a sign-in link by email signs in, and the answer never says whether the address has an account", async ({ page }) => {
    const { who, ws } = await member("a02-link", `pass ${randomUUID()}`, "Link Workspace");
    await page.goto("/sign-in");
    await page.getByLabel("Work email").fill(`nobody-${randomUUID().slice(0, 8)}@example.test`);
    await page.getByRole("button", { name: "Email me a sign-in link instead" }).click();
    const stranger = await page.getByTestId("auth-sign-in").innerText();
    await page.goto("/sign-in");
    await page.getByLabel("Work email").fill(who.email);
    await page.getByRole("button", { name: "Email me a sign-in link instead" }).click();
    const known = await page.getByTestId("auth-sign-in").innerText();
    expect(known.replace(who.email, "EMAIL")).toBe(stranger.replace(/nobody-\w+@example\.test/, "EMAIL"));
    await page.goto(await linkFromEmail(who.email));
    await expect(page).toHaveURL(new RegExp(`/w/${ws}$`));
  });

  test("[A02.must.1] [A02.fail.1] an expired membership reads nothing and shows Access removed (S-REC-004)", async ({ page, context, baseURL }) => {
    const { who: owner, ws } = await member("a02-owner", `pass ${randomUUID()}`, "Halden Pet Nutrition");
    await admin().schema("app").from("people").update({ display_name: "Johanna Holm" }).eq("user_id", owner.userId);
    const leaver = await person("a02-leaver");
    // The design's own case: an external member whose end date passed (31 December, a year earlier than drawn).
    await join(leaver, ws!, "editor", { is_external: true, access_ends_at: "2025-12-31T12:00:00Z" });

    const read = await leaver.db.schema("app").from("workspaces").select("id");
    expect(read.data).toEqual([]);
    const products = await leaver.db.schema("app").from("products").select("id");
    expect(products.data).toEqual([]);

    await signIn(context, leaver, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/board`);
    const card = page.getByTestId("access-removed");
    await expect(card.getByRole("heading", { name: "You no longer have access to this workspace" })).toBeVisible();
    await expect(card).toContainText("Your access to Halden Pet Nutrition ended on 31 December 2025.");
    await expect(card.getByRole("link", { name: "Ask Johanna Holm for access" })).toHaveAttribute("href", new RegExp(`^mailto:${owner.email}`));
    await expect(page.getByRole("navigation")).toHaveCount(0); // no rail: nothing of the workspace is shown
    await expectLikeBaseline(page, card, "S-REC-004", CARD["S-REC-004"], maxDiff);
    await axe(page);
    await card.getByRole("link", { name: "Or sign in to a different workspace" }).click();
    await expect(page).toHaveURL(/\/w\/none$/);
    await expect(page.getByText("Your account is not in a workspace yet")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("[A02.fail.1] a stranger to the workspace still sees NoAccess, never Access removed", async ({ page, context, baseURL }) => {
    const { ws } = await member("a02-other", `pass ${randomUUID()}`, "Somebody Else's");
    const stranger = await person("a02-stranger");
    await signIn(context, stranger, baseURL!);
    await page.goto(`/w/${ws}`);
    await expect(page.getByText("This workspace is not open to you")).toBeVisible();
    await expect(page.getByTestId("access-removed")).toHaveCount(0);
  });

  test("[A02.fail.2] [A02.must.2] a signer without TOTP enrols before entering, and is challenged for aal2 from then on", async ({ page }) => {
    test.setTimeout(120_000); // waits once for the next 30-second TOTP window
    const password = `pass ${randomUUID()}`;
    const { who: owner, ws } = await member("a02-admin", password, "Signing Workspace");
    const signer = await member("a02-signer", password);
    const signerId = await join(signer.who, ws!, "editor");
    const { error } = await admin().schema("app").from("signing_grants")
      .insert({ workspace_id: ws!, person_id: signerId, node_id: "EU-SE", granted_by: await personIdOf(owner) });
    if (error) throw error;

    const errors = watch(page);
    await page.goto(`/w/${ws}`);
    await signInWithPassword(page, signer.who.email, password);
    await expect(page).toHaveURL(/\/auth\/mfa\?next=/);
    const card = page.getByTestId("auth-mfa");
    await expect(card.getByRole("heading", { name: "Set up two-step sign-in" })).toBeVisible();
    await expect(card.getByRole("img", { name: /QR code/ })).toBeVisible();
    await axe(page);
    // Navigating around the enrolment does not reach the workspace.
    await page.goto(`/w/${ws}/board`);
    await expect(page).toHaveURL(/\/auth\/mfa\?next=/);
    const secret = (await page.getByTestId("mfa-secret").innerText()).trim();
    await page.getByLabel("Six-digit code").fill("000000" === totp(secret) ? "111111" : "000000");
    await page.getByRole("button", { name: "Turn on two-step and continue" }).click();
    await expect(card.getByRole("alert")).toContainText("did not match");
    await page.getByLabel("Six-digit code").fill(totp(secret));
    await page.getByRole("button", { name: "Turn on two-step and continue" }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${ws}`));

    // A new sign-in is aal1 until the code is given, and goes nowhere else meanwhile.
    await page.context().clearCookies();
    await page.goto(`/w/${ws}`);
    await signInWithPassword(page, signer.who.email, password);
    await expect(page.getByRole("heading", { name: "Type your two-step code" })).toBeVisible();
    await page.goto(`/w/${ws}`);
    await expect(page).toHaveURL(/\/auth\/mfa/);
    // Codes are single-use per 30 s window; wait for the next one.
    await page.waitForTimeout(31_000 - (Date.now() % 30_000));
    await page.getByLabel("Six-digit code").fill(totp(secret));
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${ws}$`));
    expect(errors).toEqual([]);
  });
});

test.describe("A07 change or reset a password", () => {
  test.skip(!haveStack() || !haveMail(), "needs the local Supabase stack and Mailpit (scripts/ci/e2e.sh)");

  test("[A07.main] [A07.must.1] forgot → email → new password → signed in; other sessions end; no secret in audit or logs", async ({ page }) => {
    const oldPassword = `old ${randomUUID()}`;
    const newPassword = `copper kettle river lamp ${randomUUID().slice(0, 8)}`;
    const { who, ws } = await member("a07-main", oldPassword, "Reset Workspace");
    // Another device, signed in before the reset.
    const elsewhere = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const before = await elsewhere.auth.signInWithPassword({ email: who.email, password: oldPassword });
    expect(before.error).toBeNull();

    const errors = watch(page);
    await page.goto("/sign-in");
    await page.getByRole("link", { name: "Send yourself a way back in" }).click();
    await page.getByLabel("Email address").fill(who.email);
    await page.getByRole("button", { name: "Send the link" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

    const link = await linkFromEmail(who.email);
    await page.goto(link);
    await expect(page).toHaveURL(/\/auth\/reset$/);
    const card = page.getByTestId("auth-reset");
    await expect(card).toContainText(/This link expires in (59|60) minutes/);
    await expect(card).toContainText("12 CHARACTERS OR MORE");
    await axe(page);
    // The design draws the moment a passphrase has been typed.
    await page.getByLabel("New password", { exact: true }).fill(newPassword);
    await expect(card).toContainText("STRONG · A PASSPHRASE OF FOUR WORDS");
    await expectLikeBaseline(page, card, "S-REC-002", CARD["S-REC-002"], maxDiff);
    await page.getByLabel("Type it again").fill(newPassword + "x");
    await page.getByRole("button", { name: "Set the password and sign in" }).click();
    await expect(card.getByRole("alert")).toContainText("not the same");
    await page.getByLabel("New password", { exact: true }).fill(newPassword);
    await page.getByLabel("Type it again").fill(newPassword);
    await page.getByRole("button", { name: "Set the password and sign in" }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${ws}$`));

    // A07 step 2: the session on the other device is over.
    const refreshed = await elsewhere.auth.refreshSession({ refresh_token: before.data.session!.refresh_token });
    expect(refreshed.error).not.toBeNull();
    // The new password works; the old one does not.
    expect((await elsewhere.auth.signInWithPassword({ email: who.email, password: oldPassword })).error).not.toBeNull();
    expect((await elsewhere.auth.signInWithPassword({ email: who.email, password: newPassword })).error).toBeNull();

    // A07.must.1: the access event is recorded, the secret is not, anywhere.
    const audits = await auditOf(await personIdOf(who), "access.password_changed");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ workspace_id: ws, before: null, after: null });
    const { data: all } = await admin().schema("app").from("audit_events").select("*").eq("workspace_id", ws!);
    expect(JSON.stringify(all)).not.toContain(newPassword);
    expect(JSON.stringify(all)).not.toContain(oldPassword);
    const webLog = path.join(REPO_ROOT, "reports/web.log");
    if (fs.existsSync(webLog)) {
      const log = fs.readFileSync(webLog, "utf8");
      expect(log).not.toContain(newPassword);
      expect(log).not.toContain(who.email);
    }
    expect(errors).toEqual([]);
  });

  test("[A07.fail.1] a reset link used once lands on the Account Recovery page the second time", async ({ page }) => {
    const { who } = await member("a07-expired", `pass ${randomUUID()}`, "Expired Link Workspace");
    await page.goto("/auth/forgot");
    await page.getByLabel("Email address").fill(who.email);
    await page.getByRole("button", { name: "Send the link" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    const link = await linkFromEmail(who.email);
    await page.goto(link);
    await expect(page).toHaveURL(/\/auth\/reset$/);
    await page.goto(link);
    await expect(page).toHaveURL(/\/auth\/forgot\?link=expired(#.*)?$/);
    const card = page.getByTestId("auth-forgot");
    await expect(card.getByRole("heading", { name: "That link no longer works" })).toBeVisible();
    // Not a dead end: a fresh link can be asked for from here.
    await expect(card.getByRole("button", { name: "Send the link" })).toBeEnabled();
  });

  test("[A07.fail.1] /auth/reset without a reset session is the Account Recovery page", async ({ page }) => {
    await page.goto("/auth/reset");
    await expect(page).toHaveURL(/\/auth\/forgot\?link=expired$/);
  });
});
