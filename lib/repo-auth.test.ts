import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the DB at a throwaway file BEFORE importing the modules that read
// PM_DB_PATH at load time, then import them dynamically.
let repo: typeof import("./repo");

beforeAll(async () => {
  process.env.PM_DB_PATH = join(mkdtempSync(join(tmpdir(), "pm-test-")), "test.db");
  repo = await import("./repo");
});

describe("users", () => {
  it("creates a user with a token and rejects duplicate usernames", () => {
    const u = repo.createUser("alice", "pw1");
    expect(u.username).toBe("alice");
    expect(u.api_token).toBeTruthy();
    expect(() => repo.createUser("alice", "other")).toThrow(/already exists/i);
  });

  it("resolves a user by id or username", () => {
    const u = repo.createUser("bob", "pw");
    expect(repo.resolveUserId("bob")).toBe(u.id);
    expect(repo.resolveUserId(u.id)).toBe(u.id);
  });

  it("verifies login and rejects bad credentials", () => {
    repo.createUser("carol", "secret");
    expect(repo.verifyLogin("carol", "secret").username).toBe("carol");
    expect(() => repo.verifyLogin("carol", "nope")).toThrow();
    expect(() => repo.verifyLogin("ghost", "secret")).toThrow();
  });

  it("listUsers never exposes secrets", () => {
    const list = repo.listUsers();
    for (const u of list) {
      expect(u).not.toHaveProperty("password_hash");
      expect(u).not.toHaveProperty("api_token");
    }
  });
});

describe("task attribution (backward compat)", () => {
  it("creates an anonymous task with null creator/assignee", () => {
    const p = repo.createProject("attr-proj");
    const t = repo.createTask(p.id, { title: "anon" });
    expect(t.creator_id).toBeNull();
    expect(t.assignee_id).toBeNull();
  });

  it("attributes creator and resolves assignee by username", () => {
    const p = repo.createProject("attr-proj-2");
    const dave = repo.createUser("dave", "pw");
    const t = repo.createTask(p.id, {
      title: "owned",
      creatorId: dave.id,
      assignee: "dave",
    });
    expect(t.creator_id).toBe(dave.id);
    expect(t.assignee_id).toBe(dave.id);
    expect(t.assignee_username).toBe("dave");
  });

  it("rejects assigning an unknown user", () => {
    const p = repo.createProject("attr-proj-3");
    expect(() => repo.createTask(p.id, { title: "x", assignee: "nobody" })).toThrow(
      /not found/i
    );
  });

  it("updates and unassigns", () => {
    const p = repo.createProject("attr-proj-4");
    const e = repo.createUser("erin", "pw");
    const t = repo.createTask(p.id, { title: "y" });
    const assigned = repo.updateTask(t.id, { assignee: "erin" });
    expect(assigned.assignee_id).toBe(e.id);
    const cleared = repo.updateTask(t.id, { assignee: null });
    expect(cleared.assignee_id).toBeNull();
  });
});
