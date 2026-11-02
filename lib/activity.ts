// Append-only per-ticket history: every state change and every comment is a
// row in task_activity, written in the same transaction-free call right after
// the change it describes (better-sqlite3 is synchronous and single-process,
// so nothing interleaves). `seq` is a global cursor for "what changed since".
import { nanoid } from "nanoid";
import { getDb } from "./db";

export type ActivityType =
  | "comment"
  | "created"
  | "status"
  | "field"
  | "link"
  | "unlink"
  | "deleted"
  | "restored"
  | "archived"
  | "unarchived";

export type CommentKind = "note" | "question" | "answer" | "handoff";
export const COMMENT_KINDS: CommentKind[] = ["note", "question", "answer", "handoff"];

// Who did it: a user id, or null for an anonymous caller. Internal callers
// (tests, scripts) may omit it, which records null as well.
export interface ActorCtx {
  actorId?: string | null;
}

export function logActivity(row: {
  taskId: string;
  projectId: string;
  actorId?: string | null;
  type: ActivityType;
  kind?: CommentKind | null;
  body?: string | null;
  replyTo?: string | null;
  payload?: unknown;
}): string {
  const aid = nanoid(12);
  getDb()
    .prepare(
      `INSERT INTO task_activity (id, task_id, project_id, actor_id, type, kind, body, reply_to, payload, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      aid,
      row.taskId,
      row.projectId,
      row.actorId ?? null,
      row.type,
      row.kind ?? null,
      row.body ?? null,
      row.replyTo ?? null,
      row.payload === undefined ? null : JSON.stringify(row.payload),
      new Date().toISOString()
    );
  return aid;
}
