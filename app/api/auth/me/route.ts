import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-errors";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET -> the current user (public shape) or null when anonymous.
// Written directly (not via `handle`) because `handle` rewrites a null body to
// { ok: true }, and an anonymous caller must get a literal null.
export function GET(req: NextRequest) {
  try {
    const u = currentUser(req);
    return NextResponse.json(
      u ? { id: u.id, username: u.username, created_at: u.created_at } : null
    );
  } catch (err) {
    return errorResponse(err);
  }
}
