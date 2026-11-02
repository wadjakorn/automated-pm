import { NextRequest, NextResponse } from "next/server";
import { badRequest, errorResponse, unauthorized } from "@/lib/api-errors";
import { createUser, listUsers } from "@/lib/repo";
import { authMode, resolveActor } from "@/lib/actor";
import { createSession, SESSION_COOKIE, sessionMaxAgeSeconds } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST { username, password, kind? } -> create account, start a browser session, and
// return the public user plus the api_token (shown once, for CLI use).
// In write-token mode only an existing user may create accounts (the very
// first account is the exception, so a fresh install can bootstrap). A caller
// who is already logged in keeps their own session.
export async function POST(req: NextRequest) {
  try {
    const caller = resolveActor(req);
    if (!caller && authMode() === "write-token" && listUsers().length > 0)
      throw unauthorized("registration is closed: an existing user must create accounts");
    const body = await req.json().catch(() => ({}));
    if (!body.username || !body.password)
      throw badRequest("username and password are required");
    const user = createUser(body.username, body.password, body.kind);
    const res = NextResponse.json({
      user: { id: user.id, username: user.username, kind: user.kind, created_at: user.created_at },
      api_token: user.api_token,
    });
    if (!caller) {
      const session = createSession(user.id);
      res.cookies.set(SESSION_COOKIE, session.id, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: sessionMaxAgeSeconds,
      });
    }
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
