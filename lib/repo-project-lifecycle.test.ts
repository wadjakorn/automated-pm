import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Throwaway DB before importing the repo (it reads PM_DB_PATH at load time).
let repo: typeof import("./repo");

beforeAll(async () => {
  process.env.PM_DB_PATH = join(mkdtempSync(join(tmpdir(), "pm-proj-")), "test.db");
  repo = await import("./repo");
});

const ids = (list: { id: string }[]) => list.map((p) => p.id);

describe("project sort order", () => {
  it("orders projects by user-controlled sort_order and gives new ones MAX+1", () => {
    const a = repo.createProject("sort-a");
    const b = repo.createProject("sort-b");
    const c = repo.createProject("sort-c");
    // Created order is preserved by default (backfilled/assigned ascending).
    const listed = repo.listProjects().filter((p) => p.name.startsWith("sort-"));
    expect(ids(listed)).toEqual([a.id, b.id, c.id]);
    expect(b.sort_order).toBeGreaterThan(a.sort_order);
    expect(c.sort_order).toBeGreaterThan(b.sort_order);
  });

  it("reorderProjects rewrites the order", () => {
    const list = repo.listProjects().filter((p) => p.name.startsWith("sort-"));
    const reversed = ids(list).reverse();
    repo.reorderProjects(reversed);
    const after = repo
      .listProjects()
      .filter((p) => p.name.startsWith("sort-"))
      .map((p) => p.id);
    expect(after).toEqual(reversed);
  });
});

describe("project hidden", () => {
  it("hides from the sidebar view but keeps the project listed by the API", () => {
    const p = repo.createProject("hide-me");
    const updated = repo.updateProject(p.id, { hidden: true });
    expect(!!updated.hidden).toBe(true);
    // Still returned by the API (the sidebar filters client-side).
    expect(ids(repo.listProjects())).toContain(p.id);
    const shown = repo.updateProject(p.id, { hidden: false });
    expect(!!shown.hidden).toBe(false);
  });
});

describe("project archive", () => {
  it("archives off the default list but keeps the project live and resolvable", () => {
    const p = repo.createProject("arch-me");
    const archived = repo.archiveProject(p.id);
    expect(archived.archived_at).toBeTruthy();
    // Gone from the sidebar list...
    expect(ids(repo.listProjects())).not.toContain(p.id);
    // ...but visible with includeArchived, and still resolvable by id.
    expect(ids(repo.listProjects({ includeArchived: true }))).toContain(p.id);
    expect(repo.getProject(p.id).id).toBe(p.id);
  });

  it("unarchives back onto the sidebar", () => {
    const p = repo.createProject("unarch-me");
    repo.archiveProject(p.id);
    const back = repo.unarchiveProject(p.id);
    expect(back.archived_at).toBeNull();
    expect(ids(repo.listProjects())).toContain(p.id);
  });

  it("archive is idempotent", () => {
    const p = repo.createProject("arch-twice");
    const first = repo.archiveProject(p.id);
    const second = repo.archiveProject(p.id);
    expect(second.archived_at).toBe(first.archived_at);
  });
});

describe("project soft delete + restore", () => {
  it("hides from every list, then restores", () => {
    const p = repo.createProject("del-me");
    repo.softDeleteProject(p.id);
    expect(ids(repo.listProjects())).not.toContain(p.id);
    expect(() => repo.getProject(p.id)).toThrow(); // gone from normal resolution
    expect(ids(repo.listProjects({ includeDeleted: true }))).toContain(p.id);
    const restored = repo.restoreProject(p.id);
    expect(restored.deleted_at).toBeNull();
    expect(ids(repo.listProjects())).toContain(p.id);
  });

  it("refuses to restore when the name was reclaimed by a live project", () => {
    const p = repo.createProject("reclaim");
    repo.softDeleteProject(p.id);
    repo.createProject("reclaim"); // name freed, then reused
    expect(() => repo.restoreProject(p.id)).toThrow(/already uses that name/);
  });
});
