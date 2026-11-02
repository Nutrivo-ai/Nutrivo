// T-108 · Audit log (O02, S-WSS-005) on the full local stack. The events are written the way the product writes them:
// RPCs called as the people themselves and the sign-in trigger on auth.sessions. The service role only grants the
// starting memberships (as T-107's tests do) and, for paging, adds plain sign-in events. The screen reads under the
// admin's session (RLS), is compared with its design baseline on the regions the design draws the same for any
// workspace (the banner and the three notes), and axe runs on every state.
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

// Regions of the S-WSS-005 baseline at 1600 px (design boxes, measured from the design file's "audit" screen).
const REGION = {
  banner: { x: 244, y: 94, width: 1328, height: 111, fractionY: 0.59375 },
  notes: { x: 244, y: 750, width: 1328, height: 123, fractionY: 0.0625 },
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

/** A new sign-in for `who`: Supabase Auth inserts an auth.sessions row, and its trigger audits session.started. */
async function signInAgain(who: Person): Promise<Person> {
  const link = await admin().auth.admin.generateLink({ type: "magiclink", email: who.email });
  if (link.error) throw link.error;
  const verified = await who.db.auth.verifyOtp({ type: "email", token_hash: link.data.properties.hashed_token });
  if (verified.error || !verified.data.session) throw verified.error ?? new Error("no session from the magic link");
  return { ...who, session: verified.data.session };
}

async function personId(who: Person) {
  const { data, error } = await admin().schema("app").from("people").select("id").eq("user_id", who.userId).single();
  if (error) throw error;
  return data.id as string;
}

async function grant(ws: string, who: Person, role: string, external: boolean) {
  const { data, error } = await admin()
    .schema("app")
    .from("memberships")
    .insert({ workspace_id: ws, person_id: await personId(who), role, is_external: external })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

const audit = (ws: string, query = "") => `/w/${ws}/settings/audit${query}`;
const rows = (page: Page) => page.locator("tbody tr");

test.describe("Audit log", () => {
  test.skip(!haveStack(), "needs the local Supabase stack: run through scripts/ci/e2e.sh (make e2e)");
  test.describe.configure({ mode: "serial" });

  let ada: Person, karin: Person;
  let ws: string;
  let karinMembership: string;

  test.beforeAll(async () => {
    [ada, karin] = await Promise.all([person("t108-ada"), person("t108-karin")]);
    ws = await workspace(ada, NAME);
    await workspace(karin, "Reglar consulting"); // a person row, as anybody already using Nutrivo has
    karinMembership = await grant(ws, karin, "editor", true);
  });

  test("[O02.main] An admin reads the workspace's events, newest first, filters them and matches the baseline", async ({ page, context, baseURL }) => {
    // Something to read: the admin sets the default operator through its RPC (B01).
    const set = await ada.db.schema("app").rpc("set_default_operator", {
      p_ws: ws,
      p_operator: { name: "Halden Pet Nutrition AB", address: "Industrivägen 4, 412 63 Göteborg, SE", country: "SE" },
    });
    if (set.error) throw set.error;

    await signIn(context, ada, baseURL!);
    const errors = watch(page);
    await page.goto(audit(ws));
    await expect(page.getByRole("heading", { level: 1, name: "Audit log" })).toBeVisible();
    await expect(page.getByText("APPEND-ONLY · INSERTS ONLY")).toBeVisible();
    await expect(page.getByText("Nothing on this screen can be edited or deleted, including by us")).toBeVisible();

    // Newest first: the operator change, then the workspace's creation as the first event of all.
    await expect(rows(page).first()).toHaveAttribute("data-kind", "workspace.default_operator_set");
    await expect(rows(page).first()).toContainText("Default responsible operator set to Halden Pet Nutrition AB");
    await expect(rows(page).last()).toHaveAttribute("data-kind", "workspace.created");
    await expect(rows(page).last()).toContainText(`Workspace ${NAME} created`);
    const { count } = await admin().schema("app").from("audit_events").select("id", { count: "exact", head: true }).eq("workspace_id", ws);
    await expect(rows(page)).toHaveCount(count!);
    await expect(page.getByTestId("audit-count")).toHaveText(new RegExp(`^${count} EVENTS? · SINCE \\d{1,2} [A-Z]{3} \\d{4}$`));
    // Nothing on the screen edits or deletes anything.
    await expect(page.locator("main").getByRole("button")).toHaveCount(0);
    await axe(page);
    await expectLikeBaseline(page, page.getByTestId("audit-banner").locator(".."), "S-WSS-005", REGION.banner, maxDiff);
    await expectLikeBaseline(page, page.getByTestId("audit-notes"), "S-WSS-005", REGION.notes, maxDiff);

    // People and access: the external membership and sign-ins only; the operator change is not among them.
    const filters = page.getByRole("navigation", { name: "Filter events" });
    await filters.getByRole("link", { name: "People and access" }).click();
    await expect(page).toHaveURL(new RegExp(`${audit(ws)}\\?show=access$`));
    await expect(filters.getByRole("link", { name: "People and access" })).toHaveAttribute("aria-current", "page");
    for (const kind of await rows(page).evaluateAll((trs) => trs.map((tr) => tr.getAttribute("data-kind")!))) {
      expect(kind).toMatch(/^(membership|invitation|session|access)\./);
    }
    await expect(page.locator('tbody tr[data-kind="workspace.default_operator_set"]')).toHaveCount(0);

    // Certificates: none yet, so the empty state, whose one action goes back to every event.
    await filters.getByRole("link", { name: "Certificates" }).click();
    await expect(page.getByText("No certificates events yet")).toBeVisible();
    await expect(rows(page)).toHaveCount(0);
    await axe(page);
    await page.getByRole("link", { name: "Show all events" }).click();
    await expect(page).toHaveURL(new RegExp(`${audit(ws)}$`));
    await expect(rows(page)).toHaveCount(count!);
    expect(errors).toEqual([]);
  });

  test("[O02.must.1] External work reads as external forever, also after the person is made internal", async ({ page, context, baseURL }) => {
    // Karin signs in while external: the sign-in is stamped external at write time.
    karin = await signInAgain(karin);
    // Ada makes Karin internal through change_member (A05); then Karin signs in again.
    const changed = await ada.db.schema("app").rpc("change_member", {
      p_membership: karinMembership,
      p_role: "editor",
      p_is_external: false,
      p_scope_family_ids: null as unknown as string[],
      p_scope_node_ids: null as unknown as string[],
      p_access_ends_at: null as unknown as string,
    });
    if (changed.error) throw changed.error;
    karin = await signInAgain(karin);

    await signIn(context, ada, baseURL!);
    const errors = watch(page);
    await page.goto(audit(ws, "?show=access"));
    const karinId = await personId(karin);
    const { data: stored, error } = await admin()
      .schema("app")
      .from("audit_events")
      .select("id, actor_is_external")
      .eq("workspace_id", ws)
      .eq("actor_id", karinId)
      .eq("kind", "session.started")
      .order("id");
    if (error) throw error;
    expect(stored.map((e) => e.actor_is_external)).toEqual([true, false]);

    // Karin's earlier sign-in still reads external; the later one, and every other, reads internal.
    const external = page.locator('tbody tr[data-kind="session.started"][data-external="true"]');
    const internal = page.locator('tbody tr[data-kind="session.started"][data-external="false"]');
    await expect(external).toHaveCount(1);
    await expect(external.locator("td").last()).toHaveText(/\(external\)$/);
    await expect(internal.locator("td").last().filter({ hasText: /\(external\)/ })).toHaveCount(0);
    // The change itself is recorded with what changed.
    await expect(page.locator('tbody tr[data-kind="membership.changed"]')).toContainText("now internal");
    await axe(page);
    expect(errors).toEqual([]);
  });

  test("older events page by page, and no dead controls", async ({ page, context, baseURL }) => {
    // 60 more sign-in events, so the log runs past one page of 50.
    const ada_ = await personId(ada);
    const extra = Array.from({ length: 60 }, () => ({
      workspace_id: ws,
      actor_id: ada_,
      actor_is_external: false,
      kind: "session.started",
      object_type: "session",
      after: { aal: "aal1" },
    }));
    const add = await admin().schema("app").from("audit_events").insert(extra);
    if (add.error) throw add.error;

    await signIn(context, ada, baseURL!);
    const errors = watch(page);
    await page.goto(audit(ws));
    await expect(rows(page)).toHaveCount(50);
    const newestFirst = await rows(page).first().getAttribute("data-kind");
    expect(newestFirst).toBe("session.started");
    await page.getByRole("link", { name: "OLDER EVENTS" }).click();
    await expect(page).toHaveURL(/\?before=\d+$/);
    await expect(rows(page).last()).toHaveAttribute("data-kind", "workspace.created");
    await expect(page.getByRole("link", { name: "OLDER EVENTS" })).toHaveCount(0);
    await axe(page);
    await page.getByRole("link", { name: "NEWEST EVENTS" }).click();
    await expect(page).toHaveURL(new RegExp(`${audit(ws)}$`));
    await expect(rows(page)).toHaveCount(50);

    // Every filter link opens its view, and the current one is marked.
    const filters = page.getByRole("navigation", { name: "Filter events" });
    for (const label of ["Checks", "Documents", "People and access", "Certificates", "All events"]) {
      await filters.getByRole("link", { name: label }).click();
      await expect(filters.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
    }
    expect(errors).toEqual([]);
  });

  test("a viewer and a portfolio manager get the no-permission state (S-WSS-005 is admin, spec/screens.yaml)", async ({ page, context, baseURL }) => {
    for (const [label, role, title] of [
      ["t108-vera", "viewer", "a viewer"],
      ["t108-pia", "portfolio_manager", "a portfolio manager"],
    ] as const) {
      const who = await person(label);
      await workspace(who, `${label}'s own`);
      await grant(ws, who, role, false);
      await context.clearCookies();
      await signIn(context, who, baseURL!);
      const errors = watch(page);
      await page.goto(audit(ws));
      await expect(page.getByText("Your role cannot open Audit log")).toBeVisible();
      await expect(page.getByText(new RegExp(`You are ${title} in ${NAME}\\.`, "i"))).toBeVisible();
      await expect(rows(page)).toHaveCount(0);
      await axe(page);
      expect(errors).toEqual([]);
    }
  });
});
