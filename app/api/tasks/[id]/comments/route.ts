import { NextRequest } from "next/server";
import { addComment, listActivity } from "@/lib/repo";
import { handleRead, handleWrite } from "@/lib/actor";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET -> this ticket's comments, oldest first (?since=<seq>&limit=).
export function GET(req: NextRequest, { params }: Ctx) {
  return handleRead(req, async () => {
    const sp = new URL(req.url).searchParams;
    return listActivity((await params).id, {
      type: "comment",
      since: sp.get("since") ?? undefined,
      limit: sp.get("limit") ?? undefined,
    });
  });
}

// POST { body, kind?: note|question|answer|handoff, reply_to?: <comment id> }
// An answer replying to a question resolves it (it leaves the inbox).
export function POST(req: NextRequest, { params }: Ctx) {
  return handleWrite(req, async (me) => {
    const body = await req.json();
    return addComment((await params).id, body, { actorId: me?.id ?? null });
  });
}
