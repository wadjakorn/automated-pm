"use client";

import { useEffect, useState } from "react";

// Tiny event-based toast: call toast(msg) from anywhere; <ToastHost/> renders them.
type Kind = "info" | "error" | "success";
type ToastMsg = { id: number; text: string; kind: Kind };

const EVENT = "pm-toast";
let counter = 0;

export function toast(text: string, kind: Kind = "info") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ToastMsg>(EVENT, {
      detail: { id: ++counter, text, kind },
    })
  );
}

export function ToastHost() {
  const [items, setItems] = useState<ToastMsg[]>([]);

  useEffect(() => {
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<ToastMsg>).detail;
      setItems((prev) => [...prev, detail]);
      setTimeout(() => {
        setItems((prev) => prev.filter((t) => t.id !== detail.id));
      }, 3500);
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
          className={`pointer-events-auto max-w-sm animate-toast-in rounded-md border px-4 py-2 text-sm shadow-lg ${
            t.kind === "error"
              ? "border-danger-border bg-danger-bg text-danger"
              : t.kind === "success"
                ? "border-success-border bg-success-bg text-success"
                : "border-border bg-bg-card text-fg"
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
