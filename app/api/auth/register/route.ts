import { NextRequest, NextResponse } from "next/server";
import { badRequest, errorResponse } from "@/lib/api-errors";
import { createUser } from "@/lib/repo";
import { createSession, SESSION_COOKIE, sessionMaxAgeSeconds } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST { username, password } -> create account, start a browser session, and
// return the public user plus the api_token (shown once, for CLI use).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    if (!body.username || !body.password)
      throw badRequest("username and password are required");
    const user = createUser(body.username, body.password);
    const session = createSession(user.id);
    const res = NextResponse.json({
      user: { id: user.id, username: user.username, created_at: user.created_at },
      api_token: user.api_token,
    });
    res.cookies.set(SESSION_COOKIE, session.id, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: sessionMaxAgeSeconds,
    });
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
