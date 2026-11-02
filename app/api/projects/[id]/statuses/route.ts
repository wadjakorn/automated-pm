import { NextRequest } from "next/server";
import { addStatus, getStateMachine, removeStatus, updateStatus } from "@/lib/repo";
import { handleRead, handleWrite } from "@/lib/actor";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET returns the full state machine (statuses + transitions).
export function GET(req: NextRequest, { params }: Ctx) {
  return handleRead(req, async () => getStateMachine((await params).id));
}

export function POST(req: NextRequest, { params }: Ctx) {
  return handleWrite(req, async () => {
    const { id } = await params;
    const body = await req.json();
    return addStatus(id, body);
  });
}

// PATCH updates a status: { key, label?, is_final?, sort_order? }
export function PATCH(req: NextRequest, { params }: Ctx) {
  return handleWrite(req, async () => {
    const { id } = await params;
    const body = await req.json();
    return updateStatus(id, body.key, body);
  });
}

// DELETE removes a status by ?key=
export function DELETE(req: NextRequest, { params }: Ctx) {
  return handleWrite(req, async () => {
    const { id } = await params;
    const key = new URL(req.url).searchParams.get("key") ?? "";
    return removeStatus(id, key);
  });
}
