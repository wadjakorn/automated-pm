// cc-bridge outbound webhook delivery.
//
// When a ticket enters the "Ready" status (default `todo`) this enqueues a
// durable delivery to the dev-machine listener (cc-bridge/listener.py), which
// auto-starts headless Claude Code for that ticket. Delivery is queued (not
// inline) so that:
//   - moveTask never blocks on the network (machine may be asleep);
//   - a ticket moved to Ready while the machine is offline is retried with
//     backoff until the listener returns HTTP 202 (ticket: retry queue);
//   - the same intent never fires twice (pending-dedupe + idem_key UNIQUE).
//
// The feature is OPT-IN: with no CC_BRIDGE_URL configured every entry point is
// a no-op, so the board behaves exactly as before. See cc-bridge/README.md for
// how the Pi (this app) and the dev machine are wired together.

import { timingSafeEqual } from "node:crypto";
import { nanoid } from "nanoid";
import { getDb } from "./db";

export type WebhookAction = "new" | "resume";

export interface BridgeConfig {
  url: string; // listener base URL, e.g. http://100.x.y.z:8787
  secret: string; // X-Secret shared with the listener
  readyStatus: string; // status key that triggers a "new" run
}

// Read config fresh each call so env changes (and tests) take effect without a
// module reload. Returns null when the bridge is not configured (feature off).
export function bridgeConfig(): BridgeConfig | null {
  const url = process.env.CC_BRIDGE_URL?.trim();
  if (!url) return null;
  return {
    url: url.replace(/\/+$/, ""),
    secret: process.env.CC_BRIDGE_SECRET?.trim() ?? "",
    readyStatus: process.env.CC_BRIDGE_READY_STATUS?.trim() || "todo",
  };
}

export const isBridgeEnabled = () => bridgeConfig() !== null;

// Retry/backoff policy. Interval = min(BASE * 2^(attempts-1), MAX); after
// MAX_ATTEMPTS failed tries the row is parked as `dead` (inspectable, not lost).
const BASE_DELAY_MS = 30_000; // 30s
const MAX_DELAY_MS = 30 * 60_000; // 30m
const MAX_ATTEMPTS = 10;
const DELIVER_TIMEOUT_MS = 5_000; // give up on one POST quickly (machine asleep)

const now = () => new Date().toISOString();

function backoffMs(attempts: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1), MAX_DELAY_MS);
}

export interface Delivery {
  id: string;
  idem_key: string;
  ticket_id: string;
  project: string;
  action: WebhookAction;
  order_text: string | null;
  state: "pending" | "delivered" | "dead";
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  delivered_at: string | null;
}

interface EnqueueInput {
  ticketId: string;
  project: string;
  action: WebhookAction;
  orderText?: string | null;
}

// Enqueue a delivery if the bridge is enabled. Returns the (new or existing
// pending) row, or null when the feature is off. Dedupe: an identical intent
// already waiting to be delivered — same (ticket, action, order_text) in the
// `pending` state — is reused instead of duplicated. Once a row is delivered,
// a fresh move re-enqueues, so re-entering Ready later fires again.
export function enqueueDelivery(input: EnqueueInput): Delivery | null {
  if (!isBridgeEnabled()) return null;
  const db = getDb();
  const orderText = input.orderText ?? null;
  const existing = db
    .prepare(
      `SELECT * FROM webhook_deliveries
       WHERE ticket_id=? AND action=? AND IFNULL(order_text,'')=IFNULL(?,'')
         AND state='pending'`
    )
    .get(input.ticketId, input.action, orderText) as Delivery | undefined;
  if (existing) return existing;

  const ts = now();
  const row: Delivery = {
    id: nanoid(12),
    idem_key: nanoid(16),
    ticket_id: input.ticketId,
    project: input.project,
    action: input.action,
    order_text: orderText,
    state: "pending",
    attempts: 0,
    next_attempt_at: ts, // due immediately
    last_error: null,
    created_at: ts,
    updated_at: ts,
    delivered_at: null,
  };
  db.prepare(
    `INSERT INTO webhook_deliveries
       (id, idem_key, ticket_id, project, action, order_text, state, attempts,
        next_attempt_at, last_error, created_at, updated_at, delivered_at)
     VALUES (@id,@idem_key,@ticket_id,@project,@action,@order_text,@state,@attempts,
             @next_attempt_at,@last_error,@created_at,@updated_at,@delivered_at)`
  ).run(row);
  return row;
}

