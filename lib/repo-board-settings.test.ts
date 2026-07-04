import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Throwaway DB before importing the repo (it reads PM_DB_PATH at load time).
let repo: typeof import("./repo");

beforeAll(async () => {
  process.env.PM_DB_PATH = join(mkdtempSync(join(tmpdir(), "pm-board-")), "test.db");
  repo = await import("./repo");
});

describe("hidden status columns", () => {
  it("new statuses default to hidden = false", () => {
    const p = repo.createProject("hidden-defaults");
    const sm = repo.getStateMachine(p.id);
    expect(sm.statuses.every((s) => s.hidden === false)).toBe(true);
  });

  it("updateStatus toggles hidden and round-trips as a boolean", () => {
    const p = repo.createProject("hidden-toggle");
    const sm = repo.updateStatus(p.id, "backlog", { hidden: true });
    const backlog = sm.statuses.find((s) => s.key === "backlog");
    expect(backlog?.hidden).toBe(true);
    // untouched fields survive the partial update
    expect(backlog?.label).toBe("Backlog");
    const sm2 = repo.updateStatus(p.id, "backlog", { hidden: false });
    expect(sm2.statuses.find((s) => s.key === "backlog")?.hidden).toBe(false);
  });

  it("a task in a hidden status is still listed and movable", () => {
    const p = repo.createProject("hidden-tasks");
    const t = repo.createTask(p.id, { title: "in hidden col" }); // lands in backlog
    repo.updateStatus(p.id, "backlog", { hidden: true });
    const listed = repo.listTasks(p.id);
    expect(listed.map((x) => x.id)).toContain(t.id);
    // still movable out of the hidden column
    const moved = repo.moveTask(t.id, "todo");
    expect(moved.status_key).toBe("todo");
  });
});

describe("configurable default status", () => {
  it("new projects have a null default_status_key", () => {
    const p = repo.createProject("default-null");
    expect(p.default_status_key).toBeNull();
  });

  it("createTask with no status uses the configured default", () => {
    const p = repo.createProject("default-uses");
    repo.updateProject(p.id, { default_status_key: "todo" });
    const t = repo.createTask(p.id, { title: "defaulted" });
    expect(t.status_key).toBe("todo");
  });

  it("an explicit status still wins over the default", () => {
    const p = repo.createProject("default-override");
    repo.updateProject(p.id, { default_status_key: "todo" });
    const t = repo.createTask(p.id, { title: "explicit", status: "doing" });
    expect(t.status_key).toBe("doing");
  });

  it("falls back to the first status when default is null", () => {
    const p = repo.createProject("default-firstfallback");
    const t = repo.createTask(p.id, { title: "first" });
    const sm = repo.getStateMachine(p.id);
    expect(t.status_key).toBe(sm.statuses[0].key);
  });

  it("a stale default (status removed) falls back to the first status", () => {
    const p = repo.createProject("default-stale");
    // add a spare status, set it default, then remove it
    repo.addStatus(p.id, { key: "triage", label: "Triage" });
    repo.updateProject(p.id, { default_status_key: "triage" });
    repo.removeStatus(p.id, "triage"); // no live task uses it → allowed
    const t = repo.createTask(p.id, { title: "stale default" });
    const sm = repo.getStateMachine(p.id);
    expect(t.status_key).toBe(sm.statuses[0].key);
  });

  it("rejects an unknown default status key", () => {
    const p = repo.createProject("default-unknown");
    expect(() =>
      repo.updateProject(p.id, { default_status_key: "nope" })
    ).toThrow(/unknown status/i);
  });

  it("clears the default with an empty string", () => {
    const p = repo.createProject("default-clear");
    repo.updateProject(p.id, { default_status_key: "todo" });
    const u = repo.updateProject(p.id, { default_status_key: "" });
    expect(u.default_status_key).toBeNull();
  });

  it("setting the default does not require confirm", () => {
    const p = repo.createProject("default-noconfirm");
    const u = repo.updateProject(p.id, { default_status_key: "doing" });
    expect(u.default_status_key).toBe("doing");
  });
});
