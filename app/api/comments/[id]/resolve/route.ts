import { NextRequest } from "next/server";
import { resolveComment } from "@/lib/repo";
import { handleWrite } from "@/lib/actor";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// POST -> mark a question resolved without writing an answer.
export function POST(req: NextRequest, { params }: Ctx) {
  return handleWrite(req, async (me) =>
    resolveComment((await params).id, { actorId: me?.id ?? null })
  );
}
