import { NextRequest } from "next/server";
import { handle } from "@/lib/api-errors";
import { reorderProjects } from "@/lib/repo";

export const dynamic = "force-dynamic";

// POST { ids: string[] } — persist a new sidebar order (full ordered id list).
export function POST(req: NextRequest) {
  return handle(async () => {
    const body = await req.json();
    return reorderProjects(Array.isArray(body?.ids) ? body.ids : []);
  });
}
