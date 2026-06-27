import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Throwaway DB before importing the repo (it reads PM_DB_PATH at load time).
let repo: typeof import("./repo");

beforeAll(async () => {
  process.env.PM_DB_PATH = join(mkdtempSync(join(tmpdir(), "pm-links-")), "test.db");
  repo = await import("./repo");
});

describe("task links", () => {
  it("creates a link visible from both endpoints with inverse labels", () => {
    const p = repo.createProject("links-basic");
    const a = repo.createTask(p.id, { title: "A" });
    const b = repo.createTask(p.id, { title: "B" });

    const created = repo.createLink(a.id, b.id, "blocks");
    expect(created.label).toBe("Blocks");
    expect(created.task.id).toBe(b.id);

    const fromA = repo.listLinksFor(a.id);
    expect(fromA).toHaveLength(1);
    expect(fromA[0].label).toBe("Blocks");
    expect(fromA[0].task.id).toBe(b.id);

    const fromB = repo.listLinksFor(b.id);
    expect(fromB).toHaveLength(1);
    expect(fromB[0].label).toBe("Blocked by");
    expect(fromB[0].task.id).toBe(a.id);
  });

  it("accepts a pasted share URL as the target ref", () => {
    const p = repo.createProject("links-url");
    const a = repo.createTask(p.id, { title: "A" });
    const b = repo.createTask(p.id, { title: "B" });
    const link = repo.createLink(a.id, `https://h/?task=${b.id}`, "relates");
    expect(link.task.id).toBe(b.id);
    expect(link.label).toBe("Relates to");
  });

  it("rejects self-links and unknown targets", () => {
    const p = repo.createProject("links-guard");
    const a = repo.createTask(p.id, { title: "A" });
    expect(() => repo.createLink(a.id, a.id, "relates")).toThrow(/itself/i);
    expect(() => repo.createLink(a.id, "nope", "relates")).toThrow(/not found/i);
    expect(() => repo.createLink(a.id, "", "relates")).toThrow(/ticket id/i);
  });

  it("dedupes a duplicate edge, including symmetric relates either direction", () => {
    const p = repo.createProject("links-dedupe");
    const a = repo.createTask(p.id, { title: "A" });
    const b = repo.createTask(p.id, { title: "B" });
    repo.createLink(a.id, b.id, "relates");
    expect(() => repo.createLink(a.id, b.id, "relates")).toThrow(/already exists/i);
    // B↔A is the same undirected relation → also rejected.
    expect(() => repo.createLink(b.id, a.id, "relates")).toThrow(/already exists/i);
  });

  it("links across projects", () => {
    const p1 = repo.createProject("links-x1");
    const p2 = repo.createProject("links-x2");
    const a = repo.createTask(p1.id, { title: "A" });
    const b = repo.createTask(p2.id, { title: "B" });
    const link = repo.createLink(a.id, b.id, "causes");
    expect(link.task.project_id).toBe(p2.id);
  });

  it("keeps the link after the other ticket is soft-deleted, flagged deleted", () => {
    const p = repo.createProject("links-del");
    const a = repo.createTask(p.id, { title: "A" });
    const b = repo.createTask(p.id, { title: "B" });
    repo.createLink(a.id, b.id, "blocks");
    repo.softDeleteTask(b.id);
    const fromA = repo.listLinksFor(a.id);
    expect(fromA).toHaveLength(1);
    expect(fromA[0].task.deleted_at).not.toBeNull();
  });

  it("removeLink deletes the edge from both sides; missing id → not_found", () => {
    const p = repo.createProject("links-rm");
    const a = repo.createTask(p.id, { title: "A" });
    const b = repo.createTask(p.id, { title: "B" });
    const link = repo.createLink(a.id, b.id, "blocks");
    repo.removeLink(link.link_id);
    expect(repo.listLinksFor(a.id)).toHaveLength(0);
    expect(repo.listLinksFor(b.id)).toHaveLength(0);
    expect(() => repo.removeLink(link.link_id)).toThrow(/not found/i);
  });
});
