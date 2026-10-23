"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { PATTERN_TAG, PATTERN_TEXT, PatternMark, type PatternKind } from "./PatternState";
import { cx } from "./states";

// No design file draws a toast; it reuses the state pattern's marks and tags (Empty and Error States) and the
// Cobalt neutrals. A toast confirms something the person did. It never carries a verdict and is never the accent.
export type ToastInput = { text: string; kind?: PatternKind | "done" };
type ToastItem = ToastInput & { id: number };

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

export const TOAST_MS = 6000;

export function useToast() {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast needs a <ToastProvider> above it");
  return show;
}

/** Holds the toasts of a page in a polite live region, bottom right. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const show = useCallback((toast: ToastInput) => {
    const id = next.current++;
    setToasts((list) => [...list.slice(-2), { ...toast, id }]);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="fixed right-[24px] bottom-[24px] flex flex-col gap-[8px] w-[360px] z-10"
      >
        {toasts.map((toast) => (
          <Toast key={toast.id} toast={toast} dismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ toast, dismiss }: { toast: ToastItem; dismiss: (id: number) => void }) {
  const { id } = toast;
  useEffect(() => {
    const timer = setTimeout(() => dismiss(id), TOAST_MS);
    return () => clearTimeout(timer);
  }, [id, dismiss]);
  const kind = toast.kind ?? "done";
  return (
    <div
      data-toast={kind}
      className={cx(
        "flex items-start gap-[10px] bg-paper border border-ink rounded-control py-[11px] px-[14px] shadow-modal",
        kind === "action" && "border-l-4 border-l-action",
        kind === "blocked" && "border-l-4 border-l-blocked",
      )}
    >
      <div className="flex-1">
        {kind === "done" ? (
          <p className="m-0 font-mono text-[9.5px] tracking-[0.07em] text-n600">DONE</p>
        ) : (
          <p className="m-0 flex items-center gap-[9px]">
            <PatternMark kind={kind} />
            <span className={cx("font-mono text-[9.5px] tracking-[0.07em]", PATTERN_TEXT[kind])}>{PATTERN_TAG[kind]}</span>
          </p>
        )}
        <p className="mt-[5px] mb-0 text-[13px] leading-[1.5]">{toast.text}</p>
      </div>
      <button
        type="button"
        onClick={() => dismiss(id)}
        className="kit-transition bg-transparent border-0 p-[2px] font-mono text-[10px] tracking-[0.06em] text-n600 cursor-pointer hover:text-accent-700"
      >
        DISMISS
      </button>
    </div>
  );
}
