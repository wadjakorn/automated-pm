import { NextRequest, NextResponse } from "next/server";
import { badRequest, errorResponse } from "@/lib/api-errors";
import { rotateApiToken } from "@/lib/repo";

export const dynamic = "force-dynamic";

// POST { username, password } -> { api_token }: rotate the caller's API token.
// Password-authenticated like login (not via the token itself), so a leaked
// token alone can't be used to mint a replacement.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    if (!body.username || !body.password)
      throw badRequest("username and password are required");
    return NextResponse.json({ api_token: rotateApiToken(body.username, body.password) });
  } catch (err) {
    return errorResponse(err);
  }
}
