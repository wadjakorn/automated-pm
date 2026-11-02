import { NextRequest } from "next/server";
import { listUsers } from "@/lib/repo";
import { handleRead } from "@/lib/actor";

export const dynamic = "force-dynamic";

// GET -> public user list (id, username, created_at) for assignee pickers.
// Never exposes password_hash or api_token.
export function GET(req: NextRequest) {
  return handleRead(req, () => listUsers());
}
