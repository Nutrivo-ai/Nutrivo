import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

describe("proxy request_id", () => {
  it("creates a request id when none arrives", () => {
    const response = proxy(new NextRequest("http://localhost/"));
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("keeps a well-formed upstream request id", () => {
    const response = proxy(new NextRequest("http://localhost/", { headers: { "x-request-id": "abc12345-req" } }));
    expect(response.headers.get("x-request-id")).toBe("abc12345-req");
  });

  it("replaces a malformed upstream request id", () => {
    const response = proxy(new NextRequest("http://localhost/", { headers: { "x-request-id": "bad id <script>" } }));
    expect(response.headers.get("x-request-id")).not.toContain("script");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});
