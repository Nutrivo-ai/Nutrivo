// T-109 · Business sign-in (D-27): Continue with Google and Continue with Microsoft on /sign-in, and no new account for
// a consumer or free-mail address on any route. The routes run against the local Supabase Auth with the
// before-user-created hook configured (supabase/config.toml). A real Google or Microsoft round-trip needs their consent
// screens and credentials, which CI does not have: the browser is followed to Supabase Auth's /authorize and answered
// there the way Supabase Auth answers, so what is tested is everything on our side of the provider.
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page, type Route } from "@playwright/test";
import { isBusinessEmailRefusal, SIGN_IN_PROBLEM } from "../../src/lib/auth/rules";
import { admin, haveStack } from "./support/people";

const REFUSAL = "business_email_required: Nutrivo accounts use a work email address.";

/** A browser-side client, as anybody on the internet has it: the anon key and nothing else. */
const anon = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const fresh = (domain: string) => `t109-${randomUUID().slice(0, 8)}@${domain}`;

/**
 * Catches the browser at Supabase Auth's /authorize, records where it was sent, and answers with `reply` (a query
 * string Supabase Auth would append to redirect_to after the provider), or with a plain page when `reply` is null.
 */
async function atAuthorize(page: Page, reply: string | null) {
  const seen: URL[] = [];
  await page.route("**/auth/v1/authorize?**", async (route: Route) => {
    const url = new URL(route.request().url());
    seen.push(url);
    if (reply === null) return route.fulfill({ status: 200, contentType: "text/html", body: "<title>provider</title>" });
    const back = new URL(url.searchParams.get("redirect_to")!);
    for (const [k, v] of new URLSearchParams(reply)) back.searchParams.set(k, v);
    return route.fulfill({ status: 302, headers: { location: back.toString() } });
  });
  return seen;
}

test.describe("T-109 the provider buttons on /sign-in", () => {
  test("[T-109] Continue with Google and Continue with Microsoft render beside the work email, and axe finds nothing serious", async ({ page }) => {
    await page.goto("/sign-in");
    const providers = page.getByTestId("auth-providers");
    await expect(providers.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    await expect(providers.getByRole("button", { name: "Continue with Microsoft" })).toBeVisible();
    await expect(page.getByLabel("Work email")).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => v.id)).toEqual([]);
  });

  for (const [name, provider] of [["Google", "google"], ["Microsoft", "azure"]] as const) {
    test(`[T-109] no dead control: Continue with ${name} goes to Supabase Auth for ${provider}, coming back to /auth/callback`, async ({ page }) => {
      const seen = await atAuthorize(page, null);
      await page.goto(`/sign-in?next=${encodeURIComponent("/w/abc/board")}`);
      await page.getByRole("button", { name: `Continue with ${name}` }).click();
      await expect.poll(() => seen.length).toBe(1);
      const url = seen[0];
      expect(url.searchParams.get("provider")).toBe(provider);
      expect(url.searchParams.get("code_challenge_method")).toBe("s256"); // PKCE: the code is useless without this browser
      const back = new URL(url.searchParams.get("redirect_to")!);
      expect(back.pathname).toBe("/auth/callback");
      expect(back.searchParams.get("via")).toBe("oauth");
      expect(back.searchParams.get("next")).toBe("/w/abc/board");
      if (provider === "azure") expect(url.searchParams.get("scopes")).toBe("email");
    });
  }

  test("[T-109] a free-mail address refused after Google returns to /sign-in with the business-email problem, never the provider's words", async ({ page }) => {
    await atAuthorize(page, new URLSearchParams({ error: "server_error", error_code: "unexpected_failure", error_description: REFUSAL }).toString());
    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect(page).toHaveURL(/\/sign-in\?problem=business_email$/);
    await expect(page.getByTestId("auth-sign-in").getByRole("alert")).toHaveText(SIGN_IN_PROBLEM.business_email);
    await expect(page.getByText("business_email_required")).toHaveCount(0);
  });

  test("[T-109] any other provider failure after Microsoft reads as the generic problem, and keeps the page asked for", async ({ page }) => {
    await atAuthorize(page, new URLSearchParams({ error: "access_denied", error_description: "AADSTS50020 personal account" }).toString());
    await page.goto(`/sign-in?next=${encodeURIComponent("/w/abc/board")}`);
    await page.getByRole("button", { name: "Continue with Microsoft" }).click();
    await expect(page).toHaveURL(/\/sign-in\?problem=provider&next=%2Fw%2Fabc%2Fboard$/);
    await expect(page.getByTestId("auth-sign-in").getByRole("alert")).toHaveText(SIGN_IN_PROBLEM.provider);
    await expect(page.getByText("AADSTS50020")).toHaveCount(0);
  });

  test("[T-109] an OAuth code that is not this browser's goes through the existing callback and lands on the expired-link page", async ({ page }) => {
    await page.goto("/auth/callback?code=not-a-real-code&via=oauth&next=%2F");
    await expect(page).toHaveURL(/\/auth\/forgot\?link=expired$/);
  });
});

test.describe("@local-only T-109 no new account on a free-mail address, on every route (D-27)", () => {
  test.skip(!haveStack(), "needs the local Supabase stack (scripts/ci/e2e.sh)");

  test("[T-109] email and password: a free-mail sign-up is refused by the hook, a business one is created", async () => {
    const refused = await anon().auth.signUp({ email: fresh("gmail.com"), password: "a passphrase of four words" });
    expect(refused.error?.status).toBe(403);
    expect(isBusinessEmailRefusal(refused.error)).toBe(true);
    const allowed = await anon().auth.signUp({ email: fresh("haldenpet.example"), password: "a passphrase of four words" });
    expect(allowed.error).toBeNull();
    expect(allowed.data.user?.id).toBeTruthy();
  });

  test("[T-109] sign-in link with shouldCreateUser: a free-mail address is refused", async () => {
    const { error } = await anon().auth.signInWithOtp({ email: fresh("yahoo.co.uk"), options: { shouldCreateUser: true } });
    expect(error?.status).toBe(403);
    expect(isBusinessEmailRefusal(error)).toBe(true);
  });

  test("[T-109] invitation: Supabase Auth refuses to invite a free-mail address", async () => {
    const { error } = await admin().auth.admin.inviteUserByEmail(fresh("outlook.de"));
    expect(error?.status).toBe(403);
    expect(isBusinessEmailRefusal(error)).toBe(true);
  });

  test("[T-109] an existing free-mail account still signs in with its password", async ({ page }) => {
    // Made the way an account from before D-27 exists: the service role's createUser is not a sign-up route.
    const email = fresh("gmail.com");
    const password = "an existing passphrase of five words";
    const made = await admin().auth.admin.createUser({ email, password, email_confirm: true });
    expect(made.error).toBeNull();
    const direct = await anon().auth.signInWithPassword({ email, password });
    expect(direct.error).toBeNull();
    await page.goto("/sign-in");
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).not.toHaveURL(/\/sign-in/);
  });
});
