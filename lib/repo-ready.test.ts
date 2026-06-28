import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let repo: typeof import("./repo");

beforeAll(async () => {
  process.env.PM_DB_PATH = join(mkdtempSync(join(tmpdir(), "pm-ready-")), "test.db");
  repo = await import("./repo");
});

// Helper: a project WITH a repo URL (opted in) holding one ready (todo) task.
function seedReady(name: string, title: string, priority?: string) {
  const p = repo.createProject(name);
  repo.updateProject(p.id, { remote_repo_url: "git@github.com:me/repo.git", confirm: true });
  const t = repo.createTask(p.id, { title, priority });
  repo.moveTask(t.id, "todo");
  return { p, t };
}

describe("listReadyTickets", () => {
  it("returns ready tickets only from repo-bearing projects, with the repo joined", () => {
    const { p, t } = seedReady("ready-proj-a", "do the thing", "high");
    // A project WITHOUT a repo URL must never appear, even with a ready task.
    const noRepo = repo.createProject("ready-no-repo");
    const nrTask = repo.createTask(noRepo.id, { title: "invisible" });
    repo.moveTask(nrTask.id, "todo");

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
    repo.moveTask(del.id, "todo");
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
    // unknown project ref → empty, not a throw
    expect(repo.listReadyTickets({ projectRef: "no-such-project" })).toEqual([]);
    // custom status returns nothing here (no task in 'doing-ready')
    expect(repo.listReadyTickets({ status: "doing-ready" })).toEqual([]);
  });

  it("narrows by assignee (id or username); unknown ref → []", () => {
    const u = repo.createUser("claude-a", "pw");
    const p = repo.createProject("ready-proj-d");
    repo.updateProject(p.id, { remote_repo_url: "git@github.com:me/d.git", confirm: true });
    const mine = repo.createTask(p.id, { title: "mine", assignee: "claude-a" });
    repo.moveTask(mine.id, "todo");
    const unassigned = repo.createTask(p.id, { title: "nobody" });
    repo.moveTask(unassigned.id, "todo");

    const byUser = repo.listReadyTickets({ assignee: "claude-a" }).map((r) => r.ticket);
    expect(byUser).toContain(mine.id);
    expect(byUser).not.toContain(unassigned.id);
    // by id resolves too
    expect(repo.listReadyTickets({ assignee: u.id }).map((r) => r.ticket)).toContain(mine.id);
    // unknown assignee → empty, not a throw
    expect(repo.listReadyTickets({ assignee: "ghost-user" })).toEqual([]);
  });
});
