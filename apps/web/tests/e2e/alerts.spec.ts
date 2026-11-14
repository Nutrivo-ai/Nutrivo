// T-902 · J04 Horizon and alerts inbox: S-MIS-001 (desktop) and S-MOB-006 (390 px) at /w/[workspace]/alerts, S-MIS-002
// at /w/[workspace]/horizon. Alerts are written as production writes them: checks whose applied or withheld rule keys
// name a rule, a released rule diff for it, and app.fan_out_rule_diff (T-901, contract 5) through the service role.
// The rules, diffs and horizon item are synthetic e2e rows with unique keys, never regulatory content. People read
// under RLS; read state is per person (BE-39). Runs on the full local stack (scripts/ci/e2e.sh).
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { expectLikeBaseline, type Region } from "./support/baseline";
import { admin, haveStack, person, signIn, workspace, type Person } from "./support/people";
import { axe, maxDiffPixelRatio, watch } from "./support/public";

const RULESET = "0000.00-empty";
const RUN = randomUUID().slice(0, 8);

async function must<R = { id: string }>(what: string, p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<R> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  if (data == null) throw new Error(`${what}: no row`);
  return data as R;
}

function day(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
function mono(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

type Seeded = {
  products: Record<string, string>;
  diffs: { fr: string; ethox: string; texas: string };
  titles: { fr: string; ethox: string; texas: string; draft: string };
  /** The message of the Texas recipe's finding, which no screen may show while the plan does not hold the US. */
  texasFinding: string;
  /** The Texas recipe's artwork, whose one panel the Texas check read. */
  texasArtwork: string;
};

/**
 * Five recipes in France, Germany and Texas, each with a check that used one of three rules; three released diffs:
 * a French wording change coming in 49 days, an EU withdrawn authorisation coming in 139 days with sell-through to
 * 322, and a Texas obligation in force for 73 days. The workspace's plan holds the EU only (the default).
 */
async function seed(ws: string): Promise<Seeded> {
  const app = admin().schema("app");
  const ref = admin().schema("ref");
  const titles = {
    fr: `E2E ${RUN} prescribed wording for complete feed changes in France`,
    ethox: `E2E ${RUN} feed additive authorisation withdrawn for all species`,
    texas: `E2E ${RUN} Texas registration form changed`,
    draft: `E2E ${RUN} analytical tolerance bands under revision`,
  };
  const keys = { fr: `e2e.t902.${RUN}.fr`, ethox: `e2e.t902.${RUN}.ethox`, texas: `e2e.t902.${RUN}.texas` };
  await must(
    "rules",
    ref
      .from("rules")
      .insert([
        { rule_key: keys.fr, shape: "prescribed_wording", domain: "claims_wording", node_id: "EU-FR", title: titles.fr },
        { rule_key: keys.ethox, shape: "additive_condition", domain: "composition", node_id: "EU", title: titles.ethox },
        { rule_key: keys.texas, shape: "mandatory_particular", domain: "registration", node_id: "US-TX", title: titles.texas },
      ])
      .select("rule_key"),
  );

  const products: Record<string, string> = {};
  const markets: Record<string, string[]> = {
    "Puppy complete wet": ["EU-FR", "EU-DE"],
    "Adult cat wet": ["EU-FR"],
    "Working dog high energy": ["EU-DE"],
    "Senior salmon dry": ["EU-DE"],
    "Adult dog complete dry": ["US-TX"],
  };
  for (const [name, nodes] of Object.entries(markets)) {
    const fam = await must("family", app.from("families").insert({ workspace_id: ws, name }).select("id").single());
    const p = await must("product", app.from("products").insert({ workspace_id: ws, family_id: fam.id, name, stage: "active" }).select("id").single());
    products[name] = p.id;
    await must("markets", app.from("product_nodes").insert(nodes.map((node_id) => ({ product_id: p.id, node_id, workspace_id: ws }))).select("node_id"));
  }
  const job = await must(
    "job",
    app.from("jobs").insert({ workspace_id: ws, kind: "check", status: "succeeded", idempotency_key: `e2e-t902:${RUN}`, payload: {} }).select("id").single(),
  );
  const check = (name: string, node: string, applied: string[], withheld: string[] = []) => ({
    workspace_id: ws,
    job_id: job.id,
    product_id: products[name],
    node_id: node,
    ruleset_version: RULESET,
    label_state: "not_assessed",
    applied_rule_keys: applied,
    withheld_rule_keys: withheld,
  });
  await must(
    "checks",
    app
      .from("checks")
      .insert([
        check("Puppy complete wet", "EU-FR", [keys.fr]),
        check("Puppy complete wet", "EU-DE", []),
        check("Adult cat wet", "EU-FR", [keys.fr]),
        check("Working dog high energy", "EU-DE", [], [keys.ethox]),
        check("Senior salmon dry", "EU-DE", [keys.ethox]),
      ])
      .select("id"),
  );
  // The Texas recipe's check has a finding, and is its market's latest job, as the check worker leaves it.
  const texasFinding = `E2E ${RUN} Texas finding message`;
  // Its check read a panel of its artwork, so the artwork page folds the Texas state into that panel (D02).
  const dog = products["Adult dog complete dry"];
  const sha = randomUUID().replace(/-/g, "").padEnd(64, "0");
  const av = await must(
    "artwork",
    app
      .from("artwork_versions")
      .insert({
        workspace_id: ws, product_id: dog, version: 1, file_sha256: sha, storage_path: `${ws}/${dog}/${sha}.pdf`,
        file_name: "E2E-DOG-v1.pdf", mime_type: "application/pdf", page_count: 1, is_new_artwork: true,
      })
      .select("id")
      .single(),
  );
  const run = await must(
    "extraction",
    app
      .from("extraction_runs")
      .insert({
        workspace_id: ws, product_id: dog, artwork_version_id: av.id, engine: "pdfium", engine_version: "e2e",
        idempotency_key: `e2e-t902:${av.id}`, status: "succeeded", started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
      })
      .select("id")
      .single(),
  );
  const panel = await must(
    "panel",
    app
      .from("artwork_panels")
      .insert({
        workspace_id: ws, product_id: dog, artwork_version_id: av.id, extraction_run_id: run.id, page: 1, panel_index: 0,
        bbox_mm: [0, 0, 105, 297], language: "en", language_confidence: 0.99, status: "extracted",
      })
      .select("id")
      .single(),
  );
  const tx = await must(
    "texas check",
    app
      .from("checks")
      .insert({ ...check("Adult dog complete dry", "US-TX", [keys.texas]), panel_id: panel.id, artwork_version_id: av.id, language: "en", artwork_sha: sha })
      .select("id")
      .single(),
  );
  await must(
    "texas finding",
    app
      .from("check_findings")
      .insert({
        workspace_id: ws, check_id: tx.id, product_id: products["Adult dog complete dry"], node_id: "US-TX", state: "action",
        provenance: "deterministic_rule", rule_key: keys.texas, citation: "E2E citation", message: texasFinding,
        recommended_action: "E2E action",
      })
      .select("id"),
  );
  await must(
    "texas market",
    app
      .from("product_nodes")
      .update({ label_state: "action", open_actions: 1, ruleset_version: RULESET, last_check_job_id: job.id })
      .eq("product_id", products["Adult dog complete dry"])
      .eq("node_id", "US-TX")
      .select("node_id"),
  );

  const diff = async (rule_key: string, effect_type: string, effective_from: string, sell_through_until: string | null = null) =>
    (
      await must(
        "diff",
        ref
          .from("rule_diffs")
          .insert({ ruleset_version: RULESET, rule_key, to_version: 1, effect_type, effective_from, sell_through_until })
          .select("id")
          .single(),
      )
    ).id as string;
  const diffs = {
    fr: await diff(keys.fr, "prescribed_wording", day(49)),
    ethox: await diff(keys.ethox, "withdrawn_authorisation", day(139), day(322)),
    texas: await diff(keys.texas, "new_obligation", day(-73)),
  };
  for (const id of Object.values(diffs)) await must("fan-out", app.rpc("fan_out_rule_diff", { p_rule_diff: id }));
  await must("horizon item", ref.from("horizon_items").insert({ title: titles.draft, stage: "draft" }).select("id").single());
  return { products, diffs, titles, texasFinding, texasArtwork: av.id };
}

const card = (page: Page, diff: string) => page.locator(`[data-region="inbox"] [data-alert="${diff}"]`);

// S-MIS-001 at 1600 px: the "Coming, and in force" panel beside the inbox, drawn as the design draws it (its top edge
// at y 155.375). The inbox's cards hold the design's own changes, and its Documents and Draft cards are not built
// (#73 gaps 1 and 3), so they are not compared.
const S_MIS_001: Record<string, Region> = { comingPanel: { x: 1276, y: 155, width: 296, height: 158, fractionY: 0.375 } };
// S-MIS-002: the "A draft is marked as a draft" panel (top edge y 761.625). The watch list above it is not built (#73 gap 2).
const S_MIS_002: Record<string, Region> = { draftPanel: { x: 1272, y: 761, width: 300, height: 139, fractionY: 0.625 } };
// S-MOB-006 (the phone element): the day kicker and the "Two things changed" title, width-independent as in T-507.
const S_MOB_006: Record<string, Region> = {
  kicker: { x: 24, y: 88, width: 60, height: 11, fractionY: 0.71875 },
  title: { x: 24, y: 105, width: 150, height: 18, fractionY: 0.65625 },
};

test.describe("horizon and alerts inbox", () => {
  test.skip(!haveStack(), "needs the local Supabase stack: run through scripts/ci/e2e.sh (make e2e)");
  test.describe.configure({ mode: "serial" });

  let owner: Person, viewer: Person, phone: Person, crawler: Person, euOnly: Person, outsider: Person, fresh: Person;
  let ws: string, emptyWs: string;
  let s: Seeded;

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    [owner, viewer, phone, crawler, euOnly, outsider, fresh] = await Promise.all(
      ["owner", "viewer", "phone", "crawler", "eu-only", "outsider", "fresh"].map((l) => person(`t902-${l}`)),
    );
    ws = await workspace(owner, "Halden Alerts Test");
    emptyWs = await workspace(fresh, "Nothing Changed Yet");
    await Promise.all([viewer, phone, crawler, euOnly, outsider].map((p) => workspace(p, "Own workspace")));
    const app = admin().schema("app");
    for (const [who, scope] of [[viewer, null], [phone, null], [crawler, null], [euOnly, ["EU"]]] as const) {
      const p = await must("person", app.from("people").select("id").eq("user_id", who.userId).single());
      await must("membership", app.from("memberships").insert({ workspace_id: ws, person_id: p.id, role: "viewer", scope_node_ids: scope ? [...scope] : null }).select("id"));
    }
    s = await seed(ws);
  });

  test("[J04.main] Horizon and alerts inbox: the main path works end to end", async ({ page, context, baseURL }) => {
    await signIn(context, viewer, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/alerts`);

    // One card per change, each unread for this person, each saying coming or in force with its date.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Alerts inbox");
    await expect(page.locator("[data-unread-count]")).toHaveText("3 UNREAD");
    await expect(page.locator('[data-region="inbox"] article')).toHaveCount(3);
    const fr = card(page, s.diffs.fr);
    await expect(fr).toHaveAttribute("data-phase", "coming");
    await expect(fr).toHaveAttribute("data-unread", "true");
    await expect(fr.locator("[data-phase-label]")).toHaveText("COMING");
    await expect(fr.locator("[data-effective]")).toHaveText(`IN FORCE ${mono(day(49))}`);
    await expect(fr.getByRole("heading", { level: 2 })).toHaveText(s.titles.fr);
    await expect(fr.locator("[data-recipe]")).toHaveText(["Adult cat wet", "Puppy complete wet"]); // Puppy's German check did not use the rule
    await expect(fr.locator('[data-glyph="action"]')).toHaveCount(1);
    const ethox = card(page, s.diffs.ethox);
    await expect(ethox.locator('[data-glyph="blocked"]')).toHaveCount(1);
    await expect(ethox).toContainText("with sell-through to");
    await expect(ethox.locator("[data-recipe]")).toHaveText(["Senior salmon dry", "Working dog high energy"]); // applied or withheld
    const texas = card(page, s.diffs.texas);
    await expect(texas).toHaveAttribute("data-phase", "in_force");
    await expect(texas.locator("[data-phase-label]")).toHaveText("IN FORCE");
    await expect(texas.locator("[data-effective]")).toHaveText(`APPLIED ${mono(day(-73))}`);
    await axe(page);
    await expectLikeBaseline(page, page.getByRole("heading", { name: "Coming, and in force" }).locator(".."), "S-MIS-001", S_MIS_001.comingPanel, maxDiffPixelRatio);

    // Filters live in the URL: in force, then coming.
    const filters = page.getByRole("navigation", { name: "Alert filters" });
    await filters.getByRole("link", { name: "In force" }).click();
    await expect(page).toHaveURL(/show=in_force/);
    await expect(page.locator('[data-region="inbox"] article')).toHaveCount(1);
    await expect(filters.getByRole("link", { name: "In force" })).toHaveAttribute("aria-current", "true");
    await filters.getByRole("link", { name: "Coming" }).click();
    await expect(page).toHaveURL(/show=coming/);
    await expect(page.locator('[data-region="inbox"] article')).toHaveCount(2);
    await filters.getByRole("link", { name: "All" }).click();

    // A recipe opens its finding: the verdict for that product in that market.
    await card(page, s.diffs.fr).getByRole("link", { name: "Adult cat wet" }).click();
    await expect(page).toHaveURL(new RegExp(`/products/${s.products["Adult cat wet"]}/nodes/EU-FR$`));
    await page.goBack();

    // Mark all read: this person's read state only (BE-39).
    await page.getByRole("button", { name: "MARK ALL READ" }).click();
    await expect(page.locator("[data-unread-count]")).toHaveText("ALL READ");
    await expect(page.locator('[data-region="inbox"] article[data-unread="true"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "MARK ALL READ" })).toHaveCount(0);
    expect(errors).toEqual([]);

    // The horizon: the nearest sell-through deadline leads, then everything coming in date order.
    await page.goto(`/w/${ws}/horizon`);
    await expect(page.locator("[data-deadlines]")).toHaveText("1 SELL-THROUGH DEADLINE");
    const deadline = page.locator('[data-region="deadline"]');
    await expect(deadline).toHaveAttribute("data-diff", s.diffs.ethox);
    await expect(deadline.getByRole("heading", { level: 2 })).toHaveText(s.titles.ethox);
    await expect(deadline.locator("[data-days]")).toHaveText("139");
    await expect(deadline).toContainText("DAYS TO REFORMULATE");
    const timeline = page.locator('[data-region="timeline"] li');
    const ours = timeline.filter({ hasText: `E2E ${RUN}` });
    await expect(ours.locator("[data-date]")).toHaveText([mono(day(49)), mono(day(139)), mono(day(322)), "NO DATE"]);
    await expect(ours.nth(1).locator("[data-impact]")).toContainText("recipes to reformulate");
    await expect(ours.nth(0)).toContainText(`France · ${s.titles.fr}`);
    const draft = ours.filter({ hasText: s.titles.draft });
    await expect(draft.locator("[data-stage]")).toHaveText("DRAFT");
    await expect(draft.locator("[data-unlinked]")).toHaveText("Not yet linked to your recipes");
    await axe(page);
    await expectLikeBaseline(page, page.getByRole("heading", { name: "A draft is marked as a draft" }).locator(".."), "S-MIS-002", S_MIS_002.draftPanel, maxDiffPixelRatio);

    // "Open the two recipes" shows that one change in the inbox.
    await deadline.getByRole("link", { name: "Open the two recipes" }).click();
    await expect(page).toHaveURL(new RegExp(`/alerts\\?diff=${s.diffs.ethox}$`));
    await expect(page.locator('[data-region="inbox"] article')).toHaveCount(1);
    await expect(page.locator(`[data-region="inbox"] [data-one-change]`)).toBeVisible();
    expect(errors).toEqual([]);

    // A colleague's read state is their own: the owner still has three unread.
    await context.clearCookies();
    await signIn(context, owner, baseURL!);
    await page.goto(`/w/${ws}/alerts`);
    await expect(page.locator("[data-unread-count]")).toHaveText("3 UNREAD");
  });

  test("[J04.must.1] An alert for a region outside the plan names recipes but cannot open the finding (BE-39).", async ({ page, context, baseURL }) => {
    await signIn(context, owner, baseURL!);
    await page.goto(`/w/${ws}/alerts`);
    const texas = card(page, s.diffs.texas);
    // The plan holds the EU only: the Texas change and its recipe are named, and nothing opens the finding.
    await expect(texas.getByRole("heading", { level: 2 })).toHaveText(s.titles.texas);
    await expect(texas.locator("[data-recipe]")).toHaveText(["Adult dog complete dry"]);
    await expect(texas.locator("[data-recipe]")).toHaveAttribute("data-locked", "true");
    await expect(texas.getByRole("link")).toHaveCount(0);
    await expect(texas.locator("[data-outside-plan]")).toContainText("Your plan does not include United States, so the finding cannot be opened.");
    // An EU change in the same inbox opens its findings.
    await expect(card(page, s.diffs.fr).getByRole("link")).toHaveCount(2);
    await axe(page);

    // The finding cannot be opened by direct URL either: the verdict, the label report and the board's findings view
    // show the not-in-plan state, never the finding.
    const dog = s.products["Adult dog complete dry"];
    await page.goto(`/w/${ws}/products/${dog}/nodes/US-TX`);
    await expect(page.locator('[data-region="outside-plan"]')).toContainText("Your plan does not include United States");
    await expect(page.locator('[data-region="verdict"]')).toHaveCount(0);
    await expect(page.getByText(s.texasFinding)).toHaveCount(0);
    await axe(page);
    await page.goto(`/w/${ws}/products/${dog}/nodes/US`);
    await expect(page.locator('[data-region="outside-plan"]')).toBeVisible();
    await page.goto(`/w/${ws}/products/${dog}/report`);
    await expect(page.locator("[data-outside-plan]")).toContainText("Not shown: Texas. Your plan does not include United States");
    await expect(page.getByText(s.texasFinding)).toHaveCount(0);
    await page.goto(`/w/${ws}/board?view=findings`);
    await expect(page.locator("[data-outside-plan]")).toContainText("Findings in United States are not shown");
    await expect(page.getByText(s.texasFinding)).toHaveCount(0);
    // The artwork page does not fold the Texas check into its panel: the panel reads as not checked.
    await page.goto(`/w/${ws}/products/${dog}/artwork/${s.texasArtwork}`);
    await expect(page.locator('[data-panel="0"]')).toHaveAttribute("data-panel-state", "not_checked");

    // Once the plan holds the US, the same alert opens the finding, and the finding shows.
    const app = admin().schema("app");
    await must("plan", app.from("workspaces").update({ entitled_regions: ["EU", "US"] }).eq("id", ws).select("id"));
    try {
      await page.goto(`/w/${ws}/alerts`);
      await expect(card(page, s.diffs.texas).getByRole("link", { name: "Adult dog complete dry" })).toHaveAttribute(
        "href",
        `/w/${ws}/products/${dog}/nodes/US-TX`,
      );
      await expect(card(page, s.diffs.texas).locator("[data-outside-plan]")).toHaveCount(0);
      await card(page, s.diffs.texas).getByRole("link", { name: "Adult dog complete dry" }).click();
      await expect(page.locator('[data-region="verdict"]')).toBeVisible();
      await expect(page.locator('[data-region="outside-plan"]')).toHaveCount(0);
      await page.goto(`/w/${ws}/board?view=findings`);
      await expect(page.getByText(s.texasFinding)).toBeVisible();
      await expect(page.locator("[data-outside-plan]")).toHaveCount(0);
      await page.goto(`/w/${ws}/products/${dog}/artwork/${s.texasArtwork}`);
      await expect(page.locator('[data-panel="0"]')).toHaveAttribute("data-panel-state", "not_assessed");
    } finally {
      await must("plan", app.from("workspaces").update({ entitled_regions: ["EU"] }).eq("id", ws).select("id"));
    }
  });

  test("[T-902] S-MOB-006 at 390 px: what changed, newest first, with the first to open", async ({ page, context, baseURL }) => {
    // This person has already read the Texas alert, so two things are new.
    const texasIds = await must<{ id: string }[]>("texas alerts", admin().schema("app").from("alerts").select("id").eq("rule_diff_id", s.diffs.texas));
    const read = await phone.db.schema("app").rpc("mark_alerts_read", { p_alerts: texasIds.map((a) => a.id) });
    if (read.error) throw read.error;

    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(context, phone, baseURL!);
    const errors = watch(page);
    await page.goto(`/w/${ws}/alerts`);
    const m = page.locator('[data-region="mobile-alerts"]');
    await expect(m.locator('[data-region="summary"] h2')).toHaveText("Two things changed");
    await expect(m.locator('[data-region="summary"] p')).toHaveText("Today");
    await expect(m.locator('[data-region="alert"][data-unread="true"]')).toHaveCount(2);
    await expect(m.locator(`[data-alert="${s.diffs.fr}"]`)).toContainText(`Affects Adult cat wet · Puppy complete wet. Effective`);
    await expect(m.locator(`[data-alert="${s.diffs.fr}"]`)).toContainText("so there is time.");
    await expect(m.locator(`[data-alert="${s.diffs.texas}"]`)).toHaveAttribute("data-unread", "false");
    await expect(m.locator(`[data-alert="${s.diffs.texas}"]`)).toContainText("Your plan does not include United States");
    const open = m.getByRole("link", { name: "Open the first" });
    expect((await open.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await axe(page);
    expect(errors).toEqual([]);

    await expectLikeBaseline(page, m.locator('[data-region="summary"] p'), "S-MOB-006", S_MOB_006.kicker, maxDiffPixelRatio);
    await page.reload();
    const title = page.locator('[data-region="mobile-alerts"] [data-region="summary"] h2');
    await expect(title).toBeVisible();
    await expectLikeBaseline(page, title, "S-MOB-006", S_MOB_006.title, maxDiffPixelRatio);

    // The phone has the inbox's controls: the filters (44 px targets) and Mark all read. The count is every unread
    // change, as the header's chip counts them, whatever the filter shows.
    const mob = page.locator('[data-region="mobile-alerts"]');
    const inForce = mob.getByRole("navigation", { name: "Alert filters" }).getByRole("link", { name: "In force" });
    expect((await inForce.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await inForce.click();
    await expect(page).toHaveURL(/show=in_force/);
    await expect(mob.locator('[data-region="alert"]')).toHaveCount(1);
    await expect(mob.locator('[data-region="summary"] h2')).toHaveText("Two things changed");
    await mob.getByRole("navigation", { name: "Alert filters" }).getByRole("link", { name: "All" }).click();
    await expect(mob.locator('[data-region="alert"]')).toHaveCount(3);

    await mob.getByRole("link", { name: "Open the first" }).click();
    await expect(page).toHaveURL(/\/products\/[0-9a-f-]+\/nodes\/EU-(FR|DE)$/);
    await page.goBack();

    const mark = page.locator('[data-region="mobile-alerts"]').getByRole("button", { name: "MARK ALL READ" });
    expect((await mark.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await mark.click();
    await expect(page.locator('[data-region="mobile-alerts"] [data-region="summary"] h2')).toHaveText("Nothing new since you last read them");
    await expect(page.locator('[data-region="mobile-alerts"] [data-region="alert"][data-unread="true"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("[T-902] states: empty, nothing in a filter, scoped out, no access", async ({ page, context, baseURL }) => {
    // A workspace no change has touched: both screens say so and point at each other.
    await signIn(context, fresh, baseURL!);
    await page.goto(`/w/${emptyWs}/alerts`);
    await expect(page.getByText("No rule change affects your recipes yet")).toBeVisible();
    await expect(page.getByRole("link", { name: "See what is coming" })).toHaveAttribute("href", `/w/${emptyWs}/horizon`);
    await expect(page.locator("[data-unread-count]")).toHaveText("ALL READ");
    await axe(page);
    await page.goto(`/w/${emptyWs}/horizon`);
    await expect(page.locator('[data-region="deadline"]')).toHaveCount(0);
    await expect(page.locator("[data-deadlines]")).toHaveCount(0);
    await axe(page);

    // A member scoped to the EU reads no Texas alert (RLS, market scope): nothing is in force for them.
    await context.clearCookies();
    await signIn(context, euOnly, baseURL!);
    await page.goto(`/w/${ws}/alerts`);
    await expect(page.locator('[data-region="inbox"] article')).toHaveCount(2);
    await expect(card(page, s.diffs.texas)).toHaveCount(0);
    await page.goto(`/w/${ws}/alerts?show=in_force`);
    const desk = page.locator('[data-region="inbox"]');
    await expect(desk.getByText("Nothing in force needs reading")).toBeVisible();
    await expect(desk.getByRole("link", { name: "Show every alert" })).toHaveAttribute("href", `/w/${ws}/alerts`);
    await axe(page);
    // The same at 390 px: the phone says nothing is in force, and the count still names the two unread changes.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    const phoneView = page.locator('[data-region="mobile-alerts"]');
    await expect(phoneView.locator('[data-region="filtered-empty"]')).toContainText("Nothing in force needs reading");
    await expect(phoneView.locator('[data-region="summary"] h2')).toHaveText("Two things changed");
    await expect(phoneView.getByRole("link", { name: "Show every alert" })).toHaveAttribute("href", `/w/${ws}/alerts`);
    await axe(page);
    await page.setViewportSize({ width: 1600, height: 1000 });

    // Someone outside the workspace reads nothing: RLS returns no row, and the shell says so.
    await context.clearCookies();
    await signIn(context, outsider, baseURL!);
    for (const route of ["alerts", "horizon"]) {
      await page.goto(`/w/${ws}/${route}`);
      await expect(page.locator('[data-region="inbox"], [data-region="horizon"]')).toHaveCount(0);
      await expect(page.getByText(s.titles.fr)).toHaveCount(0);
    }
  });

  test("[T-902] keyboard: the filters and Mark all read work from the keyboard", async ({ page, context, baseURL }) => {
    await signIn(context, owner, baseURL!);
    await page.goto(`/w/${ws}/alerts`);
    const coming = page.getByRole("navigation", { name: "Alert filters" }).getByRole("link", { name: "Coming" });
    await coming.focus();
    await expect(coming).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/show=coming/);
    const mark = page.getByRole("button", { name: "MARK ALL READ" });
    await mark.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(mark).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-unread-count]")).toHaveText("ALL READ");
  });

  test("[T-902] no dead controls on the alerts inbox and the horizon", async ({ page, context, baseURL }) => {
    await signIn(context, crawler, baseURL!);
    for (const [route, region] of [["horizon", "horizon"], ["alerts", "inbox"]]) {
      const url = `/w/${ws}/${route}`;
      const errors = watch(page);
      await page.goto(url);
      await expect(page.locator(`[data-region="${region}"]`)).toBeVisible();
      // Every visible link in the screen resolves on the site.
      const hrefs = await page.locator("main a").filter({ visible: true }).evaluateAll((links) => links.map((a) => a.getAttribute("href")));
      expect(hrefs.length, `${url} has links`).toBeGreaterThan(0);
      for (const href of new Set(hrefs)) {
        expect(href, `${href} stays on the site`).toMatch(/^\//);
        const response = await page.request.get(href!.split("#")[0], { maxRedirects: 0 });
        expect(response.status(), href!).toBeLessThan(400);
      }
      // Every visible button in the screen changes something: the inbox's only one is Mark all read.
      const buttons = page.locator("main button").filter({ visible: true });
      const count = await buttons.count();
      for (let i = 0; i < count; i++) {
        const before = await page.locator("main").innerText();
        await buttons.nth(i).click();
        await expect.poll(() => page.locator("main").innerText()).not.toBe(before);
      }
      expect(route === "alerts" ? count : 0).toBe(route === "alerts" ? 1 : count);
      expect(errors).toEqual([]);
    }
  });
});
