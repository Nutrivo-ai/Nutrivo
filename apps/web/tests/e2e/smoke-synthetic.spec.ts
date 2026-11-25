// #183, #19 answer 5 (founder decision 25 Nov 2026): after each staging deploy the synthetic user signs in, runs one
// job through the worker to a terminal state, and verify answers. The user's workspace, "Synthetic monitoring", is
// made once, the first time this runs, and reused after that. Staging only: it needs the staging secrets
// (SYNTHETIC_USER_EMAIL, SYNTHETIC_USER_PASSWORD, the service role for the one-time account) and never runs against
// prod (make smoke ENV=prod) or the local stack, which has no synthetic user.
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import type { Database } from "../../src/lib/database.types";
import { FUNCTION_REGION } from "../../src/lib/public/region";

const E = process.env;
const supabaseUrl = E.SUPABASE_URL ?? E.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = E.SUPABASE_ANON_KEY ?? E.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const email = E.SYNTHETIC_USER_EMAIL;
const password = E.SYNTHETIC_USER_PASSWORD;
const WORKSPACE = "Synthetic monitoring";
const JOB_TIMEOUT_MS = 120_000;

const ready = Boolean(supabaseUrl && anonKey && email && password && E.SUPABASE_SERVICE_ROLE_KEY) && E.ENV !== "prod";

/** The synthetic account, created once with the service role (confirmed, password set). Never logs the address. */
async function ensureAccount() {
  const admin = createClient(supabaseUrl!, E.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listing auth users failed: ${error.code ?? error.status}`);
    if (data.users.some((u) => u.email?.toLowerCase() === email!.toLowerCase())) return;
    if (data.users.length < 1000) break;
  }
  const { error } = await admin.auth.admin.createUser({ email: email!, password: password!, email_confirm: true });
  if (error) throw new Error(`creating the synthetic account failed: ${error.code ?? error.status}`);
}

/** The synthetic user's "Synthetic monitoring" workspace, read under RLS, else made through app.create_workspace. */
async function ensureWorkspace(db: SupabaseClient<Database>): Promise<string> {
  const { data: rows, error } = await db.schema("app").from("workspaces").select("id, name").eq("name", WORKSPACE).limit(1);
  if (error) throw new Error(`reading workspaces failed: ${error.code}`);
  if (rows?.length) return rows[0].id;
  const made = await db.schema("app").rpc("create_workspace", { p_name: WORKSPACE });
  if (made.error || !made.data) throw new Error(`creating the workspace failed: ${made.error?.code ?? "no id"}`);
  return made.data;
}

test.describe("synthetic user on staging @smoke", () => {
  test.skip(!ready, "staging only, with SYNTHETIC_USER_EMAIL, SYNTHETIC_USER_PASSWORD and the service role (#183)");

  test("signs in, runs one job through the worker to the end, and verify answers @smoke", async ({ page }) => {
    test.setTimeout(JOB_TIMEOUT_MS + 60_000);
    await ensureAccount();
    const db = createClient<Database>(supabaseUrl!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    const signedIn = await db.auth.signInWithPassword({ email: email!, password: password! });
    expect(signedIn.error?.code ?? null, "the synthetic user signs in with its password").toBeNull();
    const ws = await ensureWorkspace(db);

    // Through the web, as a person: the sign-in page lands in a workspace.
    await page.goto(`/sign-in?next=${encodeURIComponent(`/w/${ws}`)}`);
    await page.getByLabel("Work email").fill(email!);
    await page.getByLabel("Password").fill(password!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${ws}`));

    // One job through the queue and the worker: a full export (O03, never gated, sends no email).
    const job = await db.schema("app").rpc("request_export", { p_ws: ws });
    expect(job.error?.code ?? null, "request_export queues a job").toBeNull();
    let status = "queued";
    await expect
      .poll(
        async () => {
          const { data } = await db.schema("app").from("jobs").select("status").eq("id", job.data!).single();
          status = data?.status ?? status;
          return ["succeeded", "failed", "cancelled"].includes(status);
        },
        { timeout: JOB_TIMEOUT_MS, intervals: [2_000, 5_000] },
      )
      .toBe(true);
    expect(status, "the worker finished the export").toBe("succeeded");

    // verify answers: a well-formed reference that cannot exist is exactly "unknown" (as scripts/synthetic/check.py).
    const ref = `synthetic-${randomUUID()}`;
    const res = await fetch(`${supabaseUrl!.replace(/\/$/, "")}/functions/v1/verify/${ref}`, {
      headers: { apikey: anonKey!, Authorization: `Bearer ${anonKey!}`, "x-region": FUNCTION_REGION },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "unknown" });
    await db.auth.signOut();
  });
});
