import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-errors";
import { resolveActor } from "@/lib/actor";

export const dynamic = "force-dynamic";

// GET -> the current user (public shape) or null when anonymous. A Bearer
// token that matches no user is a 401, so a typo'd PM_TOKEN is visible.
// Written directly (not via `handle`) because `handle` rewrites a null body to
// { ok: true }, and an anonymous caller must get a literal null.
export function GET(req: NextRequest) {
  try {
    const u = resolveActor(req); // 401 for a bad Bearer token, not null
    return NextResponse.json(
      u ? { id: u.id, username: u.username, kind: u.kind, created_at: u.created_at } : null
    );
  } catch (err) {
    return errorResponse(err);
  }
}
