// T-106 · Sign up and create a workspace (A01), with the default operator (B01), on the full local stack: real Supabase
// Auth with confirmation on, its emails read back from Mailpit, the database read with the service role. Every person
// and workspace is new, and every password is made at run time.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { parse } from "yaml";
import type { Database } from "../../src/lib/database.types";
import { REPO_ROOT } from "../visual/screens";
import { expectLikeBaseline } from "./support/baseline";
import { haveMail, linkFromEmail } from "./support/mail";
import { admin, haveStack, person, signIn, workspace } from "./support/people";

const nfr = parse(fs.readFileSync(path.join(REPO_ROOT, "spec/nfr.yaml"), "utf8")) as {
  quality: { visual_max_diff_pixel_ratio: number; axe_serious_or_critical: number };
};
const maxDiff = nfr.quality.visual_max_diff_pixel_ratio;

// The step cards of the Onboarding Flow baselines at 1600 px: each starts at x 280, y 167.734. Step 02's card is
// compared down to the end of its "Inside EU" panel: below it the route adds the password typed once more, which the
// design does not draw (pre-account takeover, issue #28).
const CARD = {
  "S-ONB-001": { x: 280, y: 167, width: 584, height: 625, fractionY: 0.734 },
  "S-ONB-002": { x: 280, y: 167, width: 1040, height: 480, fractionY: 0.734 },
  // S-ONB-003: only the operator sub-block, from its rule to the approval row (the recipe half is T-401's).
  "S-ONB-003": { x: 309, y: 490, width: 551, height: 210, fractionY: 0.359 },
} as const;

const secret = () => `onboarding ${randomUUID()}`; // never a literal password in the repository
const emailFor = (label: string) => `${label}-${randomUUID().slice(0, 8)}@example.test`;

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

async function fillAccount(page: Page, email: string, fullName: string, password: string) {
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Full name").fill(fullName);
  await page.getByLabel("Password", { exact: true }).fill(password);
}

/** Every auth user with this address (the admin API pages; a CI stack holds a few hundred at most). */
async function usersWith(email: string) {
  const found = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin().auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    found.push(...data.users.filter((u) => u.email === email));
    if (data.users.length < 1000) return found;
  }
}

async function personOf(userId: string) {
  const { data, error } = await admin().schema("app").from("people").select("id, display_name").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

test.describe("onboarding screens against the design", () => {
  test("S-ONB-001 step 01 matches its baseline card at 1600 px, passes axe, and its controls work", async ({ page }) => {
    const errors = watch(page);
    await page.goto("/onboarding");
    await expect(page.getByRole("heading", { level: 1, name: "Create your workspace" })).toBeVisible();
    await fillAccount(page, "j.holm@haldenpet.com", "Johanna Holm", "x".repeat(18));
    await expectLikeBaseline(page, page.getByTestId("onboarding-account"), "S-ONB-001", CARD["S-ONB-001"], maxDiff);
    await axe(page);

    // SHOW reveals the password and HIDE hides it again.
    const password = page.getByLabel("Password", { exact: true });
    await page.getByRole("button", { name: "SHOW" }).click();
    await expect(password).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "HIDE" }).click();
    await expect(password).toHaveAttribute("type", "password");
    // RENAME turns the derived name into a field holding it.
    await expect(page.getByTestId("onboarding-account")).toContainText("Workspace will be called Haldenpet, from your email domain.");
    await page.getByRole("button", { name: "RENAME" }).click();
    await expect(page.getByLabel("Workspace name")).toHaveValue("Haldenpet");
    // A problem is said beside the action, and nothing is sent.
    await password.fill("too short");
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect(page.getByTestId("onboarding-account").getByRole("alert")).toContainText("12 characters or more");
    await page.getByRole("link", { name: "Already have an account? Sign in" }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    expect(errors).toEqual([]);
  });
});

