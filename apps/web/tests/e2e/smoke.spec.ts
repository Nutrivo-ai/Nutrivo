import { expect, test } from "@playwright/test";

test("health endpoint answers ok with a request id @smoke", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ status: "ok" });
  expect(response.headers()["x-request-id"]).toMatch(/^[A-Za-z0-9-]{8,64}$/);
});

test("home page renders without console errors @smoke", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Nutrivo" })).toBeVisible();
  expect(errors).toEqual([]);
});
