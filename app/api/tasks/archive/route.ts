import { NextRequest } from "next/server";
import { badRequest } from "@/lib/api-errors";
import { bulkArchiveColumn } from "@/lib/repo";
import { handleWrite } from "@/lib/actor";

export const dynamic = "force-dynamic";

// POST { project, status } — bulk-archive every live ticket in a final-status
// column. Returns { archived: Task[] }.
export function POST(req: NextRequest) {
  return handleWrite(req, async () => {
    const body = await req.json();
    if (!body.project) throw badRequest("project is required");
    if (!body.status) throw badRequest("status is required");
    return bulkArchiveColumn(body.project, body.status);
  });
}
