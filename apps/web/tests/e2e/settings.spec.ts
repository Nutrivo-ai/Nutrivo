// T-107 · Workspace Settings on the full local stack: People and roles (A03, A05, A06), the invitation page (A04),
// Workspace (B01) and Your account (A07). Every write goes through the screens, so through the RPCs; the service role
// only sets up and reads back. The worker sends the invitation through Mailpit, and the test follows the emailed link
// the way the invitee would. Each screen is compared with its design baseline on the regions the design draws the same
// for any workspace (the static cards), and axe runs on every state.
import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { parse } from "yaml";
import { REPO_ROOT } from "../visual/screens";
import { expectLikeBaseline } from "./support/baseline";
import { haveMail, inviteLinkFromEmail } from "./support/mail";
import { admin, haveStack, person, signIn, workspace, type Person } from "./support/people";

const nfr = parse(fs.readFileSync(path.join(REPO_ROOT, "spec/nfr.yaml"), "utf8")) as {
  quality: { visual_max_diff_pixel_ratio: number; axe_serious_or_critical: number };
};
const maxDiff = nfr.quality.visual_max_diff_pixel_ratio;

// Regions of the Workspace Settings baselines at 1600 px (design boxes, measured from the design file).
const REGION = {
  fourRoles: { x: 244, y: 644, width: 752, height: 571, fractionY: 0.5 },
  peopleNotes: { x: 1016, y: 644, width: 555, height: 403, fractionY: 0.5 },
  toldAbout: { x: 918, y: 94, width: 654, height: 271, fractionY: 0.59375 },
  leaving: { x: 918, y: 702, width: 654, height: 102, fractionY: 0.890625 },
  // S-REC-003: the card's wordmark, mark and title (its body names an inviter the page cannot read, #29 question 3).
  expired: { x: 260, y: 156, width: 440, height: 128, fractionY: 0.375 },
} as const;

const NAME = "Halden Pet Nutrition";

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

