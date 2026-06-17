import { NextRequest } from "next/server";
import { handle } from "@/lib/api-errors";
import { getTask, moveTask, softDeleteTask, updateTask } from "@/lib/repo";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function GET(req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const includeDeleted =
      new URL(req.url).searchParams.get("includeDeleted") === "true";
    return getTask((await params).id, includeDeleted);
  });
}

// PATCH handles both edits and moves.
// { title?, description?, status?, rank?, version? }
// If `status` is present it's a move (transition-checked); otherwise an edit.
export function PATCH(req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const body = await req.json();
    if (body.status !== undefined) {
      return moveTask(id, body.status, { version: body.version, rank: body.rank });
    }
    return updateTask(id, body);
  });
}

export function DELETE(_req: NextRequest, { params }: Ctx) {
  return handle(async () => softDeleteTask((await params).id));
}
