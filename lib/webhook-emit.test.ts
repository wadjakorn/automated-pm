import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Proves the repo.moveTask hook actually enqueues a cc-bridge delivery when a
// ticket enters the Ready status — i.e. the emit wiring, not just webhook.ts.
let repo: typeof import("./repo");
let db: typeof import("./db");

beforeAll(async () => {
  process.env.PM_DB_PATH = join(mkdtempSync(join(tmpdir(), "pm-emit-")), "test.db");
  process.env.CC_BRIDGE_URL = "http://machine.test:8787";
  process.env.CC_BRIDGE_SECRET = "s3cret";
  process.env.CC_BRIDGE_READY_STATUS = "todo";
  db = await import("./db");
  repo = await import("./repo");
});

afterEach(() => vi.restoreAllMocks());

const deliveries = (ticketId: string) =>
  db
    .getDb()
    .prepare("SELECT * FROM webhook_deliveries WHERE ticket_id=?")
    .all(ticketId) as { action: string; state: string }[];

describe("moveTask emit-on-Ready", () => {
  it("enqueues a 'new' delivery when a ticket reaches the ready status", () => {
    // kickDelivery() fires fetch async (unawaited); stub it so nothing escapes.
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 202 }) as Response));
    const p = repo.createProject("emit-1");
    const t = repo.createTask(p.id, { title: "ship it" }); // starts in backlog
    expect(deliveries(t.id)).toHaveLength(0);

    repo.moveTask(t.id, "todo"); // backlog -> todo (Ready)
    const rows = deliveries(t.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("new");
  });

  it("does not enqueue on a non-ready transition", () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 202 }) as Response));
    const p = repo.createProject("emit-2");
    const t = repo.createTask(p.id, { title: "later" });
    repo.moveTask(t.id, "todo"); // ready (1 delivery)
    repo.moveTask(t.id, "doing"); // not ready — no new delivery
    expect(deliveries(t.id)).toHaveLength(1);
  });
});
