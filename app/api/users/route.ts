import { handle } from "@/lib/api-errors";
import { listUsers } from "@/lib/repo";

export const dynamic = "force-dynamic";

// GET -> public user list (id, username, created_at) for assignee pickers.
// Never exposes password_hash or api_token.
export function GET() {
  return handle(() => listUsers());
}
