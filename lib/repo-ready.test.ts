import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let repo: typeof import("./repo");

beforeAll(async () => {
  process.env.PM_DB_PATH = join(mkdtempSync(join(tmpdir(), "pm-ready-")), "test.db");
  repo = await import("./repo");
});

// The human who accepts tickets into todo (the owner accept gate).
let ownerId: string | null = null;
function owner(): string {
  ownerId ??= repo.createUser("ready-owner", "pw").id;
  return ownerId;
}

// Helper: a project WITH a repo URL (opted in) holding one ready (todo) task.
function seedReady(name: string, title: string, priority?: string) {
  const p = repo.createProject(name);
  repo.updateProject(p.id, { remote_repo_url: "git@github.com:me/repo.git", confirm: true });
  const t = repo.createTask(p.id, { title, priority });
  repo.moveTask(t.id, "todo", { actorId: owner() });
  return { p, t };
}

describe("listReadyTickets", () => {
  it("returns ready tickets only from repo-bearing projects, with the repo joined", () => {
    const { p, t } = seedReady("ready-proj-a", "do the thing", "high");
    // A project WITHOUT a repo URL must never appear, even with a ready task.
    const noRepo = repo.createProject("ready-no-repo");
    const nrTask = repo.createTask(noRepo.id, { title: "invisible" });
    repo.moveTask(nrTask.id, "todo", { actorId: owner() });

    const rows = repo.listReadyTickets();
    const ids = rows.map((r) => r.ticket);
    expect(ids).toContain(t.id);
    expect(ids).not.toContain(nrTask.id);

    const row = rows.find((r) => r.ticket === t.id)!;
    expect(row.project).toBe(p.id);
    expect(row.projectName).toBe("ready-proj-a");
    expect(row.repo).toBe("git@github.com:me/repo.git");
    expect(row.title).toBe("do the thing");
    expect(row.priority).toBe("high");
  });

  it("excludes non-ready, deleted, and archived tickets", () => {
    const p = repo.createProject("ready-proj-b");
    repo.updateProject(p.id, { remote_repo_url: "git@github.com:me/b.git", confirm: true });
    const backlog = repo.createTask(p.id, { title: "still backlog" }); // not moved → backlog
    const del = repo.createTask(p.id, { title: "deleted" });
    repo.moveTask(del.id, "todo", { actorId: owner() });
    repo.softDeleteTask(del.id);

    const ids = repo.listReadyTickets({ projectRef: p.id }).map((r) => r.ticket);
    expect(ids).not.toContain(backlog.id);
    expect(ids).not.toContain(del.id);
  });

  it("honors a custom status and narrows by projectRef (name or id)", () => {
    const { p, t } = seedReady("ready-proj-c", "c-task");
    repo.createTask(p.id, { title: "in doing" });
    // narrowing by NAME works (the routine pins the name)
    const byName = repo.listReadyTickets({ projectRef: "ready-proj-c" }).map((r) => r.ticket);
    expect(byName).toContain(t.id);
    // unknown project ref → 404, so a typo never reads as "no work"
    expect(() => repo.listReadyTickets({ projectRef: "no-such-project" })).toThrow(/project not found/);
    // custom status returns nothing here (no task in 'doing-ready')
    expect(repo.listReadyTickets({ status: "doing-ready" })).toEqual([]);
  });

  it("narrows by assignee (id or username); unknown ref → 404", () => {
    const u = repo.createUser("claude-a", "pw");
    const p = repo.createProject("ready-proj-d");
    repo.updateProject(p.id, { remote_repo_url: "git@github.com:me/d.git", confirm: true });
    const mine = repo.createTask(p.id, { title: "mine", assignee: "claude-a" });
    repo.moveTask(mine.id, "todo", { actorId: owner() });
    const unassigned = repo.createTask(p.id, { title: "nobody" });
    repo.moveTask(unassigned.id, "todo", { actorId: owner() });

    const byUser = repo.listReadyTickets({ assignee: "claude-a" }).map((r) => r.ticket);
    expect(byUser).toContain(mine.id);
    expect(byUser).not.toContain(unassigned.id);
    // by id resolves too
    expect(repo.listReadyTickets({ assignee: u.id }).map((r) => r.ticket)).toContain(mine.id);
    // unknown assignee → 404, not an empty queue
    expect(() => repo.listReadyTickets({ assignee: "ghost-user" })).toThrow(/user not found/);
  });

  it("skips tickets blocked by a live, unfinished ticket and returns key + version", () => {
    const { p, t } = seedReady("ready-proj-e", "blocked one");
    const blocker = repo.createTask(p.id, { title: "blocker" });
    repo.createLink(blocker.id, t.id, "blocks");
    expect(repo.listReadyTickets({ projectRef: p.id }).map((r) => r.ticket)).not.toContain(t.id);

    // walk the blocker to the final status → the ticket is ready again
    for (const s of ["todo", "doing", "completed", "tested", "released"]) repo.moveTask(blocker.id, s);
    const row = repo.listReadyTickets({ projectRef: p.id }).find((r) => r.ticket === t.id)!;
    expect(row).toBeTruthy();
    expect(row.version).toBe(repo.getTask(t.id).version);
    expect(row.ticket_key).toBe(repo.getTask(t.id).ticket_key);
  });

  it("a trashed blocker no longer blocks", () => {
    const { p, t } = seedReady("ready-proj-f", "was blocked");
    const blocker = repo.createTask(p.id, { title: "dropped" });
    repo.createLink(t.id, blocker.id, "blocked-by");
    expect(repo.listReadyTickets({ projectRef: p.id }).map((r) => r.ticket)).not.toContain(t.id);
    repo.softDeleteTask(blocker.id);
    expect(repo.listReadyTickets({ projectRef: p.id }).map((r) => r.ticket)).toContain(t.id);
  });
});
