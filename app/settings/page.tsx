import { Suspense } from "react";
import { Settings } from "@/components/Settings";
import { ToastHost } from "@/components/Toast";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6 text-fg-subtle">Loading…</div>}>
      <Settings />
      <ToastHost />
    </Suspense>
  );
}
