// T-1110 · S-NV2-017 Settings & roles at /w/[workspace]/settings (A03, A05, A06, A08), on the full local stack. The
// overview reads under the admin's session: people (app.memberships), pending invitations, signing authority from
// app.signing_grants rows only (BE-04), the workspace facts and the plan as D-03 sells it (#352). The service role
// only sets up. Every state is visited: loaded, empty (the admin alone), no-permission (a viewer), loading (the
// shell's), and the error boundary is the workspace's. The headings the design draws the same for any workspace are
// compared with the baseline; axe runs on every state; the crawl follows every link and expects no button.
import { expect, test, type Page } from "@playwright/test";
import { expectLikeBaseline, type Region } from "./support/baseline";
import { admin, haveStack, person, signIn, workspace, type Person } from "./support/people";
import { axe, maxDiffPixelRatio, watch } from "./support/public";

// Regions of the S-NV2-017 baseline at 1600 px: the two section headings with their rule, up to the end of their
// text (this page adds a link at the right of each heading, which the design does not draw).
const S_NV2_017: Record<string, Region> = {
  people: { x: 242, y: 90, width: 486, height: 27, fractionY: 0.6875 },
  workspace: { x: 242, y: 485, width: 486, height: 27, fractionY: 0.96875 },
};

async function personId(who: Person) {
  const { data, error } = await admin().schema("app").from("people").select("id").eq("user_id", who.userId).single();
  if (error) throw error;
  return data.id as string;
}

async function join(ws: string, who: Person, role: string, external = false) {
  const { error } = await admin()
    .schema("app")
    .from("memberships")
    .insert({ workspace_id: ws, person_id: await personId(who), role, is_external: external });
  if (error) throw error;
}

const row = (page: Page, email: string) => page.locator(`tr[data-person="${email}"]`);

test.describe("S-NV2-017 Settings & roles", () => {
  test.skip(!haveStack(), "needs the local Supabase stack: run through scripts/ci/e2e.sh (make e2e)");
  test.describe.configure({ mode: "serial" });
  test.use({ viewport: { width: 1600, height: 1000 } });

  let owner: Person, editor: Person, outside: Person, viewer: Person, alone: Person;
  let ws: string, lonely: string;

  test.beforeAll(async () => {
    [owner, editor, outside, viewer, alone] = await Promise.all(
      ["owner", "editor", "outside", "viewer", "alone"].map((l) => person(`t1110-${l}`)),
    );
    ws = await workspace(owner, "Halden Pet Nutrition");
    lonely = await workspace(alone, "Only me");
    // Person rows, as people who already use Nutrivo have.
    await Promise.all([editor, outside, viewer].map((p) => workspace(p, "Own workspace")));
    await join(ws, editor, "editor");
    await join(ws, outside, "editor", true);
    await join(ws, viewer, "viewer");
    // The grants go to the internal editor: a grant holder must pass two-step before any page (A02), which the
    // admin here, signing in by magic link, has not set up.
    const me = await personId(owner);
    const signer = await personId(editor);
    const grants = await admin()
      .schema("app")
      .from("signing_grants")
      .insert(["EU-DE", "EU-AT"].map((node_id) => ({ workspace_id: ws, person_id: signer, node_id, granted_by: me })));
    if (grants.error) throw grants.error;
    const invited = await admin()
      .schema("app")
      .from("invitations")
      .insert({
        workspace_id: ws,
        email: `t1110-pending-${Date.now()}@example.test`,
        role: "viewer",
        invited_by: me,
      });
    if (invited.error) throw invited.error;
  });

  test("[T-1110] loaded: people with signing authority from grants only, the workspace facts and the plan, like the baseline", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, owner, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/settings`);
    await expect(page.getByRole("heading", { level: 1, name: "People, signing authority and workspace" })).toBeVisible();
    await expect(row(page, editor.email).locator("[data-signing]")).toHaveText("AT · DE"); // in node id order
    await expect(row(page, owner.email).locator("[data-signing]")).toHaveText("None"); // admin is a role, not a grant (BE-04)
    await expect(row(page, outside.email).locator("[data-signing]")).toHaveText("None");
    await expect(row(page, outside.email)).toContainText("Editor · external");
    await expect(row(page, viewer.email)).toContainText("Viewer");
    await expect(page.locator("[data-invitations]")).toContainText("1 PENDING INVITATION");
    const facts = page.locator('[data-region="workspace"] dl');
    await expect(facts).toContainText("Markets enabled");
    await expect(facts).toContainText("PER MARKET");
    await expect(facts).not.toContainText("Tenancy model");
    await expect(facts).not.toContainText("Term register");
    const plan = page.locator('[data-region="plan"]');
    await expect(plan).toContainText("Editor seats");
    await expect(plan).toContainText("viewers free");
    await expect(plan).toContainText("unmetered");
    await expect(plan).not.toContainText("jurisdiction nodes");
    await expect(page.locator('[data-region="people"] [data-pattern]')).toHaveCount(0);
    await expectLikeBaseline(page, page.getByRole("heading", { name: "People and roles" }).locator("../.."), "S-NV2-017", S_NV2_017.people, maxDiffPixelRatio);
    await expectLikeBaseline(page, page.getByRole("heading", { name: "Workspace", exact: true }).locator("../.."), "S-NV2-017", S_NV2_017.workspace, maxDiffPixelRatio);
    await axe(page);
    expect(errors).toEqual([]);
  });

  test("[T-1110] empty: an admin alone is invited to bring people in", async ({ page, context, baseURL }) => {
    await signIn(context, alone, baseURL!);
    await page.goto(`/w/${lonely}/settings`);
    await expect(row(page, alone.email)).toBeVisible();
    const empty = page.locator('[data-region="people"] [data-pattern="none"]');
    await expect(empty).toContainText("Nobody else is in this workspace yet");
    await expect(empty.getByRole("link", { name: "Invite people" })).toHaveAttribute("href", `/w/${lonely}/settings/people`);
    await axe(page);
  });

  test("[T-1110] no-permission: a viewer reads nothing of the overview", async ({ page, context, baseURL }) => {
    await signIn(context, viewer, baseURL!);
    await page.goto(`/w/${ws}/settings`);
    await expect(page.getByText("Your role cannot open Settings & roles")).toBeVisible();
    await expect(page.locator('[data-region="settings-overview"]')).toHaveCount(0);
    await expect(page.getByText(owner.email)).toHaveCount(0);
    await axe(page);
  });

  test("[T-1110] no dead controls: every link resolves, and the overview has no button", async ({ page, context, baseURL }) => {
    await signIn(context, owner, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/settings`);
    await expect(page.locator('[data-region="settings-overview"]')).toBeVisible();
    const hrefs = await page
      .locator('[data-region="settings-overview"] a')
      .filter({ visible: true })
      .evaluateAll((links) => links.map((a) => a.getAttribute("href")));
    for (const expected of ["/settings/people", "/settings/workspace", "/settings/audit", "/settings/billing", "/library/coverage"]) {
      expect(hrefs).toContain(`/w/${ws}${expected}`);
    }
    expect(hrefs).toContain(`/account?w=${ws}`);
    for (const href of new Set(hrefs)) {
      expect(href, `${href} stays on the site`).toMatch(/^\//);
      const response = await page.request.get(href!, { maxRedirects: 0 });
      expect(response.status(), href!).toBeLessThan(400);
    }
    await expect(page.locator('[data-region="settings-overview"] button')).toHaveCount(0);
    await page.getByRole("link", { name: "People and roles →" }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${ws}/settings/people$`));
    expect(errors).toEqual([]);
  });
});
