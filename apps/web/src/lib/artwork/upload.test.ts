import { describe, expect, it, vi } from "vitest";
import {
  MAX_ARTWORK_BYTES,
  checkFile,
  registerFailure,
  rejectionMessage,
  sha256Hex,
  sniff,
  storagePath,
  uploadArtwork,
} from "./upload";

const PDF = new TextEncoder().encode("%PDF-1.7\n%\xe2\xe3\n1 0 obj\n");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const WS = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "22222222-2222-4222-8222-222222222222";

const file = (bytes: Uint8Array, name: string, type: string) => new File([bytes as Uint8Array<ArrayBuffer>], name, { type });

/** A Supabase client stand-in that records every call; nothing in a rejected upload may reach it. */
function fakeDb(rpc: { data: string | null; error: { code: string; message: string } | null } = { data: "av-1", error: null }) {
  const calls: string[] = [];
  const bucket = {
    createSignedUploadUrl: vi.fn(async (path: string) => (calls.push(`sign ${path}`), { data: { token: "t", path }, error: null })),
    uploadToSignedUrl: vi.fn(async (path: string) => (calls.push(`put ${path}`), { data: { path }, error: null })),
  };
  const db = {
    storage: { from: (b: string) => (calls.push(`bucket ${b}`), bucket) },
    schema: () => ({
      rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => (calls.push(`rpc ${fn} ${JSON.stringify(args)}`), rpc)),
    }),
  };
  return { db: db as never, calls };
}

describe("checking a file before upload", () => {
  it("[C02.fail.1] An unsupported file type is rejected before upload.", async () => {
    for (const bad of [
      file(new TextEncoder().encode("GIF89a"), "label.gif", "image/gif"),
      file(new TextEncoder().encode("PK\x03\x04"), "label.ai.zip", "application/zip"),
      file(new TextEncoder().encode("hello"), "label.pdf", "application/pdf"), // named .pdf, but not a PDF
      file(PNG, "label.pdf", "application/pdf"), // a PNG claiming to be a PDF
    ]) {
      const { db, calls } = fakeDb();
      const result = await uploadArtwork(db, { workspaceId: WS, productId: PRODUCT, file: bad });
      expect(result).toMatchObject({ ok: false, stage: "checking", rejection: { reason: "unsupported_type" } });
      expect(calls).toEqual([]); // no signed URL, no upload, no RPC
    }
  });

  it("accepts PDF, PNG and JPEG by their bytes", async () => {
    expect(await checkFile(file(PDF, "a.pdf", "application/pdf"))).toEqual({ ok: true, kind: "pdf" });
    expect(await checkFile(file(PNG, "a.png", "image/png"))).toEqual({ ok: true, kind: "png" });
    expect(await checkFile(file(JPEG, "a.jpg", "image/jpeg"))).toEqual({ ok: true, kind: "jpeg" });
    expect(await checkFile(file(PDF, "a", ""))).toEqual({ ok: true, kind: "pdf" }); // no declared type: the bytes decide
    expect(sniff(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("rejects empty and oversized files before reading them", async () => {
    expect(await checkFile(file(new Uint8Array(), "a.pdf", "application/pdf"))).toEqual({ ok: false, reason: "empty" });
    const big = { size: MAX_ARTWORK_BYTES + 1, type: "application/pdf", slice: () => new Blob([PDF as Uint8Array<ArrayBuffer>]) };
    expect(await checkFile(big)).toEqual({ ok: false, reason: "too_large", bytes: MAX_ARTWORK_BYTES + 1 });
    expect(rejectionMessage({ reason: "too_large", bytes: 60 * 1024 * 1024 })).toContain("60.0 MB");
  });
});

describe("uploading and registering", () => {
  it("hashes in the browser, uploads to artwork/<ws>/<product>/<sha256>.pdf, then registers through the RPC", async () => {
    const { db, calls } = fakeDb();
    const result = await uploadArtwork(db, { workspaceId: WS, productId: PRODUCT, file: file(PDF, "Label v7.pdf", "application/pdf") });
    const sha = await sha256Hex(PDF.buffer as ArrayBuffer);
    expect(result).toEqual({ ok: true, artworkVersionId: "av-1", sha256: sha, kind: "pdf" });
    const path = `${WS}/${PRODUCT}/${sha}.pdf`;
    expect(calls).toEqual([
      "bucket artwork",
      `sign ${path}`,
      `put ${path}`,
      `rpc register_artwork ${JSON.stringify({ p_product: PRODUCT, p_storage_path: path, p_sha256: sha, p_file_name: "Label v7.pdf", p_mime: "application/pdf" })}`,
    ]);
  });

  it("an image keeps its own extension", () => {
    expect(storagePath(WS, PRODUCT, "ab", "jpeg")).toBe(`${WS}/${PRODUCT}/ab.jpg`);
    expect(storagePath(WS, PRODUCT, "ab", "pdf")).toBe(`${WS}/${PRODUCT}/ab.pdf`);
  });

  it("the same bytes already in storage are not an error: the path is content-addressed", async () => {
    const { db } = fakeDb();
    const bucket = (db as unknown as { storage: { from: (b: string) => Record<string, ReturnType<typeof vi.fn>> } }).storage.from("artwork");
    bucket.createSignedUploadUrl.mockResolvedValueOnce({ data: null, error: { message: "The resource already exists", statusCode: "409" } });
    const result = await uploadArtwork(db, { workspaceId: WS, productId: PRODUCT, file: file(PDF, "a.pdf", "application/pdf") });
    expect(result.ok).toBe(true);
    expect(bucket.uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it.each([
    ["P0032", "All free label artworks are used"],
    ["P0036", "New artworks are paused until payment is resolved"],
    ["42501", "Your role cannot add artwork to this product"],
  ])("a refusal %s from register_artwork is shown as itself", async (code, title) => {
    const { db } = fakeDb({ data: null, error: { code, message: "refused" } });
    const result = await uploadArtwork(db, { workspaceId: WS, productId: PRODUCT, file: file(PDF, "a.pdf", "application/pdf") });
    expect(result).toMatchObject({ ok: false, stage: "registering", failure: { code, title } });
    expect(registerFailure(code).body).not.toMatch(/P00|42501/);
  });
});
