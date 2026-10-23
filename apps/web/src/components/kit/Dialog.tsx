"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "./Button";

/**
 * A modal dialog on the native <dialog> element (focus moves in and is restored on close; Escape closes). No design
 * file draws one, so it is built from the Cobalt §5 primitives only: a 3px-radius panel with a 1px --rule border, a
 * --panel header, and the one shadow the specification allows (ink at 8%). One primary action and a way out, never
 * three; never used for an upsell (Plans and Checkout) or over a Blocked or Not assessed result.
 */
export function Dialog({
  open,
  onClose,
  title,
  kicker,
  children,
  confirmLabel,
  onConfirm,
  cancelLabel = "Cancel",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** A mono line above the title, e.g. the object the dialog acts on. */
  kicker?: string;
  children: ReactNode;
  /** The one action. Without it the dialog only informs, and the way out reads "Close". */
  confirmLabel?: string;
  onConfirm?: () => void;
  cancelLabel?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="kit-dialog p-0 w-[min(520px,calc(100vw-32px))] border border-rule rounded-control bg-paper text-ink shadow-modal"
    >
      <header className="py-[12px] px-[18px] bg-panel border-b border-rule">
        {kicker ? (
          <p className="m-0 font-mono text-[10px] tracking-[0.1em] uppercase text-n600">{kicker}</p>
        ) : null}
        <h2 id={titleId} className="mt-[2px] mb-0 text-[17px] font-semibold leading-[1.2]">
          {title}
        </h2>
      </header>
      <div className="py-[16px] px-[18px] text-[13.5px] leading-[1.55] text-n800">{children}</div>
      <footer className="flex justify-end items-center gap-[10px] py-[12px] px-[18px] border-t border-rule">
        <Button variant="secondary" onClick={onClose}>
          {confirmLabel ? cancelLabel : "Close"}
        </Button>
        {confirmLabel ? (
          <Button variant="primary" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        ) : null}
      </footer>
    </dialog>
  );
}
