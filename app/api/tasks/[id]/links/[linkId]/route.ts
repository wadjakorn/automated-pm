import { NextRequest } from "next/server";
import { removeLink } from "@/lib/repo";
import { handleWrite } from "@/lib/actor";

export const dynamic = "force-dynamic";

// linkId identifies the edge directly, so removing from either ticket works.
type Ctx = { params: Promise<{ id: string; linkId: string }> };

export function DELETE(req: NextRequest, { params }: Ctx) {
  return handleWrite(req, async () => removeLink((await params).linkId));
}
