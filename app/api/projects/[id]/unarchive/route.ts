import { NextRequest } from "next/server";
import { handle } from "@/lib/api-errors";
import { unarchiveProject } from "@/lib/repo";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export function POST(_req: NextRequest, { params }: Ctx) {
  return handle(async () => unarchiveProject((await params).id));
}
