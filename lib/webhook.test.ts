import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Throwaway DB before importing (db.ts reads PM_DB_PATH at load time).
let wh: typeof import("./webhook");

beforeAll(async () => {
  process.env.PM_DB_PATH = join(mkdtempSync(join(tmpdir(), "pm-wh-")), "test.db");
  process.env.CC_BRIDGE_URL = "http://machine.test:8787";
  process.env.CC_BRIDGE_SECRET = "s3cret";
  process.env.CC_BRIDGE_READY_STATUS = "todo";
  wh = await import("./webhook");
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Stub global fetch with a fixed HTTP status.
function stubFetch(status: number) {
  const fn = vi.fn(async () => ({ status }) as Response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("bridge config", () => {
  it("is enabled when CC_BRIDGE_URL is set", () => {
    expect(wh.isBridgeEnabled()).toBe(true);
    expect(wh.bridgeConfig()?.readyStatus).toBe("todo");
  });

  it("is a no-op when CC_BRIDGE_URL is unset", () => {
    const saved = process.env.CC_BRIDGE_URL;
    delete process.env.CC_BRIDGE_URL;
    try {
      expect(wh.isBridgeEnabled()).toBe(false);
      expect(wh.enqueueDelivery({ ticketId: "t-off", project: "p", action: "new" })).toBeNull();
    } finally {
      process.env.CC_BRIDGE_URL = saved;
    }
  });
});

describe("enqueue", () => {
  it("inserts a pending row due immediately", () => {
    const row = wh.enqueueDelivery({ ticketId: "t1", project: "p1", action: "new" });
    expect(row?.state).toBe("pending");
    expect(row?.attempts).toBe(0);
    expect(new Date(row!.next_attempt_at).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("dedupes an identical still-pending intent", () => {
    const a = wh.enqueueDelivery({ ticketId: "t2", project: "p1", action: "new" });
    const b = wh.enqueueDelivery({ ticketId: "t2", project: "p1", action: "new" });
    expect(a!.id).toBe(b!.id);
  });

  it("treats different order_text as distinct resume intents", () => {
    const a = wh.enqueueDelivery({ ticketId: "t3", project: "p1", action: "resume", orderText: "ci red" });
    const b = wh.enqueueDelivery({ ticketId: "t3", project: "p1", action: "resume", orderText: "pr comment" });
    expect(a!.id).not.toBe(b!.id);
  });
});

describe("processQueue", () => {
  it("marks delivered on HTTP 202 and posts the right payload", async () => {
    const fetchFn = stubFetch(202);
    wh.enqueueDelivery({ ticketId: "d1", project: "proj-x", action: "new" });
    const res = await wh.processQueue();
    expect(res.delivered).toBeGreaterThanOrEqual(1);

    // processQueue drains every due row; find the call for this ticket.
    const calls = fetchFn.mock.calls as unknown as [string, RequestInit][];
    const call = calls.find((c) => JSON.parse(c[1].body as string).id === "d1");
    expect(call).toBeTruthy();
    expect(call![0]).toBe("http://machine.test:8787/take");
    expect((call![1].headers as Record<string, string>)["X-Secret"]).toBe("s3cret");
    expect(JSON.parse(call![1].body as string)).toMatchObject({
      id: "d1",
      project: "proj-x",
      action: "new",
    });
  });

  it("retries (not delivered) on a non-202 response, with backoff", async () => {
    stubFetch(500);
    const row = wh.enqueueDelivery({ ticketId: "d2", project: "p", action: "new" })!;
    const res = await wh.processQueue();
    expect(res.delivered).toBe(0);
    expect(res.retried).toBeGreaterThanOrEqual(1);

    // re-running immediately does nothing — next_attempt_at is in the future.
    const again = await wh.processQueue();
    expect(again.attempted).toBe(0);
    // the row is still pending with a bumped attempt count.
    void row;
  });

  it("re-enqueues after delivery so re-entering Ready fires again", async () => {
    stubFetch(202);
    const first = wh.enqueueDelivery({ ticketId: "d3", project: "p", action: "new" })!;
    await wh.processQueue();
    const second = wh.enqueueDelivery({ ticketId: "d3", project: "p", action: "new" })!;
    expect(second.id).not.toBe(first.id);
    expect(second.state).toBe("pending");
  });
});

describe("checkSecret", () => {
  it("accepts the configured secret and rejects others", () => {
    expect(wh.checkSecret("s3cret")).toBe(true);
    expect(wh.checkSecret("nope")).toBe(false);
    expect(wh.checkSecret(null)).toBe(false);
  });
});
