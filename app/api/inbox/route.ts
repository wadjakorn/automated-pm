import { NextRequest } from "next/server";
import { listInbox } from "@/lib/repo";
import { handleRead } from "@/lib/actor";

export const dynamic = "force-dynamic";

// GET ?project=&assignee= -> open questions waiting for a human, oldest first.
export function GET(req: NextRequest) {
  return handleRead(req, () => {
    const sp = new URL(req.url).searchParams;
    return listInbox({
      project: sp.get("project") ?? undefined,
      assignee: sp.get("assignee") ?? undefined,
    });
  });
}
