import { NextRequest } from "next/server";
import { handle, badRequest } from "@/lib/api-errors";
import { createTask, listTasks } from "@/lib/repo";

export const dynamic = "force-dynamic";

// GET ?project=&status=&includeDeleted=
export function GET(req: NextRequest) {
  return handle(() => {
    const sp = new URL(req.url).searchParams;
    const project = sp.get("project");
    if (!project) throw badRequest("project query param is required");
    return listTasks(project, {
      status: sp.get("status") ?? undefined,
      includeDeleted: sp.get("includeDeleted") === "true",
    });
  });
}

// POST { project, title, description?, status? }
export function POST(req: NextRequest) {
  return handle(async () => {
    const body = await req.json();
    if (!body.project) throw badRequest("project is required");
    return createTask(body.project, body);
  });
}
