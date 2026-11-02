import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let repo: typeof import("./repo");
let human: string;
let agent: string;

beforeAll(async () => {
  process.env.PM_DB_PATH = join(mkdtempSync(join(tmpdir(), "pm-activity-")), "test.db");
  repo = await import("./repo");
  human = repo.createUser("act-human", "pw").id;
  agent = repo.createUser("act-agent", "pw", "agent").id;
});

function repoProject(name: string) {
  const p = repo.createProject(name);
  repo.updateProject(p.id, { remote_repo_url: "git@github.com:me/x.git", confirm: true });
  return p;
}

describe("activity log", () => {
  it("records create, field changes, moves, links, delete/restore with the actor", () => {
    const p = repo.createProject("act-log");
    const t = repo.createTask(p.id, { title: "a", creatorId: human });
    repo.updateTask(t.id, { title: "b", description: "x".repeat(50), priority: "high" }, { actorId: agent });
    repo.moveTask(t.id, "todo", { actorId: human });
    repo.moveTask(t.id, "todo", { actorId: human }); // no-op: not logged
    const other = repo.createTask(p.id, { title: "other" });
    repo.createLink(t.id, other.id, "blocks", { actorId: agent });
    repo.softDeleteTask(t.id, { actorId: agent });
    repo.restoreTask(t.id, { actorId: human });

    const log = repo.listActivity(t.id);
    expect(log.map((e) => e.type)).toEqual(["created", "field", "status", "link", "deleted", "restored"]);
    expect(log[0]).toMatchObject({ actor_username: "act-human", payload: { status: "backlog" } });
    expect(log[1].payload.changes).toMatchObject({
      title: { from: "a", to: "b" },
      description: { from: 0, to: 50 },
      priority: { from: "medium", to: "high" },
    });
    expect(log[1].actor_kind).toBe("agent");
    expect(log[2].payload).toEqual({ from: "backlog", to: "todo" });
    expect(log.every((e) => e.ticket_key === t.ticket_key)).toBe(true);

    // cursor: only what came after a given seq
    expect(repo.listActivity(t.id, { since: log[3].seq }).map((e) => e.type)).toEqual(["deleted", "restored"]);
  });
});

describe("comments and inbox", () => {
  it("a question shows in the inbox until an answer resolves it", () => {
    const p = repo.createProject("act-inbox");
    const t = repo.createTask(p.id, { title: "needs input", assignee: "act-agent" });
    const q = repo.addComment(t.id, { body: "Which port?", kind: "question" }, { actorId: agent });
    expect(q).toMatchObject({ type: "comment", kind: "question", resolved_at: null, actor_username: "act-agent" });
    expect(repo.listInbox({ project: p.id }).map((i) => i.id)).toEqual([q.id]);
    expect(repo.listInbox({ project: p.id })[0]).toMatchObject({ project_name: "act-inbox", task_title: "needs input" });

    const a = repo.addComment(t.id, { body: "3000", kind: "answer", reply_to: q.id }, { actorId: human });
    expect(a.reply_to).toBe(q.id);
    expect(repo.listInbox({ project: p.id })).toEqual([]);
    expect(repo.getActivity(q.id).resolved_at).not.toBeNull();
  });

  it("resolveComment closes a question without an answer", () => {
    const p = repo.createProject("act-resolve");
    const t = repo.createTask(p.id, { title: "x" });
    const q = repo.addComment(t.id, { body: "?", kind: "question" });
    expect(repo.resolveComment(q.id, { actorId: human }).resolved_at).not.toBeNull();
    expect(repo.listInbox({ project: p.id })).toEqual([]);
    const note = repo.addComment(t.id, { body: "fyi" });
    expect(() => repo.resolveComment(note.id)).toThrow(/only questions/);
  });

  it("validates body, kind and reply_to", () => {
    const p = repo.createProject("act-validate");
    const t = repo.createTask(p.id, { title: "x" });
    const other = repo.createTask(p.id, { title: "y" });
    const q = repo.addComment(other.id, { body: "q", kind: "question" });
    expect(() => repo.addComment(t.id, { body: "  " })).toThrow(/body is required/);
    expect(() => repo.addComment(t.id, { body: "x", kind: "rant" })).toThrow(/unknown comment kind/);
    expect(() => repo.addComment(t.id, { body: "x", kind: "answer", reply_to: q.id })).toThrow(/not found/);
  });

  it("listEvents is a cross-ticket cursor feed", () => {
    const p = repo.createProject("act-events");
    const start = repo.listEvents({ project: p.id }).length;
    const t = repo.createTask(p.id, { title: "e" });
    repo.addComment(t.id, { body: "hi" });
    const ev = repo.listEvents({ project: p.id });
    expect(ev.length - start).toBe(2);
    expect(repo.listEvents({ since: ev[ev.length - 1].seq })).toEqual([]);
  });
});

describe("ready gate and ready_status_key", () => {
  it("only lists tickets a human moved into ready", () => {
    const p = repoProject("gate-human");
    const byHuman = repo.createTask(p.id, { title: "accepted" });
    repo.moveTask(byHuman.id, "todo", { actorId: human });
    const byAgent = repo.createTask(p.id, { title: "self-approved" });
    repo.moveTask(byAgent.id, "todo", { actorId: agent });
    const ids = repo.listReadyTickets({ projectRef: p.id }).map((r) => r.ticket);
    expect(ids).toContain(byHuman.id);
    expect(ids).not.toContain(byAgent.id);

    // a human re-accepting it (out and back in) makes it ready
    repo.addTransition(p.id, "todo", "backlog");
    repo.moveTask(byAgent.id, "backlog", { actorId: human });
    repo.moveTask(byAgent.id, "todo", { actorId: human });
    expect(repo.listReadyTickets({ projectRef: p.id }).map((r) => r.ticket)).toContain(byAgent.id);
  });

  it("grandfathers tickets whose history predates the activity log", async () => {
    const { getDb } = await import("./db");
    const p = repoProject("gate-legacy");
    const t = repo.createTask(p.id, { title: "old" });
    repo.moveTask(t.id, "todo", { actorId: agent });
    getDb().prepare("DELETE FROM task_activity WHERE task_id=?").run(t.id);
    expect(repo.listReadyTickets({ projectRef: p.id }).map((r) => r.ticket)).toContain(t.id);
  });

  it("uses the project's ready_status_key for /ready and the agent create gate", () => {
    const p = repoProject("gate-custom");
    repo.addStatus(p.id, { key: "open", label: "Open" });
    repo.addTransition(p.id, "backlog", "open");
    repo.updateProject(p.id, { ready_status_key: "open" });
    const t = repo.createTask(p.id, { title: "custom" });
    repo.moveTask(t.id, "open", { actorId: human });
    expect(repo.listReadyTickets({ projectRef: p.id }).map((r) => r.ticket)).toEqual([t.id]);
    expect(() => repo.createTask(p.id, { title: "x", status: "open", actorKind: "agent" })).toThrow(/only a human/);
    // todo is no longer the gate here
    expect(repo.createTask(p.id, { title: "y", status: "todo", actorKind: "agent" }).status_key).toBe("todo");
    expect(() => repo.updateProject(p.id, { ready_status_key: "nope" })).toThrow(/unknown status/);
  });
});
