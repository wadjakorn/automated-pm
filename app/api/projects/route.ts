import { NextRequest } from "next/server";
import { createProject, listProjects } from "@/lib/repo";
import { handleRead, handleWrite } from "@/lib/actor";

export const dynamic = "force-dynamic";

// GET /api/projects[?includeArchived=true&includeDeleted=true]. Default returns
// the live sidebar list (hidden projects included; the sidebar filters them).
export function GET(req: NextRequest) {
  return handleRead(req, () => {
    const sp = new URL(req.url).searchParams;
    return listProjects({
      includeArchived: sp.get("includeArchived") === "true",
      includeDeleted: sp.get("includeDeleted") === "true",
    });
  });
}

export function POST(req: NextRequest) {
  return handleWrite(req, async () => {
    const body = await req.json();
    return createProject(body.name, body.description);
  });
}
