// Pure helpers for the ticket timeline and the inbox: turn activity rows into
// one-line sentences, format ages, merge polled pages, group inbox items.
// No React / DOM here so they stay unit-testable.
import type { ActivityEntry, InboxItem } from "@/lib/types";

// "codex" / "capz-loop🤖" / "someone" (anonymous caller).
export function actorName(e: Pick<ActivityEntry, "actor_username" | "actor_kind">): string {
  const name = e.actor_username ?? "someone";
  return e.actor_kind === "agent" ? `${name}🤖` : name;
}

// Compact age: "just now", "5m ago", "3h ago", "2d ago", then a short date.
export function relativeTime(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(t).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// 980 -> "980", 1234 -> "1.2k", 12000 -> "12k".
export function formatChars(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "?";
  if (v < 1000) return String(v);
  const k = v / 1000;
  return `${k < 10 ? k.toFixed(1).replace(/\.0$/, "") : Math.round(k)}k`;
}

export interface DescribeCtx {
  // Status key -> label from the project's state machine (falls back to key).
  statusLabel?: (key: string) => string;
  // Task id -> display ref (ticket key when known, else the id).
  ticketRef?: (id: string) => string;
}

function fieldChange(name: string, ch: { from: unknown; to: unknown }): string {
  const v = (x: unknown) => (x === null || x === undefined || x === "" ? "none" : String(x));
  switch (name) {
    case "title":
      return `renamed to “${v(ch.to)}”`;
    case "description":
      return `edited the description (${formatChars(ch.from)} → ${formatChars(ch.to)} chars)`;
    case "assignee":
      return ch.to ? `assigned ${v(ch.to)}` : `unassigned ${v(ch.from)}`;
    case "priority":
      return `changed priority ${v(ch.from)} → ${v(ch.to)}`;
    case "question":
      return ch.to === "resolved" ? "resolved a question" : `marked a question ${v(ch.to)}`;
    default:
      return `changed ${name} ${v(ch.from)} → ${v(ch.to)}`;
  }
}

// One-line sentence for a non-comment event, actor first:
// "codex moved Backlog → Doing", "capz-loop🤖 changed priority medium → high".
export function describeActivity(e: ActivityEntry, ctx: DescribeCtx = {}): string {
  const who = actorName(e);
  const label = ctx.statusLabel ?? ((k: string) => k);
  const ref = ctx.ticketRef ?? ((id: string) => id);
  const p = e.payload ?? {};
  switch (e.type) {
    case "created":
      return p.status ? `${who} created this in ${label(p.status)}` : `${who} created this`;
    case "status":
      return `${who} moved ${label(p.from)} → ${label(p.to)}`;
    case "field": {
      const changes = (p.changes ?? {}) as Record<string, { from: unknown; to: unknown }>;
      const parts = Object.entries(changes).map(([k, ch]) => fieldChange(k, ch ?? { from: null, to: null }));
      return parts.length ? `${who} ${parts.join(", ")}` : `${who} edited this`;
    }
    case "link": {
      const rel = String(p.label ?? p.verb ?? "relates to").toLowerCase();
      return `${who} linked: ${rel} ${p.other ? ref(p.other) : "a ticket"}`;
    }
    case "unlink":
      return `${who} removed link (${p.verb ?? "link"}) to ${p.other ? ref(p.other) : "a ticket"}`;
    case "deleted":
      return `${who} moved this to trash`;
    case "restored":
      return `${who} restored this from trash`;
    case "archived":
      return `${who} archived this`;
    case "unarchived":
      return `${who} unarchived this`;
    case "comment":
      return `${who} commented`;
    default:
      return `${who} ${e.type}`;
  }
}

// Merge freshly fetched rows into the timeline: dedupe by id (newer copy wins,
// e.g. a resolved question returned by /resolve), keep seq order, then derive
// question resolution from later rows — an answer replying to it, or a
// "question resolved" field event — since polling with ?since= only returns
// new rows, not the updated resolved_at of old ones.
export function mergeActivity(prev: ActivityEntry[], incoming: ActivityEntry[]): ActivityEntry[] {
  if (incoming.length === 0) return prev;
  const byId = new Map<string, ActivityEntry>();
  for (const e of prev) byId.set(e.id, e);
  for (const e of incoming) byId.set(e.id, e);
  const list = Array.from(byId.values()).sort((a, b) => a.seq - b.seq);

  const resolvedBy = new Map<string, string>();
  for (const e of list) {
    if (e.type === "comment" && e.kind === "answer" && e.reply_to)
      resolvedBy.set(e.reply_to, e.created_at);
    if (e.type === "field" && e.payload?.comment && e.payload?.changes?.question?.to === "resolved")
      resolvedBy.set(e.payload.comment, e.created_at);
  }
  if (resolvedBy.size === 0) return list;
  return list.map((e) =>
    e.type === "comment" && e.kind === "question" && !e.resolved_at && resolvedBy.has(e.id)
      ? { ...e, resolved_at: resolvedBy.get(e.id)! }
      : e
  );
}

// One-line plain-text preview of a markdown body (reply context chips):
// collapses whitespace and drops the common inline markers.
export function excerpt(body: string | null | undefined, n = 80): string {
  const s = (body ?? "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function lastSeq(list: ActivityEntry[]): number {
  return list.reduce((m, e) => (e.seq > m ? e.seq : m), 0);
}

export function isOpenQuestion(e: ActivityEntry): boolean {
  return e.type === "comment" && e.kind === "question" && !e.resolved_at;
}

export interface InboxGroup {
  project_id: string;
  project_name: string;
  items: InboxItem[];
}

// Group open questions by project. Groups are ordered by their oldest question
// (input is oldest first), so the project waiting longest comes first.
export function groupInbox(items: InboxItem[]): InboxGroup[] {
  const groups = new Map<string, InboxGroup>();
  for (const it of items) {
    let g = groups.get(it.project_id);
    if (!g) {
      g = { project_id: it.project_id, project_name: it.project_name, items: [] };
      groups.set(it.project_id, g);
    }
    g.items.push(it);
  }
  return Array.from(groups.values());
}

// Board deep link for a ticket (ticket key preferred, nanoid fallback).
export function ticketHref(it: Pick<ActivityEntry, "project_id" | "task_id" | "ticket_key">): string {
  const sp = new URLSearchParams({ project: it.project_id, task: it.ticket_key ?? it.task_id });
  return `/?${sp.toString()}`;
}
