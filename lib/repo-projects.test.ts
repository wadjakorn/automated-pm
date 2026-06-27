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

describe("project update", () => {
  it("new projects start with a null remote_repo_url", () => {
    const p = repo.createProject("proj-default");
    expect(p.remote_repo_url).toBeNull();
  });

  it("edits description without a confirm", () => {
    const p = repo.createProject("proj-desc");
    const u = repo.updateProject(p.id, { description: "hello" });
    expect(u.description).toBe("hello");
  });

  it("requires confirm to rename", () => {
    const p = repo.createProject("proj-rename");
    expect(() => repo.updateProject(p.id, { name: "proj-renamed" })).toThrow(
      /sensitive edit/i
    );
    const u = repo.updateProject(p.id, { name: "proj-renamed", confirm: true });
    expect(u.name).toBe("proj-renamed");
  });

  it("requires confirm to change the remote URL", () => {
    const p = repo.createProject("proj-url-guard");
    expect(() =>
      repo.updateProject(p.id, { remote_repo_url: "https://github.com/a/b.git" })
    ).toThrow(/sensitive edit/i);
    const u = repo.updateProject(p.id, {
      remote_repo_url: "https://github.com/a/b.git",
      confirm: true,
    });
    expect(u.remote_repo_url).toBe("https://github.com/a/b.git");
  });

  it("accepts the common remote URL forms", () => {
    const ok = [
      "https://github.com/org/repo.git",
      "http://example.com/org/repo",
      "git://github.com/org/repo.git",
      "ssh://git@github.com/org/repo.git",
      "git@github.com:org/repo.git",
    ];
    ok.forEach((url, i) => {
      const p = repo.createProject("proj-ok-" + i);
      const u = repo.updateProject(p.id, { remote_repo_url: url, confirm: true });
      expect(u.remote_repo_url).toBe(url);
    });
  });

  it("rejects a malformed remote URL", () => {
    const p = repo.createProject("proj-bad-url");
    expect(() =>
      repo.updateProject(p.id, { remote_repo_url: "not a url", confirm: true })
    ).toThrow(/invalid remote repository url/i);
  });

  it("clears the remote URL with an empty string (no validation error)", () => {
    const p = repo.createProject("proj-clear");
    repo.updateProject(p.id, {
      remote_repo_url: "https://github.com/a/b.git",
      confirm: true,
    });
    const u = repo.updateProject(p.id, { remote_repo_url: "", confirm: true });
    expect(u.remote_repo_url).toBeNull();
  });

  it("does not require confirm when name/URL are unchanged", () => {
    const p = repo.createProject("proj-noop");
    // same name passed, no confirm → allowed (no real change)
    const u = repo.updateProject(p.id, { name: "proj-noop", description: "x" });
    expect(u.description).toBe("x");
  });

  it("rejects a duplicate name on rename", () => {
    repo.createProject("proj-taken");
    const p = repo.createProject("proj-tomove");
    expect(() =>
      repo.updateProject(p.id, { name: "proj-taken", confirm: true })
    ).toThrow(/already exists/i);
  });
});
