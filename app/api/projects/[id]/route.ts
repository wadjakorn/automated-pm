import { NextRequest } from "next/server";
import { handle } from "@/lib/api-errors";
import { getProject, softDeleteProject, updateProject } from "@/lib/repo";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function GET(_req: NextRequest, { params }: Ctx) {
  return handle(async () => getProject((await params).id));
}

export function PATCH(req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const body = await req.json();
    return updateProject(id, body);
  });
}

export function DELETE(_req: NextRequest, { params }: Ctx) {
  return handle(async () => softDeleteProject((await params).id));
}
