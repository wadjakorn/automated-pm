import { NextRequest } from "next/server";
import { reorderProjects } from "@/lib/repo";
import { handleWrite } from "@/lib/actor";

export const dynamic = "force-dynamic";

// POST { ids: string[] } — persist a new sidebar order (full ordered id list).
export function POST(req: NextRequest) {
  return handleWrite(req, async () => {
    const body = await req.json();
    return reorderProjects(Array.isArray(body?.ids) ? body.ids : []);
  });
}
