import { NextRequest } from "next/server";
import { handle, badRequest } from "@/lib/api-errors";
import { createTask, listTasks } from "@/lib/repo";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET ?project=&status=&includeDeleted=&assignee=
export function GET(req: NextRequest) {
  return handle(() => {
    const sp = new URL(req.url).searchParams;
    const project = sp.get("project");
    if (!project) throw badRequest("project query param is required");
    return listTasks(project, {
      status: sp.get("status") ?? undefined,
      includeDeleted: sp.get("includeDeleted") === "true",
      assignee: sp.get("assignee") ?? undefined,
    });
  });
}

// POST { project, title, description?, status?, assignee? }
// creator_id is taken from the authenticated caller (nullable when anonymous).
export function POST(req: NextRequest) {
  return handle(async () => {
    const body = await req.json();
    if (!body.project) throw badRequest("project is required");
    const me = currentUser(req);
    return createTask(body.project, { ...body, creatorId: me?.id ?? null });
  });
}
