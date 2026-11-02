import { NextRequest } from "next/server";
import { badRequest } from "@/lib/api-errors";
import { createTask, listTasks } from "@/lib/repo";
import { summarizeTask } from "@/lib/task-view";
import { handleRead, handleWrite } from "@/lib/actor";

export const dynamic = "force-dynamic";

// GET ?project=&status=&includeDeleted=&assignee=&priority=&view=summary|full
// view=summary trims descriptions to an excerpt (+ has_more_description).
export function GET(req: NextRequest) {
  return handleRead(req, () => {
    const sp = new URL(req.url).searchParams;
    const project = sp.get("project");
    if (!project) throw badRequest("project query param is required");
    const view = sp.get("view") ?? "full";
    if (view !== "full" && view !== "summary") throw badRequest(`unknown view "${view}" (summary|full)`);
    const tasks = listTasks(project, {
      status: sp.get("status") ?? undefined,
      includeDeleted: sp.get("includeDeleted") === "true",
      includeArchived: sp.get("includeArchived") === "true",
      assignee: sp.get("assignee") ?? undefined,
      priority: sp.get("priority") ?? undefined,
    });
    return view === "summary" ? tasks.map((t) => summarizeTask(t)) : tasks;
  });
}

// POST { project, title, description?, status?, assignee?, priority? }
// creator_id is taken from the authenticated caller (nullable when anonymous).
// Only a human caller may create straight into the ready status.
export function POST(req: NextRequest) {
  return handleWrite(req, async (me) => {
    const body = await req.json();
    if (!body.project) throw badRequest("project is required");
    return createTask(body.project, {
      ...body,
      creatorId: me?.id ?? null,
      actorKind: me?.kind ?? null,
    });
  });
}
