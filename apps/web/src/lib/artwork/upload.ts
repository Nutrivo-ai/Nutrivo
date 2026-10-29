import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { REQUEST_ID_HEADER } from "@/lib/observability/request-id";

// D01 + C02 (T-303): an artwork reaches the product as
//   1. a type and size check in the browser, before any byte leaves it (C02.fail.1);
//   2. its SHA-256, computed in the browser;
//   3. a signed upload to artwork/<workspace>/<product>/<sha256>.<ext> under the person's own session, so the Storage
//      insert policy (editor and above in that workspace) decides;
//   4. app.register_artwork through the RPC only: idempotent per file hash, allowance and dunning checked there, and
//      the 'extract' job enqueued in the same transaction. The upload's request_id goes with it as x-request-id
//      (docs/17); private.enqueue does not copy it into the job payload yet (a db follow-up on #41).

/** supabase/config.toml [storage] file_size_limit: the bucket refuses anything larger, so the browser does first. */
export const MAX_ARTWORK_BYTES = 50 * 1024 * 1024;

export type ArtworkKind = "pdf" | "png" | "jpeg";

export const ACCEPTED: Record<ArtworkKind, { mime: string; ext: string; label: string }> = {
  pdf: { mime: "application/pdf", ext: "pdf", label: "PDF" },
  png: { mime: "image/png", ext: "png", label: "PNG" },
  jpeg: { mime: "image/jpeg", ext: "jpg", label: "JPEG" },
};

/** The file input's accept attribute: a hint only; checkFile decides. */
export const ACCEPT_ATTR = [...Object.values(ACCEPTED).map((a) => a.mime), ".pdf", ".png", ".jpg", ".jpeg"].join(",");

export type FileRejection =
  | { reason: "empty" }
  | { reason: "too_large"; bytes: number }
  | { reason: "unsupported_type"; declared: string };

export type FileCheck = { ok: true; kind: ArtworkKind } | ({ ok: false } & FileRejection);

/** What the bytes are, by their magic numbers: %PDF-, the PNG signature, or a JPEG SOI marker. */
export function sniff(head: Uint8Array): ArtworkKind | null {
  const starts = (sig: number[]) => sig.every((b, i) => head[i] === b);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf";
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (starts([0xff, 0xd8, 0xff])) return "jpeg";
  return null;
}

/**
 * C02.fail.1: an unsupported file is rejected before upload. The declared MIME type is a claim the browser makes from
 * the name; the bytes decide, and the two must agree where a type is declared.
 */
