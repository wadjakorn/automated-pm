// Next.js instrumentation hook — runs once when the server process boots.
// We use it to start the cc-bridge webhook drain loop (see lib/scheduler.ts),
// which replaces the external cron/systemd tick on the host.
export async function register() {
  // Only on the Node.js server runtime (not edge / not the browser).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startScheduler } = await import("./lib/scheduler");
  startScheduler();
}