test.describe("A01 sign up and create a workspace", () => {
  test.skip(!haveStack() || !haveMail(), "needs the local Supabase stack and Mailpit (scripts/ci/e2e.sh)");

  test("[A01.main] sign up, confirm by email, choose the EU, create the workspace and set the operator", async ({ page }) => {
    const errors = watch(page);
    const email = emailFor("a01-main");
    await page.goto("/onboarding");
    const password = secret();
    await fillAccount(page, email, "Johanna Holm", password);
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect(page.getByTestId("onboarding-check-email")).toContainText(`We sent a link to ${email}.`);

    const [user] = await usersWith(email);
    expect(user.email_confirmed_at ?? null).toBeNull();
    expect(user.user_metadata).toMatchObject({ display_name: "Johanna Holm", workspace_name: "Example" });
    expect(await personOf(user.id)).toBeNull(); // nothing in app until a confirmed account creates a workspace

    // The confirmation link comes back through /auth/callback to step 02.
    await page.goto(await linkFromEmail(email));
    await expect(page).toHaveURL(/\/onboarding$/);
    const region = page.getByTestId("onboarding-region");
    await expect(region.getByRole("heading", { level: 1, name: "Where do you sell" })).toBeVisible();
    await expect(region.getByRole("button", { name: /^EU/ })).toHaveAttribute("aria-pressed", "true");
    await expect(region).toContainText("27 MEMBER STATES");
    await expectLikeBaseline(page, region, "S-ONB-002", CARD["S-ONB-002"], maxDiff);
    await axe(page);

    // The UK comes with a paid plan: picking it says so and holds Continue, so nothing false is created.
    await expect(region).toContainText("Free starts with the EU.");
    await region.getByRole("button", { name: /^UK/ }).click();
    await expect(region.getByRole("status")).toHaveText("Free covers the EU. UK comes with a paid plan.");
    await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Continue" })).toHaveAccessibleDescription("Free covers the EU. UK comes with a paid plan.");
    await region.getByRole("button", { name: /^EU/ }).click();
    await region.getByLabel("Your password, once more").fill(password);
    await page.getByRole("button", { name: "Continue" }).click();

    const operator = page.getByTestId("onboarding-operator");
    await expect(operator.getByRole("heading", { level: 1, name: "The responsible operator" })).toBeVisible();
    await axe(page);
    await operator.getByLabel("Operator name").fill("Halden Pet Nutrition AB");
    await operator.getByLabel("Operator address").fill("Industrivägen 4, 412 63 Göteborg, Sweden");
    await page.getByRole("button", { name: "Continue" }).click();
    // No code at the end: the address stays as printed, and the person is pointed to "I'll do this later".
    await expect(operator.getByRole("alert")).toContainText("could not be read from the end of the address");
    await expect(operator.getByRole("alert")).toContainText("the operator stays unset for now");
    await expect(operator).toContainText("COUNTRY · NOT FOUND AT THE END OF THE ADDRESS");
    await expect(operator.getByLabel("Operator address")).toHaveValue("Industrivägen 4, 412 63 Göteborg, Sweden");
    await operator.getByLabel("Operator address").fill("Industrivägen 4, 412 63 Göteborg, SE");
    await operator.getByLabel("Establishment or approval number").fill("SE 14 2231 α"); // leaves the address field
    await expect(operator).toContainText("COUNTRY TO BE SAVED · SE · SWEDEN");
    await expect(operator.getByRole("alert")).toHaveCount(0); // the address changed since that refusal
    await operator.getByLabel("Establishment or approval number").blur(); // no focus ring in the crop
    await expectLikeBaseline(page, operator.getByTestId("onboarding-operator-block"), "S-ONB-003", CARD["S-ONB-003"], maxDiff);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}$/);
    const ws = page.url().split("/w/")[1];

    const db = admin().schema("app");
    const { data: created } = await db.from("workspaces").select("*").eq("id", ws).single();
    expect(created).toMatchObject({ name: "Example", plan: "free", entitled_regions: ["EU"], status: "active" });
    expect(created!.default_operator).toEqual({
      name: "Halden Pet Nutrition AB", address: "Industrivägen 4, 412 63 Göteborg, SE", country: "SE", approval_number: "SE 14 2231 α",
    });
    const me = await personOf(user.id);
    expect(created!.created_by).toBe(me!.id);
    const { data: audits } = await db.from("audit_events").select("kind").eq("workspace_id", ws);
    expect(audits!.map((a) => a.kind)).toEqual(expect.arrayContaining(["workspace.created", "workspace.default_operator_set"]));

    // Onboarding is done: coming back goes on to the workspace.
    await page.goto("/onboarding");
    await expect(page).toHaveURL(new RegExp(`/w/${ws}$`));
    expect(errors).toEqual([]);
  });

  test("[A01.main] a renamed workspace keeps its name through confirmation, and only a domain name is said to come from the domain", async ({ page }) => {
    // A personal address: the fallback name is not "from your email domain".
    await page.goto("/onboarding");
    const account = page.getByTestId("onboarding-account");
    await fillAccount(page, `someone-${randomUUID().slice(0, 8)}@gmail.com`, "Johanna Holm", secret());
    await expect(account).toContainText("Workspace will be called Johanna Holm's workspace.");
    await expect(account).not.toContainText("from your email domain");

    const email = emailFor("a01-rename");
    const password = secret();
    await page.goto("/onboarding");
    await fillAccount(page, email, "Johanna Holm", password);
    await expect(account).toContainText("Workspace will be called Example, from your email domain.");
    await account.getByRole("button", { name: "RENAME" }).click();
    await account.getByLabel("Workspace name").fill("Halden Pet Nutrition");
    await expect(account).not.toContainText("from your email domain");
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect(page.getByTestId("onboarding-check-email")).toBeVisible();
    const [user] = await usersWith(email);
    expect(user.user_metadata).toMatchObject({ workspace_name: "Halden Pet Nutrition" });

    await page.goto(await linkFromEmail(email));
    const region = page.getByTestId("onboarding-region");
    await region.getByLabel("Your password, once more").fill(password);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByTestId("onboarding-operator")).toContainText("Halden Pet Nutrition is ready.");
    const me = await personOf(user.id);
    const { data } = await admin().schema("app").from("workspaces").select("name").eq("created_by", me!.id);
    expect(data).toEqual([{ name: "Halden Pet Nutrition" }]);
  });

  test("step 03 reads the country when the address is left, never per keystroke", async ({ page, context, baseURL }) => {
    const who = await person("a01-country");
    await workspace(who, "Country Reading");
    await signIn(context, who, baseURL!);
    await page.goto("/onboarding");
    const operator = page.getByTestId("onboarding-operator");
    const line = operator.locator("#onb-country");
    await expect(line).toHaveText("COUNTRY · READ FROM THE END OF THE ADDRESS");
    // Every text the line shows while the address is typed, recorded in the page.
    await line.evaluate((el) => {
      const seen: string[] = ((window as unknown as { seen: string[] }).seen = []);
      new MutationObserver(() => seen.push(el.textContent ?? "")).observe(el, { childList: true, characterData: true, subtree: true });
    });
    const address = operator.getByLabel("Operator address");
    await expect(address).toHaveAttribute("placeholder", "Exactly as printed on the label");
    await address.pressSequentially("1 Park Row, Leeds LS1 4AB, GB");
    await address.press("Tab"); // leaving the field reads it
    await expect(line).toHaveText("COUNTRY TO BE SAVED · GB · UNITED KINGDOM");
    const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
    expect(seen.some((t) => t.includes("LESOTHO"))).toBe(false);
    expect(seen).toEqual(["COUNTRY TO BE SAVED · GB · UNITED KINGDOM"]);
    await expect(address).toHaveAttribute("aria-describedby", "onb-country");
  });

  test("step 03 can be left for later: the workspace stays, without an operator, and onboarding picks up there", async ({ page, context, baseURL }) => {
    const who = await person("a01-later");
    const ws = await workspace(who, "Later Operator");
    await signIn(context, who, baseURL!);
    const errors = watch(page);
    await page.goto("/onboarding");
    await expect(page.getByTestId("onboarding-operator")).toContainText("Later Operator is ready.");
    await page.getByRole("link", { name: "I'll do this later — take me to the platform" }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${ws}$`));
    const { data } = await admin().schema("app").from("workspaces").select("default_operator").eq("id", ws).single();
    expect(data!.default_operator).toBeNull();
    expect(errors).toEqual([]);
  });

  test("[A01.must.1] [A01.must.2] a new workspace has exactly one admin membership and an allowance of 3 allowed, 0 used", async () => {
    const who = await person("a01-must");
    const ws = await workspace(who, "Must Hold");
    const db = admin().schema("app");
    const { data: members } = await db.from("memberships").select("role, is_external, ended_at").eq("workspace_id", ws);
    expect(members).toEqual([{ role: "admin", is_external: false, ended_at: null }]);
    const { data: allowance } = await db.from("allowances").select("labels_allowed, labels_used").eq("workspace_id", ws).single();
    expect(allowance).toEqual({ labels_allowed: 3, labels_used: 0 });
    // The admin reads the same under their own session (RLS).
    const own = await who.db.schema("app").from("allowances").select("labels_allowed, labels_used").eq("workspace_id", ws).single();
    expect(own.data).toEqual({ labels_allowed: 3, labels_used: 0 });
  });

  test("[A01.must.3] if any step of create_workspace fails, nothing persists: no person, workspace, membership, allowance or audit", async () => {
    const who = await person("a01-atomic");
    expect(await personOf(who.userId)).toBeNull();
    // The person is inserted first; the workspace's name check then fails, so the whole transaction must roll back.
    const { error } = await who.db.schema("app").rpc("create_workspace", { p_name: "w".repeat(201) });
    expect(error?.code).toBe("23514");
    expect(await personOf(who.userId)).toBeNull();
    const db = admin().schema("app");
    const { data: workspaces } = await db.from("workspaces").select("id").eq("name", "w".repeat(201));
    expect(workspaces).toEqual([]);
    const { count: audits } = await db.from("audit_events").select("id", { count: "exact", head: true }).eq("kind", "workspace.created").eq("after->>name", "w".repeat(201));
    expect(audits).toBe(0);
    // And the same person can then create one, once: the failed attempt left nothing to collide with.
    const ws = await workspace(who, "After The Failure");
    const { count: memberships } = await db.from("memberships").select("id", { count: "exact", head: true }).eq("workspace_id", ws);
    expect(memberships).toBe(1);
  });

  test("[A01.main] a password chosen by whoever signed the address up first, unconfirmed, stops working before the workspace exists", async ({ page }) => {
    const email = emailFor("a01-takeover");
    const attacker = secret();
    const victim = secret();
    // The attacker's unconfirmed signup: Supabase Auth keeps this password when the real owner signs up later.
    const early = await admin().auth.admin.createUser({ email, password: attacker, email_confirm: false });
    if (early.error) throw early.error;

    await page.goto("/onboarding");
    await fillAccount(page, email, "Real Owner", victim);
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect(page.getByTestId("onboarding-check-email")).toBeVisible();
    await page.goto(await linkFromEmail(email));
    const region = page.getByTestId("onboarding-region");
    await expect(region).toBeVisible();

    // Confirmed now, so the attacker's password signs in: it holds a session until step 02 is done.
    const theirs = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const before = await theirs.auth.signInWithPassword({ email, password: attacker });
    expect(before.error).toBeNull();

    await region.getByLabel("Your password, once more").fill(victim);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByTestId("onboarding-operator")).toBeVisible();

    // The attacker's session is ended and their password no longer works; the owner's does.
    const refreshed = await theirs.auth.refreshSession();
    expect(refreshed.error).not.toBeNull();
    const again = await theirs.auth.signInWithPassword({ email, password: attacker });
    expect(again.error?.code).toBe("invalid_credentials");
    const owner = await theirs.auth.signInWithPassword({ email, password: victim });
    expect(owner.error).toBeNull();
    expect(await usersWith(email)).toHaveLength(1);
  });

  test("[A01.fail.1] a new and a registered address read the same when Supabase Auth rate-limits the email, too", async ({ page }) => {
    const owner = await person("a01-known-busy");
    const fresh = emailFor("a01-fresh-busy");
    const anon = () =>
      createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        auth: { persistSession: false },
      });
    /** Submits step 01 for `email`; `before` runs just before the click, to put the address inside the email window. */
    const answer = async (email: string, before?: () => Promise<unknown>) => {
      await page.goto("/onboarding");
      await fillAccount(page, email, "Somebody", secret());
      await before?.();
      await page.getByRole("button", { name: "Create workspace" }).click();
      const shown = page.getByTestId("onboarding-check-email").or(page.getByTestId("onboarding-account").getByRole("alert"));
      await expect(shown).toBeVisible();
      return (await shown.innerText()).replace(email, "EMAIL");
    };
    // Supabase Auth refuses a second email to one address inside its window (max_frequency: 1 s on the local stack,
    // 60 s hosted). An email sent to each address just before the click puts both paths inside it: the new address's
    // signup and the registered address's sign-in link are both refused, and must read the same.
    const fresh2 = emailFor("a01-fresh-busy2");
    const busyNew = await answer(fresh2, () => anon().auth.signUp({ email: fresh2, password: secret() }));
    const busyKnown = await answer(owner.email, () => anon().auth.signInWithOtp({ email: owner.email, options: { shouldCreateUser: false } }));
    expect(busyNew).toContain("could not be created just now");
    expect(busyKnown).toBe(busyNew);
    // Outside the window both read "sent", alike.
    await page.waitForTimeout(1_500);
    expect(await answer(owner.email)).toBe(await answer(fresh));
    expect(await usersWith(owner.email)).toHaveLength(1);
  });

  test("[A01.fail.1] an email that is already registered gets the sign-in path, and never a second user", async ({ page }) => {
    const owner = await person("a01-known");
    const ws = await workspace(owner, "Already Here");
    const fresh = emailFor("a01-fresh");

    await page.goto("/onboarding");
    await fillAccount(page, fresh, "Somebody New", secret());
    await page.getByRole("button", { name: "Create workspace" }).click();
    const newcomer = await page.getByTestId("onboarding-check-email").innerText();

    await page.goto("/onboarding");
    await fillAccount(page, owner.email, "Somebody Else", secret());
    await page.getByRole("button", { name: "Create workspace" }).click();
    const known = await page.getByTestId("onboarding-check-email").innerText();
    // The screen never says whether the address had an account.
    expect(known.replace(owner.email, "EMAIL")).toBe(newcomer.replace(fresh, "EMAIL"));

    expect(await usersWith(owner.email)).toHaveLength(1);
    // The owner's email holds a sign-in link, which lands in their existing workspace.
    await page.goto(await linkFromEmail(owner.email));
    await expect(page).toHaveURL(new RegExp(`/w/${ws}$`));
    const { count } = await admin().schema("app").from("memberships").select("id", { count: "exact", head: true }).eq("workspace_id", ws);
    expect(count).toBe(1);
  });

  test("[A01.fail.2] an unconfirmed email cannot sign in, and so cannot create a workspace", async ({ page }) => {
    const email = emailFor("a01-unconfirmed");
    const password = secret();
    await page.goto("/onboarding");
    await fillAccount(page, email, "Not Yet", password);
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect(page.getByTestId("onboarding-check-email")).toBeVisible();

    // No session in the browser: /onboarding is still step 01.
    await page.goto("/onboarding");
    await expect(page.getByRole("heading", { level: 1, name: "Create your workspace" })).toBeVisible();

    // Nor anywhere else: Supabase Auth refuses the password until the email is confirmed.
    const client = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    const signIn = await client.auth.signInWithPassword({ email, password });
    expect(signIn.error?.code).toBe("email_not_confirmed");
    expect(signIn.data.session).toBeNull();
    // And without a session app.create_workspace is refused.
    const { error } = await client.schema("app").rpc("create_workspace", { p_name: "Unconfirmed" });
    expect(error).not.toBeNull();
    const [user] = await usersWith(email);
    expect(user.email_confirmed_at ?? null).toBeNull();
    expect(await personOf(user.id)).toBeNull();
  });
});
