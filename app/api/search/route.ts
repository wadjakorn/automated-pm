import { NextRequest } from "next/server";
import { searchTasks } from "@/lib/repo";
import { handleRead } from "@/lib/actor";

export const dynamic = "force-dynamic";

// GET ?q=&project=&status=&assignee=&includeDeleted=&limit= -> ranked hits
// across projects (title, description, comments; archived included), each
// { task (summary), project_name, snippet }. A ticket key is an exact hit.
export function GET(req: NextRequest) {
  return handleRead(req, () => {
    const sp = new URL(req.url).searchParams;
    return searchTasks({
      q: sp.get("q") ?? "",
      project: sp.get("project") ?? undefined,
      status: sp.get("status") ?? undefined,
      assignee: sp.get("assignee") ?? undefined,
      includeDeleted: sp.get("includeDeleted") === "true",
      limit: sp.get("limit") ?? undefined,
    });
  });
}
