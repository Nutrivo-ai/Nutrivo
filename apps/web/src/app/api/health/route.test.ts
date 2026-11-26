import { beforeEach, describe, expect, it, vi } from "vitest";

const connection = vi.fn(async () => {});
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection }));

const { GET } = await import("./route");

describe("GET /api/health", () => {
  beforeEach(() => connection.mockClear());

  it("answers ok", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok" });
  });

  it("renders per request, never prerendered (issue 348: the load test's web_floor must reach the function)", async () => {
    await GET();
    expect(connection).toHaveBeenCalledOnce();
  });
});
