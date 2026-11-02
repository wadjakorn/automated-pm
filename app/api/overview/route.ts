import { NextRequest } from "next/server";
import { overview } from "@/lib/repo";
import { handleRead } from "@/lib/actor";

export const dynamic = "force-dynamic";

// GET ?user=<id|username> -> { user, mine, agents, inbox_count }: the cross-
// project home. `user` defaults to the caller (session or token).
export function GET(req: NextRequest) {
  return handleRead(req, (me) => {
    const user = new URL(req.url).searchParams.get("user");
    return overview(user || me?.id || null);
  });
}
