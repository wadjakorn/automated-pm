import { NextRequest } from "next/server";
import { handle } from "@/lib/api-errors";
import { removeLink } from "@/lib/repo";

export const dynamic = "force-dynamic";

// linkId identifies the edge directly, so removing from either ticket works.
type Ctx = { params: Promise<{ id: string; linkId: string }> };

export function DELETE(_req: NextRequest, { params }: Ctx) {
  return handle(async () => removeLink((await params).linkId));
}
