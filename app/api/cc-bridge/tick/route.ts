import { NextRequest, NextResponse } from "next/server";
import { checkSecret, isBridgeEnabled, processQueue } from "@/lib/webhook";

export const dynamic = "force-dynamic";

// POST /api/cc-bridge/tick  (header: X-Secret)
// Drains due webhook deliveries once. Call on a schedule from the Pi (cron /
// systemd timer) so retries fire even with no board activity — this is what
// delivers a ticket queued while the dev machine was asleep, once it wakes.
// Returns the per-run counts { attempted, delivered, retried, dead }.
export async function POST(req: NextRequest) {
  if (!isBridgeEnabled())
    return NextResponse.json(
      { error: "bad_request", message: "cc-bridge is not configured (set CC_BRIDGE_URL)" },
      { status: 400 }
    );
  if (!checkSecret(req.headers.get("x-secret")))
    return NextResponse.json({ error: "forbidden", message: "bad secret" }, { status: 403 });

  const result = await processQueue();
  return NextResponse.json({ ok: true, ...result });
}
