// The guard that keeps test setup off hosted databases (#343): only this machine's database passes.
import { expect, test } from "@playwright/test";
import { isLocalDatabase } from "./support/sql";

test.describe("isLocalDatabase", () => {
  test("accepts the local stack", () => {
    expect(isLocalDatabase("postgresql://postgres:postgres@127.0.0.1:54322/postgres")).toBe(true);
    expect(isLocalDatabase("postgres://u:p@localhost/db")).toBe(true);
  });
  test("refuses a hosted database, however the URL is written", () => {
    for (const url of [
      "postgresql://postgres.abc:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
      "postgresql://u:p@db.example.com/x?x=@localhost/",
      "postgresql://u:p@localhost/db?host=db.example.com",
      "postgresql://u:p@127.0.0.1/db?hostaddr=10.0.0.5",
      "postgresql://u:p%40localhost@db.example.com/db",
      "https://localhost/db",
      "not a url",
    ]) expect(isLocalDatabase(url), url).toBe(false);
  });
});
