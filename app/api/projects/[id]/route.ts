import { NextRequest } from "next/server";
import { getProject, softDeleteProject, updateProject } from "@/lib/repo";
import { handleRead, handleWrite } from "@/lib/actor";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function GET(req: NextRequest, { params }: Ctx) {
  return handleRead(req, async () => getProject((await params).id));
}

export function PATCH(req: NextRequest, { params }: Ctx) {
  return handleWrite(req, async () => {
    const { id } = await params;
    const body = await req.json();
    return updateProject(id, body);
  });
}

export function DELETE(req: NextRequest, { params }: Ctx) {
  return handleWrite(req, async () => softDeleteProject((await params).id));
}
