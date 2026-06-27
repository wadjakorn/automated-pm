import { NextRequest, NextResponse } from "next/server";
import { checkSecret, enqueueDelivery, isBridgeEnabled, kickDelivery } from "@/lib/webhook";

export const dynamic = "force-dynamic";

// POST /api/cc-bridge/resume  (header: X-Secret)
// Body { id, project, order } — a PR comment or CI summary that should resume
// the SAME ticket's Claude session on the dev machine. Enqueues an action
// "resume" delivery (same durable retry queue as a "new" run) and returns 202.
//
// Wiring: GitHub/CI webhook -> this route -> machine listener -> run.sh resumes
// the stored session_id. See cc-bridge/README.md.
export async function POST(req: NextRequest) {
  if (!isBridgeEnabled())
    return NextResponse.json(
      { error: "bad_request", message: "cc-bridge is not configured (set CC_BRIDGE_URL)" },
      { status: 400 }
    );
  if (!checkSecret(req.headers.get("x-secret")))
    return NextResponse.json({ error: "forbidden", message: "bad secret" }, { status: 403 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request", message: "invalid JSON body" }, { status: 400 });
  }
  const ticketId = body?.id;
  const project = body?.project;
  const order = body?.order ?? null;
  if (!ticketId || !project)
    return NextResponse.json(
      { error: "bad_request", message: "id and project are required" },
      { status: 400 }
    );

  const row = enqueueDelivery({ ticketId, project, action: "resume", orderText: order });
  kickDelivery();
  return NextResponse.json({ ok: true, delivery: row }, { status: 202 });
}
