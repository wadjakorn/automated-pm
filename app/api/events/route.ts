import { NextRequest } from "next/server";
import { listEvents } from "@/lib/repo";
import { handleRead } from "@/lib/actor";

export const dynamic = "force-dynamic";

// GET ?since=<seq>&project=&limit= -> everything that happened after the
// cursor, across tickets, oldest first. Poll with the last seq you saw.
export function GET(req: NextRequest) {
  return handleRead(req, () => {
    const sp = new URL(req.url).searchParams;
    return listEvents({
      since: sp.get("since") ?? undefined,
      project: sp.get("project") ?? undefined,
      limit: sp.get("limit") ?? undefined,
    });
  });
}
