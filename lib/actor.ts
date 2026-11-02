// Request → actor resolution and the auth policy for every API route.
//
// Two rules, applied in one place so no route can forget them:
//  1. A Bearer token that doesn't match a user is a 401 — never a silent fall
//     back to anonymous (a typo'd PM_TOKEN used to "work" unattributed).
//  2. PM_AUTH_MODE=write-token makes every write require an actor (session
//     cookie or token). The default `open` keeps anonymous writes working.
// Routes wrap their body in handleRead / handleWrite instead of `handle`;
// lib/route-auth.test.ts fails if a route handler skips them.
import type { NextResponse } from "next/server";
import { getDb } from "./db";
import { currentUser } from "./auth";
import { handle, unauthorized } from "./api-errors";
import type { User } from "./types";

export type AuthMode = "open" | "write-token";

export function authMode(): AuthMode {
  return process.env.PM_AUTH_MODE === "write-token" ? "write-token" : "open";
}

// The caller, or null when anonymous. Throws 401 for a Bearer token that
// doesn't belong to any user (including an empty one).
export function resolveActor(req: Request): User | null {
  const auth = req.headers.get("authorization");
  // Header values arrive trimmed, so a bare "Bearer" (empty PM_TOKEN) has no
  // trailing space — match the scheme word, not "Bearer ".
  if (auth && /^bearer\b/i.test(auth)) {
    const token = auth.replace(/^bearer\s*/i, "").trim();
    const u = token
      ? (getDb().prepare("SELECT * FROM users WHERE api_token = ?").get(token) as
          | User
          | undefined)
      : undefined;
    if (!u) throw unauthorized("invalid API token (check PM_TOKEN)");
    return u;
  }
  return currentUser(req);
}

// The caller for a write. In write-token mode an anonymous write is a 401.
export function requireWriter(req: Request): User | null {
  const actor = resolveActor(req);
  if (!actor && authMode() === "write-token")
    throw unauthorized("this server requires a token for writes (set PM_TOKEN or log in)");
  return actor;
}

export function handleRead(
  req: Request,
  fn: (actor: User | null) => Promise<unknown> | unknown
): Promise<NextResponse> {
  return handle(() => fn(resolveActor(req)));
}

export function handleWrite(
  req: Request,
  fn: (actor: User | null) => Promise<unknown> | unknown
): Promise<NextResponse> {
  return handle(() => fn(requireWriter(req)));
}
