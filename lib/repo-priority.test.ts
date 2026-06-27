import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Throwaway DB before importing the repo (it reads PM_DB_PATH at load time).
let repo: typeof import("./repo");

beforeAll(async () => {
  process.env.PM_DB_PATH = join(mkdtempSync(join(tmpdir(), "pm-prio-")), "test.db");
  repo = await import("./repo");
});

describe("task priority", () => {
  it("defaults a new task to medium", () => {
    const p = repo.createProject("prio-default");
    const t = repo.createTask(p.id, { title: "x" });
    expect(t.priority).toBe("medium");
  });

  it("accepts a valid priority on create and rejects an invalid one", () => {
    const p = repo.createProject("prio-create");
    expect(repo.createTask(p.id, { title: "hot", priority: "now" }).priority).toBe("now");
    expect(() =>
      repo.createTask(p.id, { title: "bad", priority: "urgent" })
    ).toThrow(/unknown priority/i);
  });

  it("updates priority and rejects an invalid value", () => {
    const p = repo.createProject("prio-update");
    const t = repo.createTask(p.id, { title: "y" });
    expect(repo.updateTask(t.id, { priority: "high" }).priority).toBe("high");
    // omitting priority leaves it unchanged
    expect(repo.updateTask(t.id, { title: "y2" }).priority).toBe("high");
    expect(() => repo.updateTask(t.id, { priority: "nope" })).toThrow(/unknown priority/i);
  });

  it("lists a status column sorted now → high → medium → low", () => {
    const p = repo.createProject("prio-sort");
    // create out of priority order; all land in the first (backlog) status
    repo.createTask(p.id, { title: "L", priority: "low" });
    repo.createTask(p.id, { title: "N", priority: "now" });
    repo.createTask(p.id, { title: "M", priority: "medium" });
    repo.createTask(p.id, { title: "H", priority: "high" });
    const order = repo.listTasks(p.id).map((t) => t.title);
    expect(order).toEqual(["N", "H", "M", "L"]);
  });

  it("filters by priority", () => {
    const p = repo.createProject("prio-filter");
    repo.createTask(p.id, { title: "a", priority: "now" });
    repo.createTask(p.id, { title: "b", priority: "low" });
    const nows = repo.listTasks(p.id, { priority: "now" });
    expect(nows.map((t) => t.title)).toEqual(["a"]);
  });
});