async function membership(ws: string, who: Person) {
  const { data, error } = await admin()
    .schema("app")
    .from("memberships")
    .select("id, role, is_external, access_ends_at, ended_at")
    .eq("workspace_id", ws)
    .eq("person_id", await personId(who))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function invitations(ws: string, email: string) {
  const { data, error } = await admin().schema("app").from("invitations").select("*").eq("workspace_id", ws).eq("email", email);
  if (error) throw error;
  return data;
}

const row = (page: Page, email: string) => page.locator(`tr[data-email="${email}"]`);
const dialog = (page: Page) => page.getByRole("dialog");

async function invite(page: Page, email: string, role = "Editor") {
  await page.getByRole("button", { name: "Invite a person" }).first().click();
  await dialog(page).getByLabel("Work email").fill(email);
  await dialog(page).getByLabel("Role").selectOption({ label: role });
  await dialog(page).getByRole("button", { name: "Send invitation" }).click();
}

async function manage(page: Page, name: string) {
  await page.getByRole("button", { name: `Manage ${name}` }).click();
  await expect(dialog(page)).toBeVisible();
}

test.describe("Workspace Settings", () => {
  test.skip(!haveStack() || !haveMail(), "needs the local Supabase stack, Mailpit and the worker: run through scripts/ci/e2e.sh (make e2e)");
  test.describe.configure({ mode: "serial" });

  let ada: Person, erik: Person, vic: Person, petra: Person;
  let ws: string;
  let erikLink: string;

  test.beforeAll(async () => {
    [ada, erik, vic, petra] = await Promise.all([person("t107-ada"), person("t107-erik"), person("t107-vic"), person("t107-petra")]);
    ws = await workspace(ada, NAME);
    await workspace(vic, "Vic's own"); // a person row, as an invitee who already uses Nutrivo would have
    const set = await admin()
      .schema("app")
      .from("workspaces")
      .update({ default_operator: { name: "Halden Pet Nutrition AB", address: "Industrivägen 4, 412 63 Göteborg, SE", country: "SE" } })
      .eq("id", ws);
    if (set.error) throw set.error;
  });

  test("S-WSS-001 People and roles matches its baseline cards at 1600 px, passes axe, and only the admin is there yet", async ({ page, context, baseURL }) => {
    await signIn(context, ada, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/settings/people`);
    await expect(page.getByRole("heading", { level: 1, name: "People and roles" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "People and roles" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("seat-line")).toHaveText("1 EDITOR SEAT USED · NO SEAT LIMIT · 0 VIEWERS, FREE · 0 EXTERNAL");
    await expect(row(page, ada.email)).toContainText("The whole workspace");
    await expect(page.getByText("Nobody else is in this workspace yet")).toBeVisible();
    await axe(page);
    await expectLikeBaseline(page, page.getByTestId("four-roles").locator(".."), "S-WSS-001", REGION.fourRoles, maxDiff);
    await expectLikeBaseline(page, page.getByTestId("people-notes"), "S-WSS-001", REGION.peopleNotes, maxDiff);
    expect(errors).toEqual([]);
  });

  test("[A03.main] An admin invites a person from People and the worker emails the link [A03.must.2]", async ({ page, context, baseURL }) => {
    test.setTimeout(120_000);
    await signIn(context, ada, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/settings/people`);
    await page.getByRole("button", { name: "Invite a person" }).first().click();
    await axe(page);
    await dialog(page).getByLabel("Work email").fill(erik.email);
    await dialog(page).getByLabel("Role").selectOption({ label: "Editor" });
    await dialog(page).getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByRole("status").filter({ hasText: `Invitation sent to ${erik.email}.` })).toBeVisible();
    await expect(row(page, erik.email)).toContainText("Invitation pending");
    await expect(row(page, erik.email)).toContainText("SEAT ON ACCEPT");
    const [inv] = await invitations(ws, erik.email);
    expect(inv).toMatchObject({ role: "editor", is_external: false, accepted_at: null });

    erikLink = await inviteLinkFromEmail(erik.email);
    // A03.must.2: only the hash is stored; the emailed token is nowhere in the row.
    const token = erikLink.split("/").pop()!;
    const [after] = await invitations(ws, erik.email);
    expect(after.token_hash).toBeTruthy();
    expect(JSON.stringify(after)).not.toContain(token);
    expect(errors).toEqual([]);
  });

  test("[A03.fail.2] Inviting a pending address resends, never duplicates", async ({ page, context, baseURL }) => {
    await signIn(context, ada, baseURL!);
    await page.goto(`/w/${ws}/settings/people`);
    await invite(page, erik.email);
    await expect(page.getByRole("status").filter({ hasText: "already had a pending invitation, so it was sent again" })).toBeVisible();
    expect(await invitations(ws, erik.email)).toHaveLength(1);
    await expect(row(page, erik.email)).toHaveCount(1);
    // The resend mints a new token: the newest email's link is the live one.
    erikLink = await inviteLinkFromEmail(erik.email, 2);
  });

  test("[A04.fail.2] A different signed-in address is refused (P0041) and offered the way to the invited one", async ({ page, context, baseURL }) => {
    await signIn(context, vic, baseURL!);
    const errors = watch(page);
    await page.goto(erikLink);
    await page.getByRole("button", { name: "Accept the invitation" }).click();
    await expect(page.getByTestId("invite-other-email")).toContainText(`You are signed in as ${vic.email}`);
    await axe(page);
    expect(await membership(ws, vic)).toBeNull();
    await page.getByRole("button", { name: "Sign out and use the invited address" }).click();
    await expect(page).toHaveURL(/\/sign-in\?next=%2Finvite%2F/);
    expect(errors).toEqual([]);
  });

  test("[A04.main] The invitee accepts from the emailed link and lands in the workspace [A04.must.1]", async ({ page, context, baseURL }) => {
    // Signed out, the page offers to create the user or sign in, and names nobody.
    await context.clearCookies();
    const errors = watch(page);
    await page.goto(erikLink);
    await expect(page.getByTestId("invite-create")).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in to accept" })).toHaveAttribute("href", `/sign-in?next=${encodeURIComponent(erikLink)}`);
    await axe(page);

    await signIn(context, erik, baseURL!);
    await page.goto(erikLink);
    await expect(page.getByTestId("invite-accept")).toContainText(erik.email);
    await axe(page);
    await page.getByRole("button", { name: "Accept the invitation" }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${ws}$`));
    expect(await membership(ws, erik)).toMatchObject({ role: "editor", is_external: false, ended_at: null });

    // One-time: the same link no longer works once used.
    await page.goto(erikLink);
    await page.getByRole("button", { name: "Accept the invitation" }).click();
    await expect(page.getByTestId("invite-expired")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("[A04.fail.1] An expired invitation shows the expired-invite page (P0040), matching its baseline", async ({ page, context, baseURL }) => {
    test.setTimeout(120_000);
    await signIn(context, ada, baseURL!);
    await page.goto(`/w/${ws}/settings/people`);
    await invite(page, petra.email, "Viewer");
    await expect(row(page, petra.email)).toContainText("FREE");
    const link = await inviteLinkFromEmail(petra.email);
    const lapse = await admin().schema("app").from("invitations").update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("workspace_id", ws).eq("email", petra.email);
    if (lapse.error) throw lapse.error;

    await signIn(context, petra, baseURL!);
    const errors = watch(page);
    await page.goto(link);
    await page.getByRole("button", { name: "Accept the invitation" }).click();
    const card = page.getByTestId("invite-expired");
    await expect(card).toContainText("This invitation has expired");
    await axe(page);
    await expectLikeBaseline(page, card, "S-REC-003", REGION.expired, maxDiff);
    expect(await membership(ws, petra)).toBeNull();
    // A link that is not a token at all reads the same.
    await page.goto("/invite/not-a-token");
    await expect(page.getByTestId("invite-expired")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("[A04.fail.3] Already a member: P0042", async ({ page, context, baseURL }) => {
    test.setTimeout(120_000);
    await signIn(context, ada, baseURL!);
    await page.goto(`/w/${ws}/settings/people`);
    await invite(page, erik.email);
    await expect(page.getByRole("status").filter({ hasText: `Invitation sent to ${erik.email}.` })).toBeVisible();
    const link = await inviteLinkFromEmail(erik.email, 3);
    await signIn(context, erik, baseURL!);
    await page.goto(link);
    await page.getByRole("button", { name: "Accept the invitation" }).click();
    await expect(page.getByTestId("invite-member")).toContainText("You are already in this workspace");
    await axe(page);
    // Tidy up: the admin revokes the leftover invitation from its row.
    await signIn(context, ada, baseURL!);
    await page.goto(`/w/${ws}/settings/people`);
    await manage(page, erik.email);
    await dialog(page).getByRole("button", { name: "Revoke the invitation" }).click();
    await expect(page.getByRole("status").filter({ hasText: "was revoked" })).toBeVisible();
    expect((await invitations(ws, erik.email)).filter((i) => !i.revoked_at && !i.accepted_at)).toHaveLength(0);
  });

  test("[A03.fail.1] No seat left: P0033, then the upsell from Plans and Checkout [A03.must.3]", async ({ page, context, baseURL }) => {
    // Two editor-class members (Ada, Erik) on a plan with two seats.
    const seats = await admin().schema("app").from("subscriptions").upsert({ workspace_id: ws, plan: "basic", status: "active", editor_seats: 2 });
    if (seats.error) throw seats.error;
    await signIn(context, ada, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/settings/people`);
    await expect(page.getByTestId("seat-line")).toHaveText("2 OF 2 EDITOR SEATS USED · 0 VIEWERS, FREE · 0 EXTERNAL");
    await invite(page, "no-seat@example.test", "Editor");
    await expect(dialog(page).getByRole("alert")).toContainText("Every editor seat on this plan is in use");
    await expect(dialog(page).getByRole("link", { name: "See the plans with more seats" })).toHaveAttribute("href", `/w/${ws}/billing/plans`);
    expect(await invitations(ws, "no-seat@example.test")).toHaveLength(0);
    // Viewers never use a seat: the same address as a viewer is invited.
    await dialog(page).getByLabel("Role").selectOption({ label: "Viewer" });
    await dialog(page).getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Invitation sent to no-seat@example.test." })).toBeVisible();
    expect(await invitations(ws, "no-seat@example.test")).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  test("[A05.main] An admin changes a member's role, external flag and end date from People", async ({ page, context, baseURL }) => {
    await signIn(context, ada, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/settings/people`);
    await manage(page, erik.email.split("@")[0]);
    await axe(page);
    await dialog(page).getByLabel("Role").selectOption({ label: "Viewer" });
    await dialog(page).getByLabel(/External/).check();
    await dialog(page).getByLabel("Access ends").fill("2027-12-31");
    await dialog(page).getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status").filter({ hasText: "was updated" })).toBeVisible();
    await expect(row(page, erik.email)).toContainText("Viewer");
    await expect(row(page, erik.email)).toContainText("EXTERNAL");
    await expect(row(page, erik.email)).toContainText("until 31 Dec 2027");
    expect(await membership(ws, erik)).toMatchObject({ role: "viewer", is_external: true, access_ends_at: "2027-12-31T23:59:59+00:00" });
    const { data: audit } = await admin().schema("app").from("audit_events").select("kind, before, after").eq("workspace_id", ws).eq("kind", "membership.changed");
    expect(audit?.at(-1)?.before).toMatchObject({ role: "editor", is_external: false });
    expect(audit?.at(-1)?.after).toMatchObject({ role: "viewer", is_external: true });
    expect(errors).toEqual([]);
  });

  test("[A05.fail.1] Last-admin demotion refused, and [A06.fail.1] removing the last admin is refused", async ({ page, context, baseURL }) => {
    await signIn(context, ada, baseURL!);
    await page.goto(`/w/${ws}/settings/people`);
    const adaName = ada.email.split("@")[0];
    await manage(page, adaName);
    await expect(dialog(page)).toContainText("is the only admin");
    await dialog(page).getByLabel("Role").selectOption({ label: "Editor" });
    await dialog(page).getByRole("button", { name: "Save changes" }).click();
    await expect(dialog(page).getByRole("alert")).toContainText("The last admin cannot be removed, demoted");
    await dialog(page).getByRole("button", { name: "Remove from the workspace" }).click();
    await dialog(page).getByRole("button", { name: `Remove ${adaName}` }).click();
    await expect(dialog(page).getByRole("alert")).toContainText("The last admin cannot be removed");
    expect(await membership(ws, ada)).toMatchObject({ role: "admin", ended_at: null });
  });

  test("[A06.main] An admin removes a member, and [A06.must.2] their access ends on the next request", async ({ browser, page, context, baseURL }) => {
    // Erik is signed in in his own browser before the removal.
    const erikContext = await browser.newContext();
    await signIn(erikContext, erik, baseURL!);
    const erikPage = await erikContext.newPage();
    await erikPage.goto(`/w/${ws}`);
    await expect(erikPage.getByRole("heading", { level: 1 })).toBeVisible();

    await signIn(context, ada, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/settings/people`);
    const erikName = erik.email.split("@")[0];
    await manage(page, erikName);
    await dialog(page).getByRole("button", { name: "Remove from the workspace" }).click();
    await axe(page);
    await dialog(page).getByLabel(/Reason/).fill("Contract ended");
    await dialog(page).getByRole("button", { name: `Remove ${erikName}` }).click();
    await expect(page.getByRole("status").filter({ hasText: "was removed" })).toBeVisible();
    await expect(row(page, erik.email)).toHaveCount(0);
    expect((await membership(ws, erik))?.ended_at).toBeTruthy();

    await erikPage.reload();
    await expect(erikPage.getByText("You no longer have access to this workspace")).toBeVisible();
    await erikContext.close();
    expect(errors).toEqual([]);
  });

  test("a viewer gets the no-permission state on People and Workspace", async ({ page, context, baseURL }) => {
    const service = admin().schema("app");
    const { data: vicPerson } = await service.from("people").select("id").eq("user_id", vic.userId).single();
    const grant = await service.from("memberships").insert({ workspace_id: ws, person_id: vicPerson!.id, role: "viewer" });
    if (grant.error) throw grant.error;
    await signIn(context, vic, baseURL!);
    const errors = watch(page);
    for (const [route, title] of [["people", "People and roles"], ["workspace", "Workspace"]] as const) {
      await page.goto(`/w/${ws}/settings/${route}`);
      await expect(page.getByText(`Your role cannot open ${title}`)).toBeVisible();
      await expect(page.getByText(`You are a viewer in ${NAME}.`)).toBeVisible();
      await axe(page);
    }
    await expect(page.getByRole("button", { name: "Save workspace" })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("[B01.main] S-WSS-003 Workspace saves the default operator through app.set_default_operator", async ({ page, context, baseURL }) => {
    await signIn(context, ada, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/settings/workspace`);
    await expect(page.getByRole("heading", { level: 1, name: "Workspace" })).toBeVisible();
    await expect(page.getByLabel("Workspace name")).toHaveValue(NAME);
    await expect(page.getByLabel("Default responsible operator")).toHaveValue("Halden Pet Nutrition AB");
    await expect(page.getByText("No recipe is discontinued.", { exact: false })).toBeVisible();
    await axe(page);

    // An address with no country code at its end is refused before the call, and nothing changes.
    await page.getByLabel("Default operator address").fill("Industrivägen 4, Göteborg");
    await expect(page.getByTestId("operator-country")).toContainText("END THE ADDRESS WITH ITS TWO-LETTER CODE");
    await page.getByRole("button", { name: "Save workspace" }).click();
    await expect(page.getByRole("alert")).toContainText("The country could not be read");

    await page.getByLabel("Default responsible operator").fill("Halden Pet Nutrition AB (publ)");
    await page.getByLabel("Default operator address").fill("Industrivägen 6, 412 63 Göteborg, SE");
    await expect(page.getByTestId("operator-country")).toContainText("SE · SWEDEN");
    await page.getByRole("button", { name: "Save workspace" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
    const { data } = await admin().schema("app").from("workspaces").select("default_operator").eq("id", ws).single();
    expect(data!.default_operator).toEqual({ name: "Halden Pet Nutrition AB (publ)", address: "Industrivägen 6, 412 63 Göteborg, SE", country: "SE" });
    await page.getByRole("link", { name: "SEE DISCONTINUED RECIPES" }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${ws}/products/discontinued$`));
    expect(errors).toEqual([]);
  });

  test("[A07.main] S-WSS-006 Your account changes the password and signs out other sessions [A07.must.1]", async ({ page, context, baseURL }) => {
    const other = await admin().auth.admin.updateUserById(ada.userId, { password: "the-first-password-of-ada" });
    if (other.error) throw other.error;
    await signIn(context, ada, baseURL!);
    const errors = watch(page);
    await page.goto(`/account?w=${ws}`);
    await expect(page.getByRole("heading", { level: 1, name: "Your account" })).toBeVisible();
    await expect(page.getByLabel("Email address")).toHaveValue(ada.email);
    await expect(page.getByTestId("two-step")).toHaveText("OFF");
    await expect(page.getByTestId("leaving")).toContainText("You are the only admin");
    await axe(page);
    await expectLikeBaseline(page, page.getByTestId("leaving").locator(".."), "S-WSS-006", REGION.leaving, maxDiff);
    await expectLikeBaseline(page, page.getByRole("heading", { name: "What you get told about" }).locator(".."), "S-WSS-006", REGION.toldAbout, maxDiff);

    await page.getByLabel("New password").fill("short");
    await page.getByLabel("Confirm new password").fill("short");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("alert")).toContainText("At least 12 characters");

    const password = "four words make a passphrase";
    await page.getByLabel("New password").fill(password);
    await page.getByLabel("Confirm new password").fill(password);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Password changed." })).toBeVisible();

    // The new password works; the old one does not; the access event is audited without the secret.
    const { createClient } = await import("@supabase/supabase-js");
    const anon = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    expect((await anon().auth.signInWithPassword({ email: ada.email, password })).error).toBeNull();
    expect((await anon().auth.signInWithPassword({ email: ada.email, password: "the-first-password-of-ada" })).error).not.toBeNull();
    const { data: audit } = await admin().schema("app").from("audit_events").select("*").eq("actor_id", await personId(ada)).eq("kind", "access.password_changed");
    expect(audit!.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain(password);

    await page.getByRole("button", { name: "Sign out everywhere else" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Every other session has been signed out." })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("no dead controls: every settings nav link opens its page, in the settings frame", async ({ page, context, baseURL }) => {
    await signIn(context, ada, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/settings/people`);
    const nav = page.getByRole("navigation", { name: "Settings" });
    const hrefs = await nav.getByRole("link").evaluateAll((links) => links.map((a) => a.getAttribute("href")!));
    expect(hrefs).toEqual([
      `/w/${ws}`,
      `/w/${ws}/settings/people`,
      `/w/${ws}/settings/workspace`,
      `/w/${ws}/settings/data`,
      `/w/${ws}/settings/audit`,
      `/w/${ws}/settings/billing`,
      `/w/${ws}/settings/billing/invoices`,
      `/w/${ws}/settings/billing/payment`,
      `/w/${ws}/settings/billing/details`,
      `/account?w=${ws}`,
    ]);
    for (const href of hrefs.slice(1)) {
      await page.goto(`/w/${ws}/settings/people`);
      await nav.locator(`a[href="${href}"]`).click();
      await expect(page).toHaveURL(new RegExp(`${href.replace("?", "\\?")}$`));
      await expect(page.getByRole("navigation", { name: "Settings" }).locator(`a[href="${href}"]`)).toHaveAttribute("aria-current", "page");
    }
    await nav.locator(`a[href="/w/${ws}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/w/${ws}$`));
    expect(errors).toEqual([]);
  });
});
