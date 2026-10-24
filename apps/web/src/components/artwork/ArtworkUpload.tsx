"use client";

import posthog from "posthog-js";
import * as Sentry from "@sentry/nextjs";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type DragEvent } from "react";
import { Button, ErrorState, LoadingState, NoPermissionState, cx } from "@/components/kit";
import { cardStatus, fileLine, unlocks } from "@/lib/artwork/describe";
import { useExtractJob, type JobView } from "@/lib/artwork/progress";
import type { ArtworkSummary } from "@/lib/artwork/queries";
import {
  ACCEPT_ATTR,
  rejectionMessage,
  uploadArtwork,
  type RegisterFailure,
  type UploadStage,
} from "@/lib/artwork/upload";
import { createClient } from "@/lib/supabase/client";

const STAGE_LABEL: Record<UploadStage, string> = {
  checking: "Checking the file",
  hashing: "Fingerprinting the file",
  uploading: "Uploading",
  registering: "Registering the artwork",
};

const TONE: Record<string, string> = {
  clear: "text-clear",
  action: "text-action",
  blocked: "text-blocked",
  neutral: "text-n600",
};

type State =
  | { step: "idle" }
  | { step: "rejected"; message: string }
  | { step: "uploading"; stage: UploadStage; fileName: string }
  | { step: "failed"; failure: RegisterFailure }
  | { step: "extracting"; artworkVersionId: string; fileName: string };

/**
 * S-NV2-002 "1 · What you have": the Artwork card. Empty, it takes a file (drop or choose); then it shows the upload
 * stages, then extraction progress from app.jobs, then the extraction's result with a link to what ran per panel.
 */
