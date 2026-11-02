import { NextRequest } from "next/server";
import { restoreProject } from "@/lib/repo";
import { handleWrite } from "@/lib/actor";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(req: NextRequest, { params }: Ctx) {
  return handleWrite(req, async () => restoreProject((await params).id));
}
