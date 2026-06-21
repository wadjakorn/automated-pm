import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-errors";
import { destroySession, SESSION_COOKIE, sessionIdFromRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST -> destroy the current session (if any) and clear the cookie.
export async function POST(req: NextRequest) {
  try {
    const sid = sessionIdFromRequest(req);
    if (sid) destroySession(sid);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
