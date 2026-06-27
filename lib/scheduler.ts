// Server-side drain loop for the cc-bridge webhook queue. Runs inside the PM
// server process (started from instrumentation.ts) so retries fire on their own
// — no external cron / systemd timer needed on the host. A ticket queued while
// the dev machine was asleep is redelivered within one tick of it coming back.
//
// It kicks the drain by calling the app's OWN /api/cc-bridge/tick over loopback
// rather than importing the repo/db directly. That keeps instrumentation free of
// the native better-sqlite3 module (which can't be bundled into the edge runtime
// instrumentation is also compiled for), and reuses the route's secret gate.
//
// Opt-in + idempotent: silent unless CC_BRIDGE_URL is set, and a guard prevents
// a second interval if register() runs more than once.

let started = false;

const DEFAULT_TICK_MS = 30_000; // matches the 30s backoff floor

export function startScheduler(): void {
  if (started) return;
  started = true;
  if (!process.env.CC_BRIDGE_URL) return; // feature off — stay silent

  const tickMs = Math.max(1_000, Number(process.env.CC_BRIDGE_TICK_MS) || DEFAULT_TICK_MS);
  const port = process.env.PORT || "3000";
  const selfUrl =
    process.env.CC_BRIDGE_SELF_URL || `http://127.0.0.1:${port}/api/cc-bridge/tick`;
  const secret = process.env.CC_BRIDGE_SECRET || "";

  const timer = setInterval(() => {
    fetch(selfUrl, { method: "POST", headers: { "X-Secret": secret } }).catch(() => {
      // server may still be booting, or briefly unreachable — next tick retries.
    });
  }, tickMs);
  timer.unref?.(); // don't keep the event loop alive solely for this timer
  console.log(`cc-bridge scheduler: draining webhook queue every ${tickMs}ms via ${selfUrl}`);
}
