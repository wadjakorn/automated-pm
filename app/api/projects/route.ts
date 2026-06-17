import { NextRequest } from "next/server";
import { handle } from "@/lib/api-errors";
import { createProject, listProjects } from "@/lib/repo";

export const dynamic = "force-dynamic";

export function GET() {
  return handle(() => listProjects());
}

export function POST(req: NextRequest) {
  return handle(async () => {
    const body = await req.json();
    return createProject(body.name, body.description);
  });
}
