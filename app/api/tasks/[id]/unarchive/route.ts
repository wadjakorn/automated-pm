import { NextRequest } from "next/server";
import { unarchiveTask } from "@/lib/repo";
import { handleWrite } from "@/lib/actor";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: NextRequest, { params }: Ctx) {
  return handleWrite(req, async (me) =>
    unarchiveTask((await params).id, { actorId: me?.id ?? null })
  );
}
