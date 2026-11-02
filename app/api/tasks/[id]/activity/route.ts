import { NextRequest } from "next/server";
import { listActivity } from "@/lib/repo";
import { handleRead } from "@/lib/actor";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET -> the ticket's full history (comments + state changes), oldest first.
// ?since=<seq> for only what is new; ?limit= caps the page (default 200).
export function GET(req: NextRequest, { params }: Ctx) {
  return handleRead(req, async () => {
    const sp = new URL(req.url).searchParams;
    return listActivity((await params).id, {
      since: sp.get("since") ?? undefined,
      limit: sp.get("limit") ?? undefined,
    });
  });
}
