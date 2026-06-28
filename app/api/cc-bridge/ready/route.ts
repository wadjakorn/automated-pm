import { NextRequest, NextResponse } from "next/server";
import { handle } from "@/lib/api-errors";
import { currentUser } from "@/lib/auth";
import { listReadyTickets } from "@/lib/repo";

export const dynamic = "force-dynamic";

// GET /api/cc-bridge/ready[?project=<id|name>][&assignee=<id|username>]
// The poll routine's source of work: ready tickets across opted-in (repo-
// bearing) projects, repo URL joined. STRICTER than the open board — it gates
// autonomous code execution, so it requires a valid PM_TOKEN (or session).
export function GET(req: NextRequest) {
  if (!currentUser(req)) {
    return NextResponse.json(
      { error: "unauthorized", message: "a valid PM_TOKEN is required for /ready" },
      { status: 401 }
    );
  }
  return handle(() => {
    const sp = new URL(req.url).searchParams;
    return listReadyTickets({
      projectRef: sp.get("project") ?? undefined,
      assignee: sp.get("assignee") ?? undefined,
      status: process.env.CC_BRIDGE_READY_STATUS || "todo",
    });
  });
}
