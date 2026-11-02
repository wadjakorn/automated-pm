import { NextRequest } from "next/server";
import { errorResponse } from "@/lib/api-errors";
import { resolveActor } from "@/lib/actor";
import { listEvents } from "@/lib/repo";

export const dynamic = "force-dynamic";

// Server-Sent Events: GET ?since=<seq>&project=<id|name> streams every new
// task_activity row as `event: activity` (compact: seq, task_id, project_id,
// type). It tails the table once a second rather than an in-memory bus, so it
// sees CLI/MCP/web writes alike. Clients reconnect with Last-Event-ID.
export async function GET(req: NextRequest) {
  try {
    resolveActor(req); // a bad Bearer token is a 401 here too
  } catch (err) {
    return errorResponse(err);
  }
  const sp = new URL(req.url).searchParams;
  const project = sp.get("project") ?? undefined;
  let cursor = Number(req.headers.get("last-event-id") ?? sp.get("since") ?? NaN);
  if (!Number.isFinite(cursor)) {
    // No cursor: start from now (only future changes).
    const latest = listEvents({ since: 0, project, limit: 1000 });
    cursor = latest.length ? latest[latest.length - 1].seq : 0;
  }

  const enc = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let beats = 0;
  const stream = new ReadableStream({
    start(controller) {
      const send = (s: string) => controller.enqueue(enc.encode(s));
      send(`retry: 3000\n: connected at ${cursor}\n\n`);
      timer = setInterval(() => {
        try {
          const rows = listEvents({ since: cursor, project, limit: 500 });
          for (const e of rows) {
            cursor = e.seq;
            const data = { seq: e.seq, task_id: e.task_id, project_id: e.project_id, type: e.type };
            send(`id: ${e.seq}\nevent: activity\ndata: ${JSON.stringify(data)}\n\n`);
          }
          if (++beats % 15 === 0) send(`: ping\n\n`);
        } catch {
          clearInterval(timer);
          controller.close();
        }
      }, 1000);
      req.signal.addEventListener("abort", () => {
        clearInterval(timer);
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      clearInterval(timer);
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
