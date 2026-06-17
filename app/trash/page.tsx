import { Suspense } from "react";
import { Trash } from "@/components/Trash";
import { ToastHost } from "@/components/Toast";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-500">Loading…</div>}>
      <Trash />
      <ToastHost />
    </Suspense>
  );
}
