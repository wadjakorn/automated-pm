"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiClientError } from "@/lib/client";
import { toast } from "./Toast";

// Shared login/register form. On register, the one-time api_token is shown so
// the user can copy it for CLI use (PM_TOKEN); login just redirects home.
export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  const isRegister = mode === "register";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setBusy(true);
    try {
      if (isRegister) {
        const res = await api.register(username.trim(), password);
        setToken(res.api_token);
        toast(`Welcome, ${res.user.username}`, "success");
      } else {
        await api.login(username.trim(), password);
        toast("Logged in", "success");
        router.push("/");
      }
    } catch (err) {
      const e2 = err as ApiClientError;
      toast(e2.message ?? "Failed", "error");
    } finally {
      setBusy(false);
    }
  }

  // After register: show the token once, then let the user continue.
  if (token) {
    return (
      <div className="mx-auto mt-24 flex w-full max-w-sm flex-col gap-4 rounded-lg border border-border bg-bg-soft p-6">
        <h1 className="text-lg font-semibold text-white">Account created</h1>
        <p className="text-sm text-gray-400">
          Your API token (for the <code>pm</code> CLI). Copy it now — it is shown
          only once. Set <code>PM_TOKEN</code> to use it.
        </p>
        <code className="break-all rounded border border-border bg-bg-card p-3 text-xs text-amber-300">
          {token}
        </code>
        <button
          onClick={() => router.push("/")}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500"
        >
          Go to board
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="mx-auto mt-24 flex w-full max-w-sm flex-col gap-4 rounded-lg border border-border bg-bg-soft p-6"
    >
      <h1 className="text-lg font-semibold text-white">
        {isRegister ? "Create account" : "Log in"}
      </h1>

      <label className="text-xs text-gray-400">Username</label>
      <input
        autoFocus
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        autoComplete="username"
        className="rounded border border-border bg-bg-card px-3 py-2 text-sm outline-none"
      />

      <label className="text-xs text-gray-400">Password</label>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete={isRegister ? "new-password" : "current-password"}
        className="rounded border border-border bg-bg-card px-3 py-2 text-sm outline-none"
      />

      <button
        type="submit"
        disabled={busy}
        className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500 disabled:opacity-50"
      >
        {isRegister ? "Register" : "Log in"}
      </button>

      <div className="text-center text-xs text-gray-500">
        {isRegister ? (
          <>
            Have an account?{" "}
            <Link href="/login" className="text-blue-400 hover:underline">
              Log in
            </Link>
          </>
        ) : (
          <>
            No account?{" "}
            <Link href="/register" className="text-blue-400 hover:underline">
              Register
            </Link>
          </>
        )}
      </div>
    </form>
  );
}
