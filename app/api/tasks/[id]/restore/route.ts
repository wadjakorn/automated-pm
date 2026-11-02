import { NextRequest } from "next/server";
import { restoreTask } from "@/lib/repo";
import { handleWrite } from "@/lib/actor";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: NextRequest, { params }: Ctx) {
  return handleWrite(req, async (me) =>
    restoreTask((await params).id, { actorId: me?.id ?? null })
  );
}
