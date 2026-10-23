// The shell's reads (T-102, N02): what the layout decides from the person's session and memberships. The database
// side (RLS) is exercised end to end in tests/e2e/shell.spec.ts; here the client is a stand-in that records queries.
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/database.types";
import { loadShellContext, ShellReadError } from "./memberships";

type Result = { data: unknown; error: { message: string; code?: string } | null };

const WS_A = "0a000000-0000-4000-8000-000000000001";
const WS_B = "0b000000-0000-4000-8000-000000000002";

function fakeClient({ user, person, memberships }: { user: { id: string } | null; person: Result; memberships: Result }) {
  const filters: string[] = [];
  const query = (table: string, result: Result) => {
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => (filters.push(`${table}.${column}=${value}`), chain),
      is: (column: string, value: unknown) => (filters.push(`${table}.${column} is ${value}`), chain),
      maybeSingle: () => Promise.resolve(result),
      then: (resolve: (r: Result) => unknown) => Promise.resolve(result).then(resolve),
    };
    return chain;
  };
  const client = {
    auth: { getUser: () => Promise.resolve({ data: { user }, error: user ? null : { message: "no session" } }) },
    schema: () => ({ from: (table: string) => query(table, table === "people" ? person : memberships) }),
  };
  return { client: client as unknown as SupabaseClient<Database>, filters };
}

const row = (id: string, name: string, role = "admin") => ({
  workspace_id: id,
  role,
  workspaces: { name, entitled_regions: ["EU"] },
});

describe("loadShellContext", () => {
  const person = { data: { id: "p1", display_name: "Ann" }, error: null };

  it("is signed out without a session", async () => {
    const { client } = fakeClient({ user: null, person, memberships: { data: [], error: null } });
    expect(await loadShellContext(client, WS_A)).toEqual({ kind: "signed-out" });
  });

  it("[N02.main] puts the person in the workspace of the route, with every active membership, sorted", async () => {
    const memberships = { data: [row(WS_B, "Southfield"), row(WS_A, "Northwind", "viewer")], error: null };
    const { client, filters } = fakeClient({ user: { id: "u1" }, person, memberships });
    const context = await loadShellContext(client, WS_B);
    expect(context.kind).toBe("member");
    if (context.kind !== "member") return;
    expect(context.current.workspaceId).toBe(WS_B);
    expect(context.memberships.map((m) => m.name)).toEqual(["Northwind", "Southfield"]);
    expect(context.memberships[0].role).toBe("viewer");
    // Only the person's own, live memberships are asked for.
    expect(filters).toEqual(["people.user_id=u1", "people.tombstoned_at is null", "memberships.person_id=p1", "memberships.ended_at is null"]);
  });

  it("[N02.must.1] a workspace the reads do not return is no access, whether it exists or not", async () => {
    const memberships = { data: [row(WS_A, "Northwind")], error: null };
    const { client } = fakeClient({ user: { id: "u1" }, person, memberships });
    for (const other of [WS_B, "not-a-uuid", ""]) {
      const context = await loadShellContext(client, other);
      expect(context.kind).toBe("no-access");
    }
  });

  it("a signed-in account with no person has no memberships", async () => {
    const { client } = fakeClient({ user: { id: "u1" }, person: { data: null, error: null }, memberships: { data: [], error: null } });
    expect(await loadShellContext(client, WS_A)).toMatchObject({ kind: "no-access", memberships: [] });
  });

  it("skips rows with an unknown role or no readable workspace", async () => {
    const memberships = { data: [row(WS_A, "Northwind", "owner"), { workspace_id: WS_B, role: "admin", workspaces: null }], error: null };
    const { client } = fakeClient({ user: { id: "u1" }, person, memberships });
    expect(await loadShellContext(client, WS_A)).toMatchObject({ kind: "no-access", memberships: [] });
  });

  it("throws when a read fails, so the route shows its error state", async () => {
    const failing = { data: null, error: { message: "boom", code: "500" } };
    const a = fakeClient({ user: { id: "u1" }, person: failing, memberships: { data: [], error: null } });
    await expect(loadShellContext(a.client, WS_A)).rejects.toBeInstanceOf(ShellReadError);
    const b = fakeClient({ user: { id: "u1" }, person, memberships: failing });
    await expect(loadShellContext(b.client, WS_A)).rejects.toThrow("could not read memberships");
  });
});
