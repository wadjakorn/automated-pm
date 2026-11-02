import { NextRequest } from "next/server";
import { addTransition, removeTransition } from "@/lib/repo";
import { handleWrite } from "@/lib/actor";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// POST { from, to } adds an allowed edge.
export function POST(req: NextRequest, { params }: Ctx) {
  return handleWrite(req, async () => {
    const { id } = await params;
    const body = await req.json();
    return addTransition(id, body.from, body.to);
  });
}

// DELETE ?from=&to= removes an edge.
export function DELETE(req: NextRequest, { params }: Ctx) {
  return handleWrite(req, async () => {
    const { id } = await params;
    const sp = new URL(req.url).searchParams;
    return removeTransition(id, sp.get("from") ?? "", sp.get("to") ?? "");
  });
}
