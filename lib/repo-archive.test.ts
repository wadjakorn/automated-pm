import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Throwaway DB before importing the repo (it reads PM_DB_PATH at load time).
let repo: typeof import("./repo");

beforeAll(async () => {
  process.env.PM_DB_PATH = join(mkdtempSync(join(tmpdir(), "pm-arch-")), "test.db");
  repo = await import("./repo");
});

// Walk the default chain backlog→todo→doing→completed→tested→released so the
// task ends in the (final) released status, where archiving is allowed.
function toReleased(taskId: string) {
  for (const s of ["todo", "doing", "completed", "tested", "released"]) {
    repo.moveTask(taskId, s);
  }
}

describe("task archive", () => {
  it("archives a final-status ticket and hides it from the board", () => {
    const p = repo.createProject("arch-basic");
    const t = repo.createTask(p.id, { title: "done" });
    toReleased(t.id);
    const a = repo.archiveTask(t.id);
    expect(a.archived_at).toBeTruthy();
    // gone from the default (board) listing…
    expect(repo.listTasks(p.id).map((x) => x.id)).not.toContain(t.id);
    // …but visible when archived are included.
    expect(
      repo.listTasks(p.id, { includeArchived: true }).map((x) => x.id)
    ).toContain(t.id);
  });

  it("refuses to archive a non-final ticket", () => {
    const p = repo.createProject("arch-guard");
    const t = repo.createTask(p.id, { title: "wip" }); // backlog, not final
    expect(() => repo.archiveTask(t.id)).toThrow(/final/i);
  });

  it("keeps an archived ticket reachable by direct getTask (link survives)", () => {
    const p = repo.createProject("arch-link");
    const t = repo.createTask(p.id, { title: "filed" });
    toReleased(t.id);
    repo.archiveTask(t.id);
    expect(repo.getTask(t.id).id).toBe(t.id);
  });

  it("unarchive returns the ticket to the board", () => {
    const p = repo.createProject("arch-unarchive");
    const t = repo.createTask(p.id, { title: "back" });
    toReleased(t.id);
    repo.archiveTask(t.id);
    repo.unarchiveTask(t.id);
    expect(repo.getTask(t.id).archived_at).toBeNull();
    expect(repo.listTasks(p.id).map((x) => x.id)).toContain(t.id);
  });

  it("bulk-archives every live ticket in a final column", () => {
    const p = repo.createProject("arch-bulk");
    const ids = ["a", "b", "c"].map((title) => {
      const t = repo.createTask(p.id, { title });
      toReleased(t.id);
      return t.id;
    });
    const { archived } = repo.bulkArchiveColumn(p.id, "released");
    expect(archived.map((x) => x.id).sort()).toEqual([...ids].sort());
    expect(repo.listTasks(p.id, { status: "released" })).toHaveLength(0);
  });

  it("rejects bulk archive on a non-final column", () => {
    const p = repo.createProject("arch-bulk-guard");
    expect(() => repo.bulkArchiveColumn(p.id, "todo")).toThrow(/not a final status/i);
  });

  it("archive and trash are independent: archived stays out of trash listing", () => {
    const p = repo.createProject("arch-vs-trash");
    const t = repo.createTask(p.id, { title: "filed" });
    toReleased(t.id);
    repo.archiveTask(t.id);
    // includeDeleted should NOT surface an archived (but not deleted) ticket.
    const deletedListing = repo
      .listTasks(p.id, { includeDeleted: true })
      .filter((x) => x.deleted_at);
    expect(deletedListing.map((x) => x.id)).not.toContain(t.id);
  });
});
