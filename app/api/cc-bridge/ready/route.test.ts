import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";

let route: typeof import("./route");
let repo: typeof import("@/lib/repo");
let token: string;
let readyId: string;

beforeAll(async () => {
  process.env.PM_DB_PATH = join(mkdtempSync(join(tmpdir(), "pm-ready-route-")), "test.db");
  repo = await import("@/lib/repo");
  route = await import("./route");

  token = repo.createUser("poller", "pw").api_token;
  const p = repo.createProject("route-proj");
  repo.updateProject(p.id, { remote_repo_url: "git@github.com:me/r.git", confirm: true });
  const t = repo.createTask(p.id, { title: "ready one" });
  repo.moveTask(t.id, "todo");
  readyId = t.id;
});

function get(headers: Record<string, string> = {}, query = "") {
  return route.GET(new NextRequest(`http://localhost/api/cc-bridge/ready${query}`, { headers }));
}

describe("GET /api/cc-bridge/ready", () => {
  it("401s without a valid token", async () => {
    const res = await get();
    expect(res.status).toBe(401);
  });

  it("401s with a bogus token", async () => {
    const res = await get({ authorization: "Bearer not-a-real-token" });
    expect(res.status).toBe(401);
  });

  it("returns ready tickets with a valid token", async () => {
    const res = await get({ authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.map((r: any) => r.ticket)).toContain(readyId);
    expect(body[0]).toHaveProperty("repo");
  });

  it("filters by ?project=", async () => {
    const res = await get({ authorization: `Bearer ${token}` }, "?project=no-such");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("filters by ?assignee= (unknown user → [])", async () => {
    const res = await get({ authorization: `Bearer ${token}` }, "?assignee=ghost-user");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
