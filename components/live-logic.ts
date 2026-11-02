// Pure helpers for the live board (GET /api/stream, Server-Sent Events).

export interface StreamEvent {
  seq: number;
  task_id: string;
  project_id: string;
  type: string;
}

// Parse one `event: activity` payload; anything malformed is ignored (null)
// rather than breaking the subscription.
export function parseStreamEvent(data: unknown): StreamEvent | null {
  if (typeof data !== "string") return null;
  try {
    const v = JSON.parse(data);
    if (
      v &&
      typeof v.seq === "number" &&
      typeof v.task_id === "string" &&
      typeof v.project_id === "string"
    ) {
      return { seq: v.seq, task_id: v.task_id, project_id: v.project_id, type: String(v.type ?? "") };
    }
  } catch {}
  return null;
}

// Poll cadence for the board: the stream does the work while it is connected,
// so the poll only backstops it; without the stream it is the only source of
// freshness again.
export const POLL_FAST_MS = 4000;
export const POLL_LIVE_MS = 30000;
export function boardPollMs(live: boolean): number {
  return live ? POLL_LIVE_MS : POLL_FAST_MS;
}
