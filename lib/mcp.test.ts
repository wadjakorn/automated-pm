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
    return { isError: !!r.isError, data: JSON.parse(r.content[0].text) };
  };
  return { client, call };
}

describe("MCP server", () => {
  it("lists the thin tool set", async () => {
    const { client } = await connect(null);
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "pm_create_task",
      "pm_get_task",
      "pm_get_workflow",
      "pm_list_projects",
      "pm_list_ready",
      "pm_list_tasks",
      "pm_move_task",
      "pm_update_task",
      "pm_whoami",
    ]);
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
    expect(summary.data[0].has_more_description).toBe(true);
    const full = await call("pm_list_tasks", { project: "mcp-c", view: "full" });
    expect(full.data[0].description).toHaveLength(3000);
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
});
