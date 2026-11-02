import { NextRequest } from "next/server";
import { archiveTask } from "@/lib/repo";
import { handleWrite } from "@/lib/actor";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// POST { version? } — archive a single ticket (must be in a final status).
export function POST(req: NextRequest, { params }: Ctx) {
  return handleWrite(req, async (me) => {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    return archiveTask(id, { version: body?.version, actorId: me?.id ?? null });
  });
}
