import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Throwaway DB before importing the repo (it reads PM_DB_PATH at load time).
let repo: typeof import("./repo");

beforeAll(async () => {
  process.env.PM_DB_PATH = join(mkdtempSync(join(tmpdir(), "pm-tid-")), "test.db");
  repo = await import("./repo");
});

describe("ticket ids (Jira-like)", () => {
  it("assigns a random 2-char prefix to new projects", () => {
    const p = repo.createProject("tid-prefix-default");
    expect(p.ticket_prefix).toMatch(/^[A-Z]{2}$/);
  });

  it("numbers tasks per-project starting at 1, forming PREFIX-NNNN", () => {
    const p = repo.createProject("tid-numbering");
    const prefix = p.ticket_prefix!;
    const a = repo.createTask(p.id, { title: "first" });
    const b = repo.createTask(p.id, { title: "second" });
    expect(a.ticket_number).toBe(1);
    expect(b.ticket_number).toBe(2);
    expect(a.ticket_key).toBe(`${prefix}-0001`);
    expect(b.ticket_key).toBe(`${prefix}-0002`);
  });

  it("numbers independently per project", () => {
    const p1 = repo.createProject("tid-iso-1");
    const p2 = repo.createProject("tid-iso-2");
    repo.createTask(p1.id, { title: "p1-a" });
    const p2a = repo.createTask(p2.id, { title: "p2-a" });
    expect(p2a.ticket_number).toBe(1);
  });

  it("does not reuse a number after a task is deleted", () => {
    const p = repo.createProject("tid-no-reuse");
    const a = repo.createTask(p.id, { title: "a" });
    repo.softDeleteTask(a.id);
    const b = repo.createTask(p.id, { title: "b" });
    // MAX(ticket_number) ignores deleted_at, so numbers never collide.
    expect(b.ticket_number).toBe(2);
  });

  it("keeps the display key stable when the prefix later changes", () => {
    const p = repo.createProject("tid-relabel");
    const t = repo.createTask(p.id, { title: "t" });
    expect(t.ticket_number).toBe(1);
    const u = repo.updateProject(p.id, { ticket_prefix: "ABC" });
    expect(u.ticket_prefix).toBe("ABC");
    // number is stored; the display key is recomputed from the new prefix.
    const reread = repo.getTask(t.id);
    expect(reread.ticket_number).toBe(1);
    expect(reread.ticket_key).toBe("ABC-0001");
  });

  it("changing the prefix is not a guarded edit (no confirm needed)", () => {
    const p = repo.createProject("tid-unguarded");
    expect(() => repo.updateProject(p.id, { ticket_prefix: "XY" })).not.toThrow();
  });

  it("validates prefix length and whitespace", () => {
    const p = repo.createProject("tid-validate");
    expect(() => repo.updateProject(p.id, { ticket_prefix: "X" })).toThrow(/2.*100/i);
    expect(() => repo.updateProject(p.id, { ticket_prefix: "a".repeat(101) })).toThrow(
      /2.*100/i
    );
    expect(() => repo.updateProject(p.id, { ticket_prefix: "A B" })).toThrow(
      /whitespace/i
    );
  });
});
