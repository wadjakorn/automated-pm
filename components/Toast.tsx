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
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={`rounded-md border px-4 py-2 text-sm shadow-lg ${
            t.kind === "error"
              ? "border-red-700 bg-red-950 text-red-200"
              : t.kind === "success"
                ? "border-green-700 bg-green-950 text-green-200"
                : "border-border bg-bg-card text-gray-200"
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
