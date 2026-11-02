"use client";

import { useEffect, useState } from "react";

// Tiny event-based toast: call toast(msg) from anywhere; <ToastHost/> renders them.
// An optional `action` adds one inline button (e.g. Undo); clicking it runs the
// callback and dismisses the toast. Toasts with an action linger longer so
// there's time to reach the button.
type Kind = "info" | "error" | "success";
export type ToastAction = { label: string; onClick: () => void };
type ToastMsg = { id: number; text: string; kind: Kind; action?: ToastAction };

const EVENT = "pm-toast";
let counter = 0;

export function toast(text: string, kind: Kind = "info", action?: ToastAction) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ToastMsg>(EVENT, {
      detail: { id: ++counter, text, kind, action },
    })
  );
}

export function ToastHost() {
  const [items, setItems] = useState<ToastMsg[]>([]);

  const dismiss = (id: number) => setItems((prev) => prev.filter((t) => t.id !== id));

  useEffect(() => {
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<ToastMsg>).detail;
      setItems((prev) => [...prev, detail]);
      setTimeout(
        () => {
          setItems((prev) => prev.filter((t) => t.id !== detail.id));
        },
        detail.action ? 6000 : 3500
      );
    };
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);

  return (
    <div
      className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-4"
      role="region"
      aria-label="Notifications"
    >
      {items.map((t) => (
        <div
          key={t.id}
          role={t.kind === "error" ? "alert" : "status"}
          aria-live={t.kind === "error" ? "assertive" : "polite"}
          className={`pointer-events-auto flex max-w-sm animate-toast-in items-center gap-3 rounded-md border px-4 py-2 text-sm shadow-lg ${
            t.kind === "error"
              ? "border-danger-border bg-danger-bg text-danger"
              : t.kind === "success"
                ? "border-success-border bg-success-bg text-success"
                : "border-border bg-bg-card text-fg"
          }`}
        >
          <span className="min-w-0">{t.text}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                dismiss(t.id);
                t.action?.onClick();
              }}
              className="shrink-0 rounded px-1.5 py-0.5 font-medium underline underline-offset-2 hover:no-underline"
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
