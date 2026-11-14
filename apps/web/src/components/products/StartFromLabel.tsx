"use client";

import * as Sentry from "@sentry/nextjs";
import posthog from "posthog-js";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type DragEvent } from "react";
import { Button, ErrorState, LoadingState, cx } from "@/components/kit";
import { ACCEPT_ATTR, checkFile, rejectionMessage, uploadArtwork, type UploadStage } from "@/lib/artwork/upload";
import { resolveRequestId, REQUEST_ID_HEADER } from "@/lib/observability/request-id";
import { productRefusal, provisionalName, type Refusal } from "@/lib/products/rules";
import { createClient } from "@/lib/supabase/client";

type State =
  | { step: "idle" }
  | { step: "rejected"; message: string }
  | { step: "working"; label: string }
  | { step: "refused"; refusal: Refusal }
  | { step: "upload_failed"; productId: string; title: string; body: string };

const STAGE_LABEL: Record<UploadStage, string> = {
  checking: "Checking the file",
  hashing: "Fingerprinting the file",
  uploading: "Uploading",
  registering: "Registering the artwork",
};

/**
 * C02: a product created from an artwork. The file is checked in the browser first, so an unsupported file is refused
 * before anything is created or uploaded (C02.fail.1). Then app.create_product_from_artwork makes the product with a
 * provisional name (it refuses first what the artwork would be refused for: P0036, P0032), and the artwork follows
 * the T-303 path: signed upload, app.register_artwork, extraction, on the product's Upload & scope screen.
 */
export function StartFromLabel({ workspaceId, familyId }: { workspaceId: string; familyId: string | null }) {
  const router = useRouter();
  const db = useMemo(() => createClient(), []);
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ step: "idle" });
  const [dragging, setDragging] = useState(false);
  const busy = state.step === "working";

  async function start(file: File) {
    setState({ step: "working", label: "Checking the file" });
    const check = await checkFile(file);
    if (input.current) input.current.value = "";
    if (!check.ok) {
      setState({ step: "rejected", message: rejectionMessage(check.reason === "too_large" ? { reason: "too_large", bytes: check.bytes } : check.reason === "unsupported_type" ? { reason: "unsupported_type", declared: check.declared } : { reason: "empty" }) });
      return;
    }
    const requestId = resolveRequestId(null);
    setState({ step: "working", label: `Creating ${provisionalName(file.name)}` });
    const created = await db
      .schema("app")
      .rpc("create_product_from_artwork", { p_ws: workspaceId, p_file_name: file.name, p_family: familyId ?? undefined })
      .setHeader(REQUEST_ID_HEADER, requestId);
    if (created.error || !created.data) {
      if (!["P0032", "P0034", "P0036", "42501", "P0049"].includes(created.error?.code ?? "")) {
        Sentry.captureMessage("create_product_from_artwork failed", { tags: { error_code: created.error?.code ?? "none", request_id: requestId } });
      }
      setState({ step: "refused", refusal: productRefusal(created.error?.code, workspaceId, created.error?.hint) });
      return;
    }
    const productId = created.data;
    const result = await Sentry.startSpan({ name: "artwork.upload", op: "upload", attributes: { request_id: requestId } }, () =>
      uploadArtwork(db, { workspaceId, productId, file, requestId }, (stage) => setState({ step: "working", label: `${STAGE_LABEL[stage]} · ${file.name}` })),
    );
    if (!result.ok) {
      const failure = result.stage === "checking" ? { title: "The artwork was not uploaded", body: rejectionMessage(result.rejection) } : result.failure;
      setState({ step: "upload_failed", productId, title: failure.title, body: failure.body });
      return;
    }
    if (posthog.__loaded) posthog.capture("product_created_from_artwork", { product_id: productId, artwork_version_id: result.artworkVersionId });
    router.push(`/w/${workspaceId}/products/${productId}/check`);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file && !busy) void start(file);
  }

  return (
    <section aria-labelledby="start-from-label" className="flex flex-col gap-[10px]" data-start-from-label>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cx("border border-dashed py-[16px] px-[18px] bg-paper", dragging ? "border-accent" : "border-n400")}
      >
        <p className="m-0 font-mono text-[10px] tracking-[0.13em] uppercase text-n600">Or start from the label</p>
        <h2 id="start-from-label" className="mt-[8px] mb-[6px] font-head text-[15px] font-semibold">Drop the label file here</h2>
        <p className="m-0 text-[12.5px] leading-[1.5] text-n700">
          A PDF, PNG or JPEG of the printed label. The product is created with the file&apos;s name, which you can change,
          {familyId ? " in the family picked on the left," : ""} and the artwork goes straight to its check.
        </p>
        <input ref={input} type="file" accept={ACCEPT_ATTR} className="sr-only" tabIndex={-1} aria-label="Label file" onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void start(file);
        }} />
        <Button className="mt-[12px]" onClick={() => input.current?.click()} disabled={busy}>
          Choose a file
        </Button>
      </div>
      {state.step === "working" ? <LoadingState label={state.label}>Nothing is counted until the artwork is registered.</LoadingState> : null}
      {state.step === "rejected" ? <ErrorState where="LABEL FILE · NOT UPLOADED" title="This file cannot be checked" body={state.message} /> : null}
      {state.step === "refused" ? (
        <ErrorState
          where={`NOT CREATED · ${state.refusal.code}`}
          title={state.refusal.title}
          body={state.refusal.body}
          action={state.refusal.offer ? { label: state.refusal.offer.label, href: state.refusal.offer.href, variant: "primary" } : undefined}
        />
      ) : null}
      {state.step === "upload_failed" ? (
        <ErrorState
          where="PRODUCT CREATED · ARTWORK NOT UPLOADED"
          title={state.title}
          body={`${state.body} The product was created; add the file again from its Upload & scope screen.`}
          action={{ label: "Open the product", href: `/w/${workspaceId}/products/${state.productId}/check`, variant: "primary" }}
        />
      ) : null}
    </section>
  );
}
