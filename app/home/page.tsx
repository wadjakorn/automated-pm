import { Suspense } from "react";
import { Home } from "@/components/Home";
import { ToastHost } from "@/components/Toast";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6 text-fg-subtle">Loading…</div>}>
      <Home />
      <ToastHost />
    </Suspense>
  );
}
