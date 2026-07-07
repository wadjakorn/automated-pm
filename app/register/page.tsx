import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";

// AuthForm reads useSearchParams (?next=), so it needs a Suspense boundary.
export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <AuthForm mode="register" />
    </Suspense>
  );
}
