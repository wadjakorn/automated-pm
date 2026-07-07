import { NextRequest, NextResponse } from "next/server";

// Full auth gate for the WEB UI: anonymous browser users are redirected to
// /login for every app page. Only page navigations are gated — the JSON API
// (/api/*) is intentionally left open so the CLI/agent Bearer-token flow
// (PM_TOKEN) is unaffected (see ticket out-of-scope).
//
// This is a cheap cookie-PRESENCE check (middleware can't touch the SQLite
// session store). A forged/expired cookie still fails at the session /
// currentUser() layer, so nothing sensitive is exposed by the gate alone; the
// cookie's max-age matches the session TTL, so in practice presence ≈ valid.
const SESSION_COOKIE = "pm_session";

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Auth pages must stay reachable while logged out (avoids a redirect loop).
  if (pathname === "/login" || pathname === "/register") {
    return NextResponse.next();
  }

  if (req.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  // Send the user to /login, preserving where they were headed so we can bounce
  // them back after a successful login.
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  // Match every route EXCEPT the API, Next internals, and static files (any
  // path with a dot, e.g. favicon.ico). /login and /register are matched but
  // short-circuited above.
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
