import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { User } from "./types";

let repo: typeof import("./repo");
let mcp: typeof import("./mcp");

beforeAll(async () => {
  process.env.PM_DB_PATH = join(mkdtempSync(join(tmpdir(), "pm-mcp-")), "test.db");
  repo = await import("./repo");
  mcp = await import("./mcp");
});

afterEach(() => {
  delete process.env.PM_AUTH_MODE;
});

async function connect(actor: User | null) {
  const server = mcp.buildMcpServer(actor);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r: any = await client.callTool({ name, arguments: args });
    const text = r.content[0].text;
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = text; // SDK input-validation errors come back as plain text
    }
    return { isError: !!r.isError, data };
  };
  return { client, call };
}

describe("MCP server", () => {
  it("lists the thin tool set", async () => {
    const { client } = await connect(null);
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "pm_comment",
      "pm_create_task",
      "pm_get_task",
      "pm_get_workflow",
      "pm_link_tasks",
      "pm_list_inbox",
      "pm_list_projects",
      "pm_list_ready",
      "pm_list_tasks",
      "pm_move_task",
      "pm_my_work",
      "pm_search_tasks",
      "pm_unlink_tasks",
      "pm_update_task",
      "pm_whoami",
    ]);
  });

  it("pm_whoami warns when the connection uses a human token, not for an agent", async () => {
    const human = repo.createUser("mcp-whoami-human", "pw");
    const h = await (await connect(human)).call("pm_whoami");
    expect(h.data).toMatchObject({ username: "mcp-whoami-human", kind: "human" });
    expect(h.data.warning).toMatch(/human user's token/);

    const agent = repo.createUser("mcp-whoami-agent", "pw", "agent");
    const a = await (await connect(agent)).call("pm_whoami");
    expect(a.data).toMatchObject({ username: "mcp-whoami-agent", kind: "agent" });
    expect(a.data).not.toHaveProperty("warning");

    expect((await (await connect(null)).call("pm_whoami")).data).toBeNull();
  });

  it("creates, reads, claims and reports next statuses for a human", async () => {
    const human = repo.createUser("mcp-human", "pw");
    const { call } = await connect(human);
    repo.createProject("mcp-a");
    const created = await call("pm_create_task", {
      project: "mcp-a",
      title: "do it",
      status: "todo",
      assignee: "mcp-human",
      priority: "high",
    });
    expect(created.isError).toBe(false);
    expect(created.data.creator_username).toBe("mcp-human");
    expect(created.data.next_statuses).toContain("doing");

    const claim = await call("pm_move_task", { id: created.data.id, status: "doing", from: "todo" });
    expect(claim.data.status_key).toBe("doing");
    const again = await call("pm_move_task", { id: created.data.id, status: "doing", from: "todo" });
    expect(again.isError).toBe(true);
    expect(again.data.error).toBe("status_changed");
    expect(again.data.hint).toMatch(/pick another/);

    const got = await call("pm_get_task", { id: created.data.ticket_key });
    expect(got.data.id).toBe(created.data.id);
    expect(got.data.links).toEqual([]);
  });

  it("comments: a question reaches the inbox, an answer resolves it, history is on the task", async () => {
    const agent = repo.createUser("mcp-asker", "pw", "agent");
    const human = repo.createUser("mcp-answerer", "pw");
    const p = repo.createProject("mcp-q");
    const t = repo.createTask(p.id, { title: "q" });
    const a = await connect(agent);
    const q = await a.call("pm_comment", { id: t.id, body: "Which DB?", kind: "question" });
    expect(q.data.kind).toBe("question");
    expect((await a.call("pm_list_inbox", { project: "mcp-q" })).data).toHaveLength(1);
    const h = await connect(human);
    await h.call("pm_comment", { id: t.id, body: "SQLite", kind: "answer", reply_to: q.data.id });
    expect((await a.call("pm_list_inbox", { project: "mcp-q" })).data).toHaveLength(0);
    const got = await a.call("pm_get_task", { id: t.id });
    expect(got.data.activity.map((e: any) => e.type)).toEqual(["created", "comment", "comment"]);
  });

  it("keeps the agent ready gate", async () => {
    const agent = repo.createUser("mcp-agent", "pw", "agent");
    const { call } = await connect(agent);
    repo.createProject("mcp-b");
    const r = await call("pm_create_task", { project: "mcp-b", title: "x", status: "todo" });
    expect(r.isError).toBe(true);
    expect(r.data.error).toBe("forbidden");
  });

  it("returns summaries by default and full text on request", async () => {
    const { call } = await connect(null);
    const p = repo.createProject("mcp-c");
    repo.createTask(p.id, { title: "long", description: "y".repeat(3000) });
    const summary = await call("pm_list_tasks", { project: "mcp-c" });
    const row = summary.data.tasks[0];
    expect(row.has_more_description).toBe(true);
    // compact rows: no rank/version/ids beyond the ticket's own
    expect(Object.keys(row).sort()).toEqual(
      [
        "assignee_username",
        "excerpt",
        "has_more_description",
        "id",
        "priority",
        "status_key",
        "ticket_key",
        "title",
        "updated_at",
      ].sort()
    );
    const full = await call("pm_list_tasks", { project: "mcp-c", view: "full" });
    expect(full.data.tasks[0].description).toHaveLength(3000);
  });

  it("pages a big project with limit + next_cursor", async () => {
    const { call } = await connect(null);
    const p = repo.createProject("mcp-page");
    for (let i = 0; i < 230; i++) repo.createTask(p.id, { title: `t${i}` });
    const first = await call("pm_list_tasks", { project: "mcp-page" });
    expect(first.data.total).toBe(230);
    expect(first.data.count).toBe(50);
    expect(first.data.next_cursor).toBe("50");

    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r: any = await call("pm_list_tasks", {
        project: "mcp-page",
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });
      expect(r.data.count).toBeLessThanOrEqual(200);
      r.data.tasks.forEach((t: any) => seen.add(t.id));
      cursor = r.data.next_cursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(2);
    expect(seen.size).toBe(230);

    const over = await call("pm_list_tasks", { project: "mcp-page", limit: 201 });
    expect(over.isError).toBe(true);
    const bad = await call("pm_list_tasks", { project: "mcp-page", cursor: "abc" });
    expect(bad.data.error).toBe("bad_request");
  });

  it("open_only hides final and archived tickets by default; q filters titles", async () => {
    const { call } = await connect(null);
    const p = repo.createProject("mcp-open");
    const open = repo.createTask(p.id, { title: "[EPIC] open one" });
    repo.createTask(p.id, { title: "other open" });
    const done = repo.createTask(p.id, { title: "[EPIC] released", status: "released" });
    const filed = repo.createTask(p.id, { title: "[epic] archived", status: "released" });
    repo.archiveTask(filed.id);

    const def = await call("pm_list_tasks", { project: "mcp-open" });
    expect(def.data.tasks.map((t: any) => t.title).sort()).toEqual(["[EPIC] open one", "other open"]);

    const all = await call("pm_list_tasks", { project: "mcp-open", open_only: false });
    expect(all.data.total).toBe(4);

    // explicit status wins over open_only (archived still hidden)
    const rel = await call("pm_list_tasks", { project: "mcp-open", status: "released" });
    expect(rel.data.tasks.map((t: any) => t.id)).toEqual([done.id]);

    const epic = await call("pm_list_tasks", { project: "mcp-open", q: "[epic]" });
    expect(epic.data.tasks.map((t: any) => t.id)).toEqual([open.id]);
    const epicAll = await call("pm_list_tasks", { project: "mcp-open", q: "[EPIC]", open_only: false });
    expect(epicAll.data.total).toBe(3);
  });

  it("cuts an oversized page and says truncated instead of overflowing", async () => {
    const { call } = await connect(null);
    const p = repo.createProject("mcp-big");
    for (let i = 0; i < 10; i++) repo.createTask(p.id, { title: `big${i}`, description: "z".repeat(25_000) });
    const r = await call("pm_list_tasks", { project: "mcp-big", view: "full" });
    expect(r.data.truncated).toBe(true);
    expect(r.data.count).toBe(1);
    expect(r.data.next_cursor).toBe("1");
    expect(JSON.stringify(r.data).length).toBeLessThan(mcp.LIST_MAX_CHARS + 2_000);
    // summary rows of the same tickets fit easily
    const s = await call("pm_list_tasks", { project: "mcp-big" });
    expect(s.data.truncated).toBeUndefined();
    expect(s.data.count).toBe(10);
  });

  it("refuses anonymous writes in write-token mode but still reads", async () => {
    process.env.PM_AUTH_MODE = "write-token";
    const { call } = await connect(null);
    repo.createProject("mcp-d");
    expect((await call("pm_list_projects")).isError).toBe(false);
    const w = await call("pm_create_task", { project: "mcp-d", title: "x" });
    expect(w.data.error).toBe("unauthorized");
  });

  it("explains an illegal move", async () => {
    const { call } = await connect(null);
    const p = repo.createProject("mcp-e");
    const t = repo.createTask(p.id, { title: "x" });
    const r = await call("pm_move_task", { id: t.id, status: "released" });
    expect(r.data.error).toBe("illegal_transition");
    expect(r.data.hint).toMatch(/next_statuses/);
  });

  it("links and unlinks tickets, across projects, both sides see it", async () => {
    const agent = repo.createUser("mcp-linker", "pw", "agent");
    const { call } = await connect(agent);
    const pa = repo.createProject("mcp-link-a");
    const pb = repo.createProject("mcp-link-b");
    const epic = repo.createTask(pa.id, { title: "epic" });
    const child = repo.createTask(pb.id, { title: "child" });

    const l = await call("pm_link_tasks", { id: child.id, target: epic.ticket_key ?? epic.id, type: "blocked-by" });
    expect(l.isError).toBe(false);
    expect(l.data.label).toBe("Blocked by");
    expect(l.data.task.id).toBe(epic.id);

    const fromEpic = await call("pm_get_task", { id: epic.id });
    expect(fromEpic.data.links).toHaveLength(1);
    expect(fromEpic.data.links[0].label).toBe("Blocks");
    expect(fromEpic.data.links[0].task.id).toBe(child.id);

    const dup = await call("pm_link_tasks", { id: epic.id, target: child.id, type: "blocks" });
    expect(dup.data.error).toBe("bad_request");
    const self = await call("pm_link_tasks", { id: epic.id, target: epic.id, type: "relates" });
    expect(self.data.error).toBe("bad_request");
    const missing = await call("pm_link_tasks", { id: epic.id, target: "nope", type: "relates" });
    expect(missing.data.error).toBe("not_found");
    const badType = await call("pm_link_tasks", { id: epic.id, target: child.id, type: "parent" });
    expect(badType.isError).toBe(true);

    // a link_id that isn't on this ticket is refused
    const other = repo.createTask(pb.id, { title: "unrelated" });
    const wrong = await call("pm_unlink_tasks", { id: other.id, link_id: l.data.link_id });
    expect(wrong.data.error).toBe("not_found");

    const un = await call("pm_unlink_tasks", { id: epic.id, link_id: l.data.link_id });
    expect(un.data).toEqual({ ok: true });
    expect((await call("pm_get_task", { id: child.id })).data.links).toEqual([]);
  });

  it("pm_create_task links the new ticket in one call, all-or-nothing", async () => {
    const agent = repo.createUser("mcp-epic-maker", "pw", "agent");
    const { call } = await connect(agent);
    const p = repo.createProject("mcp-epic");
    const epic = repo.createTask(p.id, { title: "EPIC" });
    const r = await call("pm_create_task", {
      project: "mcp-epic",
      title: "child",
      links: [{ target: epic.id, type: "relates" }],
    });
    expect(r.isError).toBe(false);
    expect(r.data.links).toHaveLength(1);
    expect(r.data.links[0].task.id).toBe(epic.id);
    expect((await call("pm_get_task", { id: epic.id })).data.links[0].task.id).toBe(r.data.id);

    const bad = await call("pm_create_task", {
      project: "mcp-epic",
      title: "orphan",
      links: [{ target: "does-not-exist", type: "relates" }],
    });
    expect(bad.data.error).toBe("not_found");
    expect(repo.listTasks(p.id).map((t) => t.title)).not.toContain("orphan");
  });
});
