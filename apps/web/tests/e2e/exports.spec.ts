// O03 · Export everything (T-804) on S-WSS-004 Data and retention: an admin requests the export, the worker writes the
// zip to the exports bucket, and the screen offers a signed download. Free on every plan, never gated (BE-44). A
// viewer gets the no-permission state. axe and the no-dead-controls check run on each state.
// No baseline comparison yet: the design's Workspace Settings side nav and header tag are the settings layout's
// (T-107), and the "Export events" card is out of scope (answer 1 on #71).
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { admin, haveStack, person, signIn, workspace, type Person } from "./support/people";

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

const card = (page: Page) => page.locator("[data-export-state]");

test.describe("full export", () => {
  test.skip(!haveStack(), "needs the local Supabase stack: run through scripts/ci/e2e.sh (make e2e)");
  test.describe.configure({ mode: "serial" });

  let ada: Person, vic: Person;
  let ws: string;
  const NAME = "Harrow Petfoods";

  test.beforeAll(async () => {
    [ada, vic] = await Promise.all([person("t804-ada"), person("t804-vic")]);
    ws = await workspace(ada, NAME);
    await workspace(vic, "Vic's own");   // a person row exists once someone has a workspace (as Ben in shell.spec.ts)
    // Vic's viewer seat, granted as the service role (test setup only; the app writes memberships through RPCs).
    const service = admin();
    const { data: vicPerson, error } = await service.schema("app").from("people").select("id").eq("user_id", vic.userId).single();
    if (error) throw error;
    const grant = await service.schema("app").from("memberships").insert({ workspace_id: ws, person_id: vicPerson.id, role: "viewer" });
    if (grant.error) throw grant.error;
  });

  test("[O03.main] Export everything: the main path works end to end", async ({ page, context, baseURL }) => {
    test.setTimeout(180_000);
    await signIn(context, ada, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/settings/data`);
    await expect(page.getByRole("heading", { level: 1, name: "Data and retention" })).toBeVisible();
    await expect(card(page)).toHaveAttribute("data-export-state", "none");
    await axe(page);

    // Every control on the card does something: the request queues a job and the card shows it.
    await page.getByRole("button", { name: "Request a full export" }).click();
    await expect(card(page)).toHaveAttribute("data-export-state", /preparing|ready/);
    const jobs = await admin().schema("app").from("jobs").select("id, payload").eq("workspace_id", ws).eq("kind", "export");
    expect(jobs.data).toHaveLength(1);
    expect(Object.keys(jobs.data![0].payload as object)).toEqual(["request_id"]);   // ids only, never a token

    // The worker writes the archive; the card refreshes itself while it prepares.
    await expect(card(page)).toHaveAttribute("data-export-state", "ready", { timeout: 150_000 });
    await expect(page.getByText(/^Ready · .* · until /)).toBeVisible();
    await axe(page);

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download the export" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`nutrivo-export-${jobs.data![0].id}.zip`);
    const body = await (await file.createReadStream()).toArray();
    const bytes = Buffer.concat(body as Buffer[]);
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
    for (const name of ["manifest.json", "recipes.csv", "checks.csv", "findings.csv", "reports.csv", "certificates.csv", "documents.csv"]) {
      expect(bytes.includes(Buffer.from(name)), name).toBe(true);
    }
    expect(errors).toEqual([]);
  });

  test("[O03.must.1] Free on every plan, never gated (BE-44).", async ({ page, context, baseURL }) => {
    // The free plan, in dunning and then closed, with a cancelled subscription: the export is still offered and runs.
    const service = admin();
    await service.schema("app").from("subscriptions").insert({ workspace_id: ws, plan: "basic", status: "canceled" });
    for (const status of ["dunning", "closed"]) {
      const set = await service.schema("app").from("workspaces").update({ plan: "free", status }).eq("id", ws);
      if (set.error) throw set.error;
      await signIn(context, ada, baseURL!);
      const errors = watch(page);
      await page.goto(`/w/${ws}/settings/data`);
      await expect(page.getByText("exporting it is free on every plan, including the free one", { exact: false })).toBeVisible();
      await page.getByRole("button", { name: /Request (a full|a new) export/ }).click();
      await expect(card(page)).toHaveAttribute("data-export-state", /preparing|ready/);
      await expect(card(page)).toHaveAttribute("data-export-state", "ready", { timeout: 150_000 });
      expect(errors).toEqual([]);
    }
  });

  test("a viewer sees the no-permission state and cannot request or download", async ({ page, context, baseURL }) => {
    await signIn(context, vic, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/settings/data`);
    await expect(page.getByText("Your role cannot open Data and retention")).toBeVisible();
    await expect(page.getByText(`You are a viewer in ${NAME}.`)).toBeVisible();
    await expect(card(page)).toHaveCount(0);
    await axe(page);
    // Under the viewer's own session neither the RPC nor the bucket gives anything.
    const refused = await vic.db.schema("app").rpc("request_export", { p_ws: ws });
    expect(refused.error?.code).toBe("42501");
    const listed = await vic.db.storage.from("exports").list(ws);
    expect(listed.data ?? []).toEqual([]);
    expect(errors).toEqual([]);
  });
});