export function ArtworkUpload({
  workspaceId,
  productId,
  latest,
}: {
  workspaceId: string;
  productId: string;
  latest: ArtworkSummary | null;
}) {
  const router = useRouter();
  const db = useMemo(() => createClient(), []);
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>(
    latest && !latest.run ? { step: "extracting", artworkVersionId: latest.id, fileName: latest.fileName ?? "" } : { step: "idle" },
  );
  const [dragging, setDragging] = useState(false);
  const job = useExtractJob(db, state.step === "extracting" ? state.artworkVersionId : null);
  const [refreshed, setRefreshed] = useState<string | null>(null);

  if (state.step === "extracting" && job.view.phase === "done" && refreshed !== state.artworkVersionId) {
    setRefreshed(state.artworkVersionId);
    router.refresh();
  }

  async function start(file: File) {
    setState({ step: "uploading", stage: "checking", fileName: file.name });
    const result = await Sentry.startSpan({ name: "artwork.upload", op: "upload" }, () =>
      uploadArtwork(db, { workspaceId, productId, file }, (stage) =>
        setState({ step: "uploading", stage, fileName: file.name }),
      ),
    );
    if (input.current) input.current.value = "";
    if (!result.ok) {
      if (result.stage === "checking") setState({ step: "rejected", message: rejectionMessage(result.rejection) });
      else {
        if (result.failure.code === "unknown") Sentry.captureMessage("artwork upload failed", { tags: { stage: result.stage } });
        setState({ step: "failed", failure: result.failure });
      }
      return;
    }
    if (posthog.__loaded) posthog.capture("artwork_uploaded", { artwork_version_id: result.artworkVersionId, kind: result.kind });
    setState({ step: "extracting", artworkVersionId: result.artworkVersionId, fileName: file.name });
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file && !busy) void start(file);
  }

  const done = state.step === "extracting" && job.view.phase === "done";
  const busy =
    state.step === "uploading" || (state.step === "extracting" && job.view.phase !== "done" && job.view.phase !== "failed");
  const showLatest = latest?.run && (state.step === "idle" || done);
  const choose = () => input.current?.click();

  return (
    <div className="flex flex-col gap-[10px]" data-artwork-upload>
      {showLatest ? <ArtworkCard art={latest} workspaceId={workspaceId} productId={productId} /> : null}

      {state.step === "extracting" && !done ? (
        <ExtractionProgress view={job.view} error={job.error} fileName={state.fileName} />
      ) : null}

      {state.step === "uploading" ? (
        <LoadingState label={`${STAGE_LABEL[state.stage]} · ${state.fileName}`}>
          Nothing is counted until the artwork is registered. Leaving this screen before then stops the upload.
        </LoadingState>
      ) : null}

      {state.step === "rejected" ? (
        <ErrorState
          where="ARTWORK · NOT UPLOADED"
          title="This file was not uploaded"
          body={state.message}
          action={{ label: "Choose another file", onClick: choose, variant: "primary" }}
        />
      ) : null}

      {state.step === "failed" ? (
        state.failure.code === "42501" ? (
          <NoPermissionState where="ARTWORK" title={state.failure.title} body={state.failure.body} aside="An admin can change your role." />
        ) : (
          <ErrorState
            where={`ARTWORK · ${state.failure.code}`}
            title={state.failure.title}
            body={state.failure.body}
            action={
              state.failure.code === "P0032"
                ? { label: "See plans", href: `/w/${workspaceId}/billing/plans`, variant: "primary" }
                : state.failure.code === "P0036"
                  ? { label: "Open billing", href: `/w/${workspaceId}/settings/billing`, variant: "primary" }
                  : { label: "Try again", onClick: choose, variant: "primary" }
            }
          />
        )
      ) : null}

      {!busy ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          data-dropzone
          className={cx(
            "border border-dashed py-[13px] px-[14px]",
            dragging ? "border-accent bg-accent-100" : "border-n400 bg-paper",
          )}
        >
          <div className="flex items-baseline gap-[10px]">
            <span className="flex-1 font-medium">{latest ? "Replace the artwork" : "Artwork"}</span>
            {latest ? null : (
              <span className="font-mono text-[10px] tracking-[0.08em] uppercase text-n600">Not uploaded</span>
            )}
          </div>
          <p className="mt-[5px] mb-0 font-mono text-[11px] text-n600">PDF, PNG or JPEG · up to 50 MB</p>
          <p className="mt-[6px] mb-0 text-[12.5px] leading-[1.45] text-n700">
            {latest
              ? "A new file becomes the next version. Replacing the file costs nothing, and re-checks are unlimited."
              : "Drop the print PDF here, or choose it. Every printed language panel is read from the file itself."}
          </p>
          <div className="mt-[10px]">
            <Button variant={latest || state.step === "rejected" || state.step === "failed" ? "secondary" : "primary"} onClick={choose}>
              {latest ? "Upload a new version" : "Choose a file"}
            </Button>
          </div>
          <input
            ref={input}
            type="file"
            accept={ACCEPT_ATTR}
            className="sr-only"
            tabIndex={-1}
            aria-label="Artwork file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void start(file);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

export function ArtworkCard({ art, workspaceId, productId }: { art: ArtworkSummary; workspaceId: string; productId: string }) {
  const status = cardStatus(art.run);
  return (
    <div className="border border-solid border-rule py-[13px] px-[14px]" data-artwork-card={art.run?.status ?? "reading"}>
      <div className="flex items-baseline gap-[10px]">
        <span className="flex-1 font-medium">Artwork</span>
        <span className={cx("font-mono text-[10px] tracking-[0.08em] uppercase", TONE[status.tone])}>{status.label}</span>
      </div>
      <p className="mt-[5px] mb-0 font-mono text-[11px] text-n600 break-all">{fileLine(art)}</p>
      <p className="mt-[6px] mb-0 text-[12.5px] leading-[1.45] text-n700">{unlocks(art)}</p>
      {art.run ? (
        <p className="mt-[8px] mb-0 font-mono text-[10.5px]">
          <a href={`/w/${workspaceId}/products/${productId}/artwork/${art.id}`} className="kit-transition">
            What ran, per panel →
          </a>
        </p>
      ) : null}
    </div>
  );
}

function ExtractionProgress({ view, error, fileName }: { view: JobView; error: boolean; fileName: string }) {
  if (view.phase === "failed") {
    return <ErrorState where="ARTWORK · EXTRACTION" title="This artwork could not be read" body={view.reason} />;
  }
  const label =
    view.phase === "running"
      ? view.label
      : view.phase === "queued" && view.retrying
        ? "Waiting to try again"
        : "Queued for extraction";
  return (
    <LoadingState label={`${label} · ${fileName}`}>
      {error
        ? "Progress cannot be read just now; extraction carries on, and this card updates when it can."
        : "Leaving this screen does not stop it. Panels and languages appear here when it finishes."}
    </LoadingState>
  );
}
