import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let repo: typeof import("./repo");

beforeAll(async () => {
  process.env.PM_DB_PATH = join(mkdtempSync(join(tmpdir(), "pm-claim-")), "test.db");
  repo = await import("./repo");
});

function todoTask(project: string) {
  const p = repo.createProject(project);
  const t = repo.createTask(p.id, { title: "work" });
  repo.moveTask(t.id, "todo");
  return { p, t: repo.getTask(t.id) };
}

describe("moveTask expectFrom (claim)", () => {
  it("moves when the ticket is still in the expected status", () => {
    const { t } = todoTask("claim-ok");
    const moved = repo.moveTask(t.id, "doing", { expectFrom: "todo" });
    expect(moved.status_key).toBe("doing");
  });

  it("only the first of two claims wins; the loser gets status_changed with the fresh row", () => {
    const { t } = todoTask("claim-race");
    repo.moveTask(t.id, "doing", { expectFrom: "todo" });
    let err: any;
    try {
      repo.moveTask(t.id, "doing", { expectFrom: "todo" });
    } catch (e) {
      err = e;
    }
    expect(err?.status).toBe(409);
    expect(err?.code).toBe("status_changed");
    expect(err?.extra?.current?.status_key).toBe("doing");
  });

  it("keeps the no-op move to the current status working without expectFrom (capz-loop recovery)", () => {
    const { t } = todoTask("claim-noop");
    repo.moveTask(t.id, "doing");
    const again = repo.moveTask(t.id, "doing");
    expect(again.status_key).toBe("doing");
    expect(again.version).toBeGreaterThan(t.version);
  });
});

describe("ready gate on createTask", () => {
  it("forbids an agent from creating straight into ready", () => {
    const p = repo.createProject("gate-agent");
    expect(() =>
      repo.createTask(p.id, { title: "x", status: repo.READY_STATUS_KEY, actorKind: "agent" })
    ).toThrow(/only a human/);
  });

  it("forbids an anonymous caller from creating straight into ready", () => {
    const p = repo.createProject("gate-anon");
    expect(() =>
      repo.createTask(p.id, { title: "x", status: "todo", actorKind: null })
    ).toThrow(/only a human/);
  });

  it("applies when ready is reached through the project default status", () => {
    const p = repo.createProject("gate-default");
    repo.updateProject(p.id, { default_status_key: "todo" });
    expect(() => repo.createTask(p.id, { title: "x", actorKind: "agent" })).toThrow(/only a human/);
  });

  it("lets an agent create in an earlier status and a human create in ready", () => {
    const p = repo.createProject("gate-allowed");
    expect(repo.createTask(p.id, { title: "a", status: "backlog", actorKind: "agent" }).status_key).toBe(
      "backlog"
    );
    expect(repo.createTask(p.id, { title: "h", status: "todo", actorKind: "human" }).status_key).toBe(
      "todo"
    );
  });
});

describe("user kind", () => {
  it("defaults to human, accepts agent, rejects unknown kinds", () => {
    expect(repo.createUser("kind-default", "pw").kind).toBe("human");
    expect(repo.createUser("kind-agent", "pw", "agent").kind).toBe("agent");
    expect(() => repo.createUser("kind-bad", "pw", "robot")).toThrow(/unknown user kind/);
  });

  it("setUserKind flips the kind and the public shape exposes it", () => {
    repo.createUser("kind-flip", "pw");
    expect(repo.setUserKind("kind-flip", "agent").kind).toBe("agent");
    expect(repo.listUsers().find((u) => u.username === "kind-flip")?.kind).toBe("agent");
  });
});
