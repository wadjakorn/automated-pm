import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { summarizeTask, SUMMARY_EXCERPT_CHARS } from "./task-view";

let repo: typeof import("./repo");

beforeAll(async () => {
  process.env.PM_DB_PATH = join(mkdtempSync(join(tmpdir(), "pm-batch-")), "test.db");
  repo = await import("./repo");
});

const anon = { creatorId: null, actorKind: null } as const;

describe("createTasks (batch)", () => {
  it("creates every item in order", () => {
    const p = repo.createProject("batch-ok");
    const made = repo.createTasks(p.id, [{ title: "a" }, { title: "b", priority: "high" }], anon);
    expect(made.map((t) => t.title)).toEqual(["a", "b"]);
    expect(made[1].priority).toBe("high");
  });

  it("is all-or-nothing and names the failing item", () => {
    const p = repo.createProject("batch-rollback");
    expect(() =>
      repo.createTasks(p.id, [{ title: "fine" }, { title: "" }], anon)
    ).toThrow(/tasks\[1\]: title is required/);
    expect(repo.listTasks(p.id)).toHaveLength(0);
  });

  it("applies the ready gate per item", () => {
    const p = repo.createProject("batch-gate");
    expect(() =>
      repo.createTasks(p.id, [{ title: "x", status: "todo" }], { creatorId: null, actorKind: "agent" })
    ).toThrow(/only a human/);
  });

  it("rejects an empty or non-array batch", () => {
    const p = repo.createProject("batch-empty");
    expect(() => repo.createTasks(p.id, [], anon)).toThrow(/non-empty array/);
    expect(() => repo.createTasks(p.id, "nope", anon)).toThrow(/non-empty array/);
  });
});

describe("input type validation", () => {
  it("rejects a non-string title on update and create with a 400", () => {
    const p = repo.createProject("validate");
    const t = repo.createTask(p.id, { title: "ok" });
    let err: any;
    try {
      repo.updateTask(t.id, { title: true as any });
    } catch (e) {
      err = e;
    }
    expect(err?.status).toBe(400);
    expect(() => repo.createTask(p.id, { title: 42 as any })).toThrow(/title must be a string/);
  });

  it("rejects a non-integer version instead of reporting a conflict", () => {
    const p = repo.createProject("validate-version");
    const t = repo.createTask(p.id, { title: "ok" });
    expect(() => repo.moveTask(t.id, "todo", { version: "abc" as any })).toThrow(/version must be an integer/);
  });
});

describe("summarizeTask", () => {
  const base: any = { id: "t", title: "x", description: null };

  it("leaves short descriptions alone", () => {
    expect(summarizeTask({ ...base, description: "short" })).toMatchObject({
      description: "short",
      has_more_description: false,
    });
  });

  it("trims long descriptions to an excerpt and says so", () => {
    const s = summarizeTask({ ...base, description: "x".repeat(5000) });
    expect(s.has_more_description).toBe(true);
    expect(s.description!.length).toBeLessThanOrEqual(SUMMARY_EXCERPT_CHARS + 1);
  });
});
