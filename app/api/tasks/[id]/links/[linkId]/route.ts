import { NextRequest } from "next/server";
import { getTask, removeLink } from "@/lib/repo";
import { handleWrite } from "@/lib/actor";

export const dynamic = "force-dynamic";

// linkId identifies the edge directly, so removing from either ticket works.
type Ctx = { params: Promise<{ id: string; linkId: string }> };

export function DELETE(req: NextRequest, { params }: Ctx) {
  return handleWrite(req, async (me) => {
    const { id, linkId } = await params;
    // The ticket it was removed from gets the history entry.
    return removeLink(linkId, { actorId: me?.id ?? null, viewerId: getTask(id, true).id });
  });
}