export async function checkFile(file: Pick<File, "size" | "type" | "slice">): Promise<FileCheck> {
  if (file.size === 0) return { ok: false, reason: "empty" };
  if (file.size > MAX_ARTWORK_BYTES) return { ok: false, reason: "too_large", bytes: file.size };
  const kind = sniff(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  const declared = file.type || "";
  if (!kind || (declared && declared !== ACCEPTED[kind].mime)) return { ok: false, reason: "unsupported_type", declared };
  return { ok: true, kind };
}

function toRejection(check: Extract<FileCheck, { ok: false }>): FileRejection {
  if (check.reason === "too_large") return { reason: "too_large", bytes: check.bytes };
  if (check.reason === "unsupported_type") return { reason: "unsupported_type", declared: check.declared };
  return { reason: "empty" };
}

export function rejectionMessage(r: FileRejection): string {
  switch (r.reason) {
    case "empty":
      return "This file is empty. Choose the print PDF of the label.";
    case "too_large":
      return `This file is ${(r.bytes / 1024 / 1024).toFixed(1)} MB. Artwork files can be up to ${MAX_ARTWORK_BYTES / 1024 / 1024} MB.`;
    case "unsupported_type":
      return "This is not a PDF, PNG or JPEG file. Upload the print PDF of the label, or a PNG or JPEG image of it.";
  }
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** docs/04: artwork/<workspace_id>/<product_id>/<sha256>.pdf (the image types keep their own extension). */
export function storagePath(workspaceId: string, productId: string, sha256: string, kind: ArtworkKind): string {
  return `${workspaceId}/${productId}/${sha256}.${ACCEPTED[kind].ext}`;
}

export type RegisterFailure = { code: string; title: string; body: string };

/** The database's P-codes for register_artwork (docs/03) as what the person sees. */
export function registerFailure(code: string | undefined): RegisterFailure {
  switch (code) {
    case "P0032":
      return {
        code,
        title: "All free label artworks are used",
        body: "This workspace has used its three free label artworks. Everything already checked stays readable, and re-checks stay free. A plan adds new artworks.",
      };
    case "P0036":
      return {
        code,
        title: "New artworks are paused until payment is resolved",
        body: "Everything else keeps working: reports, re-checks and verification. An admin can resolve the payment in billing.",
      };
    case "42501":
      return {
        code,
        title: "Your role cannot add artwork to this product",
        body: "Adding artwork needs an editor or a role above it. An admin of this workspace can change your role.",
      };
    default:
      return {
        code: code ?? "unknown",
        title: "The artwork was not registered",
        body: "The file did not reach the product. Nothing was counted against your allowance. Try the upload again.",
      };
  }
}

export type UploadStage = "checking" | "hashing" | "uploading" | "registering";

export type UploadResult =
  | { ok: true; artworkVersionId: string; sha256: string; kind: ArtworkKind }
  | { ok: false; stage: "checking"; rejection: FileRejection }
  | { ok: false; stage: "uploading" | "registering"; failure: RegisterFailure };

type Db = SupabaseClient<Database>;

/** Storage answers 409/"Duplicate" when the same content-addressed object is already there: the same bytes. */
function alreadyStored(error: { message?: string; statusCode?: string | number } | null) {
  if (!error) return false;
  return String(error.statusCode ?? "") === "409" || /already exists|duplicate/i.test(error.message ?? "");
}

export async function uploadArtwork(
  db: Db,
  args: { workspaceId: string; productId: string; file: File; requestId?: string },
  onStage: (stage: UploadStage) => void = () => {},
): Promise<UploadResult> {
  onStage("checking");
  const check = await checkFile(args.file);
  if (!check.ok) return { ok: false, stage: "checking", rejection: toRejection(check) };
  onStage("hashing");
  const bytes = await args.file.arrayBuffer();
  const sha256 = await sha256Hex(bytes);
  const path = storagePath(args.workspaceId, args.productId, sha256, check.kind);
  const mime = ACCEPTED[check.kind].mime;

  onStage("uploading");
  const bucket = db.storage.from("artwork");
  const signed = await bucket.createSignedUploadUrl(path);
  if (signed.error && !alreadyStored(signed.error as never)) {
    const denied = /row-level security|unauthori[sz]ed|403/i.test(signed.error.message);
    return { ok: false, stage: "uploading", failure: registerFailure(denied ? "42501" : undefined) };
  }
  if (signed.data) {
    const put = await bucket.uploadToSignedUrl(path, signed.data.token, new Blob([bytes], { type: mime }), {
      contentType: mime,
    });
    if (put.error && !alreadyStored(put.error as never)) {
      return { ok: false, stage: "uploading", failure: registerFailure(undefined) };
    }
  }

  onStage("registering");
  const register = db.schema("app").rpc("register_artwork", {
    p_product: args.productId,
    p_storage_path: path,
    p_sha256: sha256,
    p_file_name: args.file.name,
    p_mime: mime,
  });
  const { data, error } = await (args.requestId ? register.setHeader(REQUEST_ID_HEADER, args.requestId) : register);
  if (error || !data) return { ok: false, stage: "registering", failure: registerFailure(error?.code) };
  return { ok: true, artworkVersionId: data, sha256, kind: check.kind };
}
