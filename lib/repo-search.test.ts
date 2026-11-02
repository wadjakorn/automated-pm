import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let repo: typeof import("./repo");

beforeAll(async () => {
  process.env.PM_DB_PATH = join(mkdtempSync(join(tmpdir(), "pm-search-")), "test.db");
  repo = await import("./repo");
});

const ids = (hits: { task: { id: string } }[]) => hits.map((h) => h.task.id);

describe("searchTasks", () => {
  it("finds by title, description and comment text across projects, ranked title first", () => {
    const a = repo.createProject("srch-a");
    const b = repo.createProject("srch-b");
    const byTitle = repo.createTask(a.id, { title: "Webhook retries" });
    const byDesc = repo.createTask(b.id, { title: "Other", description: "retry the webhook with backoff" });
    const byComment = repo.createTask(b.id, { title: "Third" });
    repo.addComment(byComment.id, { body: "the webhook endpoint returns 502" });
    const hits = repo.searchTasks({ q: "webhook" });
    expect(ids(hits)).toEqual(expect.arrayContaining([byTitle.id, byDesc.id, byComment.id]));
    expect(hits[0].task.id).toBe(byTitle.id);
    expect(hits.find((h) => h.task.id === byComment.id)?.snippet).toContain("[webhook]");
    expect(hits.find((h) => h.task.id === byDesc.id)?.project_name).toBe("srch-b");
  });

  it("matches Thai substrings and keeps the index in sync with edits", () => {
    const p = repo.createProject("srch-th");
    const t = repo.createTask(p.id, { title: "แก้บั๊กหน้า login ไม่ขึ้น" });
    expect(ids(repo.searchTasks({ q: "บั๊ก" }))).toContain(t.id);
    repo.updateTask(t.id, { title: "ปรับสีปุ่ม" });
    expect(ids(repo.searchTasks({ q: "บั๊ก" }))).not.toContain(t.id);
    expect(ids(repo.searchTasks({ q: "สีปุ่ม" }))).toContain(t.id);
  });

  it("all terms must match; short terms filter titles", () => {
    const p = repo.createProject("srch-and");
    const both = repo.createTask(p.id, { title: "CI deploy pipeline" });
    const one = repo.createTask(p.id, { title: "deploy docs" });
    expect(ids(repo.searchTasks({ q: "deploy pipeline", project: p.id }))).toEqual([both.id]);
    expect(ids(repo.searchTasks({ q: "CI deploy", project: p.id }))).toEqual([both.id]);
    expect(ids(repo.searchTasks({ q: "deploy", project: p.id })).sort()).toEqual([both.id, one.id].sort());
  });

  it("puts an exact ticket key first, includes archived, hides deleted unless asked", () => {
    const p = repo.createProject("srch-key");
    repo.updateProject(p.id, { ticket_prefix: "SK" });
    const t = repo.createTask(p.id, { title: "keyed" });
    expect(repo.searchTasks({ q: "SK-0001" })[0].task.id).toBe(t.id);

    for (const s of ["todo", "doing", "completed", "tested", "released"]) repo.moveTask(t.id, s);
    repo.archiveTask(t.id);
    expect(ids(repo.searchTasks({ q: "keyed" }))).toContain(t.id);
    repo.unarchiveTask(t.id);
    repo.softDeleteTask(t.id);
    expect(ids(repo.searchTasks({ q: "keyed" }))).not.toContain(t.id);
    expect(ids(repo.searchTasks({ q: "keyed", includeDeleted: true }))).toContain(t.id);
  });

  it("requires q and treats FTS syntax in the query as plain text", () => {
    expect(() => repo.searchTasks({ q: "  " })).toThrow(/q is required/);
    expect(repo.searchTasks({ q: 'bad"quote AND (' })).toEqual([]);
  });
});

describe("overview", () => {
  it("lists my open tickets across projects, agents at work with stale flag, and the inbox count", async () => {
    const { getDb } = await import("./db");
    const me = repo.createUser("ov-me", "pw");
    const bot = repo.createUser("ov-bot", "pw", "agent");
    const p1 = repo.createProject("ov-1");
    const p2 = repo.createProject("ov-2");
    const mine1 = repo.createTask(p1.id, { title: "m1", assignee: "ov-me", priority: "low" });
    const mine2 = repo.createTask(p2.id, { title: "m2", assignee: "ov-me", priority: "now" });
    const done = repo.createTask(p2.id, { title: "done", assignee: "ov-me" });
    for (const s of ["todo", "doing", "completed", "tested", "released"]) repo.moveTask(done.id, s);
    const work = repo.createTask(p1.id, { title: "agent work", assignee: "ov-bot" });
    repo.moveTask(work.id, "todo");
    repo.moveTask(work.id, "doing");
    const queued = repo.createTask(p1.id, { title: "queued", assignee: "ov-bot" }); // backlog: not "at work"
    getDb().prepare("UPDATE tasks SET updated_at=? WHERE id=?").run("2020-01-01T00:00:00.000Z", work.id);
    repo.addComment(work.id, { body: "?", kind: "question" }, { actorId: bot.id });

    const ov = repo.overview(me.id);
    expect(ov.user?.username).toBe("ov-me");
    expect(ov.mine.map((t) => t.id)).toEqual([mine2.id, mine1.id]); // priority order, final excluded
    expect(ov.mine[0].project_name).toBe("ov-2");
    const agentIds = ov.agents.map((t) => t.id);
    expect(agentIds).toContain(work.id);
    expect(agentIds).not.toContain(queued.id);
    expect(ov.agents.find((t) => t.id === work.id)?.stale).toBe(true);
    expect(ov.inbox_count).toBeGreaterThanOrEqual(1);
    expect(repo.overview(null).mine).toEqual([]);
  });
});
