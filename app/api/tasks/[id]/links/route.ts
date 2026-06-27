import { NextRequest } from "next/server";
import { handle } from "@/lib/api-errors";
import { createLink, listLinksFor } from "@/lib/repo";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET  -> all links for this ticket (both directions), labelled from its view.
export function GET(_req: NextRequest, { params }: Ctx) {
  return handle(async () => listLinksFor((await params).id));
}

// POST { targetRef, type } -> create one link. `type` is a UI option
// (blocks|blocked-by|causes|caused-by|relates); the repo normalizes direction.
export function POST(req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const body = await req.json();
    return createLink(id, body.targetRef, body.type);
  });
}
