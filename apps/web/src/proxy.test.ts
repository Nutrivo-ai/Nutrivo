import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proxy } from "./proxy";

describe("proxy request_id", () => {
  it("creates a request id when none arrives", async () => {
    const response = await proxy(new NextRequest("http://localhost/"));
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("keeps a well-formed upstream request id", async () => {
    const response = await proxy(new NextRequest("http://localhost/", { headers: { "x-request-id": "abc12345-req" } }));
    expect(response.headers.get("x-request-id")).toBe("abc12345-req");
  });

  it("replaces a malformed upstream request id", async () => {
    const response = await proxy(new NextRequest("http://localhost/", { headers: { "x-request-id": "bad id <script>" } }));
    expect(response.headers.get("x-request-id")).not.toContain("script");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});

// With no session cookie Supabase Auth is never called, so these run without a stack.
describe("proxy sign-in (T-103)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("[A02.main] sends a visitor without a session from a workspace route to /sign-in, and back afterwards", async () => {
    const response = await proxy(new NextRequest("http://localhost/w/abc/board?tab=1"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/sign-in?next=%2Fw%2Fabc%2Fboard%3Ftab%3D1");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("lets a visitor without a session reach the sign-in and recovery pages", async () => {
    for (const path of ["/sign-in", "/auth/forgot", "/auth/callback?code=x", "/"]) {
      const response = await proxy(new NextRequest(`http://localhost${path}`));
      expect(response.headers.get("location"), path).toBeNull();
    }
  });
});
