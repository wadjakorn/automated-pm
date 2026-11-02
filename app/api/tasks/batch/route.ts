import { NextRequest } from "next/server";
import { badRequest } from "@/lib/api-errors";
import { createTasks } from "@/lib/repo";
import { handleWrite } from "@/lib/actor";

export const dynamic = "force-dynamic";

// POST { project, tasks: [{ title, description?, status?, assignee?, priority? }] }
// All-or-nothing: one bad item rolls the whole batch back (no half-created
// lists to clean up before a retry). Same ready gate as single creates.
export function POST(req: NextRequest) {
  return handleWrite(req, async (me) => {
    const body = await req.json();
    if (!body.project) throw badRequest("project is required");
    return createTasks(body.project, body.tasks, {
      creatorId: me?.id ?? null,
      actorKind: me?.kind ?? null,
    });
  });
}
