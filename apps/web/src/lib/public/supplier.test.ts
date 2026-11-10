import { describe, expect, it, vi } from "vitest";
import { checkFile, describeRequest, MAX_BYTES, parseOpen, uploadDocument } from "./supplier";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

const TOKEN = "A".repeat(43);
const URL_ = "http://db.local/functions/v1/supplier-upload";
const OPEN = {
  status: "open",
  workspace_name: "Kruuse Pet Nutrition",
  supplier_name: "Aldrich Nutrition",
  title: "Premix specification",
  expires_at: "2026-11-24T09:00:00+00:00",
};
const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
const who = { requestId: "req-1", visitor: "198.51.100.7" };

describe("supplier portal (H03)", () => {
  it("[H03.main] describes the one request through the function, with the token in the POST body only", async () => {
    const fetchFn = reply(200, OPEN);
    const out = await describeRequest(TOKEN, who, { url: URL_, anonKey: "anon", fetchFn });
    expect(out).toEqual({
      kind: "open",
      request: { workspaceName: "Kruuse Pet Nutrition", supplierName: "Aldrich Nutrition", title: "Premix specification", expiresAt: OPEN.expires_at },
    });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL_);
    expect(url).not.toContain(TOKEN);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ token: TOKEN });
  });

  it("[H03.fail.1] a malformed link never reaches the function, and an unavailable one reads the same", async () => {
    const fetchFn = reply(404, { error: "link_unavailable" });
    expect(await describeRequest("short", who, { url: URL_, anonKey: "anon", fetchFn })).toEqual({ kind: "unavailable" });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(await describeRequest(TOKEN, who, { url: URL_, anonKey: "anon", fetchFn })).toEqual({ kind: "unavailable" });
    expect(await uploadDocument(TOKEN, new File(["%PDF-1.7"], "a.pdf", { type: "application/pdf" }), { url: URL_, anonKey: "anon", fetchFn }))
      .toEqual({ kind: "unavailable" });
  });

  it("[H03.main] a function that cannot answer is an error, never an open request", async () => {
    expect(await describeRequest(TOKEN, who, { url: URL_, anonKey: "anon", fetchFn: reply(503, {}) })).toEqual({ kind: "error" });
    expect(await describeRequest(TOKEN, who, { url: URL_, anonKey: "anon", fetchFn: reply(200, { status: "open" }) })).toEqual({ kind: "error" });
    expect(parseOpen({ ...OPEN, workspace_id: "leak" })).not.toHaveProperty("workspace_id");
  });

  it("[H03.must.1] uploads as multipart with the token in the form, and refuses what the function would refuse", async () => {
    const fetchFn = reply(200, { status: "received" });
    const pdf = new File(["%PDF-1.7"], "spec.pdf", { type: "application/pdf" });
    expect(await uploadDocument(TOKEN, pdf, { url: URL_, anonKey: "anon", fetchFn })).toEqual({ kind: "received" });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain(TOKEN);
    const form = init.body as FormData;
    expect(form.get("token")).toBe(TOKEN);
    expect((form.get("file") as File).name).toBe("spec.pdf");
    expect(checkFile({ name: "x.exe", size: 10, type: "application/x-msdownload" })).toBe("unsupported_type");
    expect(checkFile({ name: "x.pdf", size: 10, type: "application/msword" })).toBe("unsupported_type");
    expect(checkFile({ name: "x.pdf", size: MAX_BYTES + 1, type: "application/pdf" })).toBe("too_large");
    expect(checkFile({ name: "x.xlsx", size: 10, type: "" })).toBeNull();
    expect(await uploadDocument(TOKEN, new File([""], "x.pdf", { type: "application/pdf" }), { url: URL_, anonKey: "anon", fetchFn: reply(200, {}) }))
      .toEqual({ kind: "refused", reason: "no_file" });
    expect(await uploadDocument(TOKEN, pdf, { url: URL_, anonKey: "anon", fetchFn: reply(415, {}) })).toEqual({ kind: "refused", reason: "unsupported_type" });
  });
});