// POST one delivery to the listener. Resolves true on HTTP 202 (delivered),
// false on any other outcome (non-202, timeout, refused). Never throws.
async function postOne(cfg: BridgeConfig, row: Delivery): Promise<{ ok: boolean; error?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DELIVER_TIMEOUT_MS);
  try {
    const res = await fetch(`${cfg.url}/take`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Secret": cfg.secret },
      body: JSON.stringify({
        id: row.ticket_id,
        project: row.project,
        action: row.action,
        ...(row.order_text != null ? { order: row.order_text } : {}),
      }),
      signal: ctrl.signal,
    });
    if (res.status === 202) return { ok: true };
    return { ok: false, error: `listener responded ${res.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? String(e) };
  } finally {
    clearTimeout(timer);
  }
}

function markDelivered(id: string) {
  const ts = now();
  getDb()
    .prepare(
      "UPDATE webhook_deliveries SET state='delivered', delivered_at=?, updated_at=?, last_error=NULL WHERE id=?"
    )
    .run(ts, ts, id);
}

function markRetry(row: Delivery, error: string) {
  const attempts = row.attempts + 1;
  const ts = now();
  if (attempts >= MAX_ATTEMPTS) {
    getDb()
      .prepare(
        "UPDATE webhook_deliveries SET state='dead', attempts=?, last_error=?, updated_at=? WHERE id=?"
      )
      .run(attempts, error, ts, row.id);
    return;
  }
  const next = new Date(Date.now() + backoffMs(attempts)).toISOString();
  getDb()
    .prepare(
      "UPDATE webhook_deliveries SET attempts=?, next_attempt_at=?, last_error=?, updated_at=? WHERE id=?"
    )
    .run(attempts, next, error, ts, row.id);
}

export interface ProcessResult {
  attempted: number;
  delivered: number;
  retried: number;
  dead: number;
}

// Drain every due pending delivery once. Safe to call repeatedly (after an
// enqueue, and on a Pi-side cron via /api/cc-bridge/tick). No-op when off.
export async function processQueue(limit = 50): Promise<ProcessResult> {
  const cfg = bridgeConfig();
  const result: ProcessResult = { attempted: 0, delivered: 0, retried: 0, dead: 0 };
  if (!cfg) return result;
  const due = getDb()
    .prepare(
      "SELECT * FROM webhook_deliveries WHERE state='pending' AND next_attempt_at<=? ORDER BY next_attempt_at LIMIT ?"
    )
    .all(now(), limit) as Delivery[];
  for (const row of due) {
    result.attempted++;
    const r = await postOne(cfg, row);
    if (r.ok) {
      markDelivered(row.id);
      result.delivered++;
    } else {
      const willDie = row.attempts + 1 >= MAX_ATTEMPTS;
      markRetry(row, r.error ?? "delivery failed");
      if (willDie) result.dead++;
      else result.retried++;
    }
  }
  return result;
}

// Fire-and-forget drain. Used by the synchronous move path so enqueuing a
// webhook never blocks the API response; failures fall to the retry queue.
export function kickDelivery(): void {
  if (!isBridgeEnabled()) return;
  void processQueue().catch((e) => console.error("cc-bridge delivery error:", e));
}

// Constant-time secret check for inbound bridge routes (resume/tick). Throws a
// plain Error (callers map to 403). Misconfig (no secret set) → reject.
export function checkSecret(provided: string | null): boolean {
  const cfg = bridgeConfig();
  if (!cfg || !cfg.secret) return false;
  if (provided == null) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(cfg.secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
