import { describe, expect, it } from "vitest";
import type { ActivityEntry, InboxItem } from "@/lib/types";
import {
  actorName,
  describeActivity,
  excerpt,
  formatChars,
  groupInbox,
  isOpenQuestion,
  lastSeq,
  mergeActivity,
  relativeTime,
  ticketHref,
} from "./activity-logic";

let seq = 0;
function entry(extra: Partial<ActivityEntry> = {}): ActivityEntry {
  seq += 1;
  return {
    seq,
    id: `a${seq}`,
    task_id: "t1",
    project_id: "p1",
    type: "comment",
    kind: "note",
    body: "hi",
    reply_to: null,
    payload: null,
    resolved_at: null,
    created_at: "2026-11-02T10:00:00.000Z",
    actor_id: "u1",
    actor_username: "codex",
    actor_kind: "human",
    ...extra,
  };
}

const labels: Record<string, string> = { backlog: "Backlog", doing: "Doing" };
const ctx = {
  statusLabel: (k: string) => labels[k] ?? k,
  ticketRef: (id: string) => (id === "t9" ? "PM-0009" : id),
};

describe("actorName", () => {
  it("marks agents and handles anonymous", () => {
    expect(actorName({ actor_username: "capz-loop", actor_kind: "agent" })).toBe("capz-loop🤖");
    expect(actorName({ actor_username: "codex", actor_kind: "human" })).toBe("codex");
    expect(actorName({ actor_username: null, actor_kind: null })).toBe("someone");
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-11-02T12:00:00.000Z");
  it("formats buckets", () => {
    expect(relativeTime("2026-11-02T11:59:50.000Z", now)).toBe("just now");
    expect(relativeTime("2026-11-02T11:55:00.000Z", now)).toBe("5m ago");
    expect(relativeTime("2026-11-02T09:00:00.000Z", now)).toBe("3h ago");
    expect(relativeTime("2026-10-31T12:00:00.000Z", now)).toBe("2d ago");
  });
  it("clamps future times and tolerates junk", () => {
    expect(relativeTime("2026-11-02T12:05:00.000Z", now)).toBe("just now");
    expect(relativeTime("nope", now)).toBe("");
  });
  it("falls back to a date for old rows", () => {
    expect(relativeTime("2026-01-01T12:00:00.000Z", now)).toMatch(/2026/);
  });
});

describe("formatChars", () => {
  it("abbreviates thousands", () => {
    expect(formatChars(980)).toBe("980");
    expect(formatChars(1000)).toBe("1k");
    expect(formatChars(1234)).toBe("1.2k");
    expect(formatChars(12345)).toBe("12k");
    expect(formatChars(undefined)).toBe("?");
  });
});

describe("describeActivity", () => {
  it("status moves use labels", () => {
    expect(
      describeActivity(entry({ type: "status", payload: { from: "backlog", to: "doing" } }), ctx)
    ).toBe("codex moved Backlog → Doing");
  });
  it("created", () => {
    expect(describeActivity(entry({ type: "created", payload: { status: "backlog" } }), ctx)).toBe(
      "codex created this in Backlog"
    );
  });
  it("field changes, agent marker, joined", () => {
    const e = entry({
      type: "field",
      actor_username: "capz-loop",
      actor_kind: "agent",
      payload: {
        changes: {
          priority: { from: "medium", to: "high" },
          description: { from: 1200, to: 1400 },
        },
      },
    });
    expect(describeActivity(e, ctx)).toBe(
      "capz-loop🤖 changed priority medium → high, edited the description (1.2k → 1.4k chars)"
    );
  });
  it("assignee, title and question", () => {
    expect(
      describeActivity(entry({ type: "field", payload: { changes: { assignee: { from: null, to: "alice" } } } }), ctx)
    ).toBe("codex assigned alice");
    expect(
      describeActivity(entry({ type: "field", payload: { changes: { assignee: { from: "alice", to: null } } } }), ctx)
    ).toBe("codex unassigned alice");
    expect(
      describeActivity(entry({ type: "field", payload: { changes: { title: { from: "a", to: "b" } } } }), ctx)
    ).toBe("codex renamed to “b”");
    expect(
      describeActivity(
        entry({ type: "field", payload: { changes: { question: { from: "open", to: "resolved" } } } }),
        ctx
      )
    ).toBe("codex resolved a question");
  });
  it("links resolve the other ticket's key", () => {
    expect(
      describeActivity(entry({ type: "link", payload: { verb: "blocks", label: "Blocks", other: "t9" } }), ctx)
    ).toBe("codex linked: blocks PM-0009");
    expect(
      describeActivity(entry({ type: "unlink", payload: { verb: "relates", other: "zz" } }), ctx)
    ).toBe("codex removed link (relates) to zz");
  });
  it("lifecycle events", () => {
    expect(describeActivity(entry({ type: "deleted" }), ctx)).toBe("codex moved this to trash");
    expect(describeActivity(entry({ type: "archived", actor_username: null, actor_kind: null }), ctx)).toBe(
      "someone archived this"
    );
  });
});

describe("mergeActivity", () => {
  it("dedupes by id, sorts by seq, newer copy wins", () => {
    const a = entry();
    const b = entry();
    const merged = mergeActivity([b], [a, { ...b, body: "edited" }]);
    expect(merged.map((e) => e.id)).toEqual([a.id, b.id]);
    expect(merged[1].body).toBe("edited");
    expect(lastSeq(merged)).toBe(b.seq);
  });
  it("marks a question resolved when an answer arrives", () => {
    const q = entry({ kind: "question" });
    expect(isOpenQuestion(q)).toBe(true);
    const ans = entry({ kind: "answer", reply_to: q.id, created_at: "2026-11-02T11:00:00.000Z" });
    const merged = mergeActivity([q], [ans]);
    expect(merged[0].resolved_at).toBe(ans.created_at);
    expect(isOpenQuestion(merged[0])).toBe(false);
  });
  it("marks a question resolved from a resolve event", () => {
    const q = entry({ kind: "question" });
    const ev = entry({
      type: "field",
      kind: null,
      body: null,
      payload: { changes: { question: { from: "open", to: "resolved" } }, comment: q.id },
    });
    expect(mergeActivity([q], [ev])[0].resolved_at).toBe(ev.created_at);
  });
  it("returns prev unchanged for an empty page", () => {
    const prev = [entry()];
    expect(mergeActivity(prev, [])).toBe(prev);
  });
});

describe("groupInbox / ticketHref", () => {
  const item = (pid: string, name: string, extra: Partial<InboxItem> = {}): InboxItem => ({
    ...entry({ kind: "question", project_id: pid }),
    project_name: name,
    task_status: "doing",
    task_assignee: null,
    ...extra,
  });
  it("groups preserving oldest-first project order", () => {
    const groups = groupInbox([item("p2", "Two"), item("p1", "One"), item("p2", "Two")]);
    expect(groups.map((g) => [g.project_name, g.items.length])).toEqual([
      ["Two", 2],
      ["One", 1],
    ]);
  });
  it("links to the board with the ticket key, else id", () => {
    expect(ticketHref({ project_id: "p1", task_id: "t1", ticket_key: "PM-0002" })).toBe(
      "/?project=p1&task=PM-0002"
    );
    expect(ticketHref({ project_id: "p1", task_id: "t1", ticket_key: null })).toBe("/?project=p1&task=t1");
  });
});

describe("excerpt", () => {
  it("strips inline markdown and truncates", () => {
    expect(excerpt("Store **server-side** or `cookie`?\n\n[docs](http://x)")).toBe(
      "Store server-side or cookie? docs"
    );
    expect(excerpt("a".repeat(100), 10)).toBe("aaaaaaaaa…");
    expect(excerpt(null)).toBe("");
  });
});
