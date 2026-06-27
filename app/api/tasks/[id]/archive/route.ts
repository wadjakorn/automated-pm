import { NextRequest } from "next/server";
import { handle } from "@/lib/api-errors";
import { archiveTask } from "@/lib/repo";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// POST { version? } — archive a single ticket (must be in a final status).
export function POST(req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    return archiveTask(id, { version: body?.version });
  });
}
