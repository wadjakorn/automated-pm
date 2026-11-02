import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

// Every API route handler must go through lib/actor (handleRead/handleWrite),
// so the bad-token 401 and PM_AUTH_MODE=write-token apply everywhere. These
// routes do their own auth on purpose and are the only exceptions.
const EXEMPT = new Set([
  "app/api/auth/login/route.ts", // password check, starts a session
  "app/api/auth/logout/route.ts", // only clears the caller's own session
  "app/api/auth/register/route.ts", // resolveActor + its own write-token rule
  "app/api/auth/me/route.ts", // resolveActor, returns a literal null
  "app/api/auth/token/route.ts", // password check, rotates the caller's token
  "app/api/uploads/[id]/route.ts", // public image bytes (immutable, unguessable ids)
]);

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return routeFiles(p);
    return name === "route.ts" ? [p] : [];
  });
}

// Split a route file into { method, body } per exported handler.
function handlers(src: string): { method: string; body: string }[] {
  const re = /export (?:async )?function (GET|POST|PATCH|PUT|DELETE)\b/g;
  const marks = [...src.matchAll(re)];
  return marks.map((m, i) => ({
    method: m[1],
    body: src.slice(m.index, i + 1 < marks.length ? marks[i + 1].index : src.length),
  }));
}

describe("route auth audit", () => {
  const root = process.cwd();
  const files = routeFiles(join(root, "app/api")).map((f) => relative(root, f));

  it("finds the route files", () => {
    expect(files.length).toBeGreaterThan(15);
  });

  for (const file of files) {
    if (EXEMPT.has(file)) continue;
    it(`${file} wraps every handler`, () => {
      const hs = handlers(readFileSync(join(root, file), "utf8"));
      expect(hs.length).toBeGreaterThan(0);
      for (const h of hs) {
        const want = h.method === "GET" ? "handleRead(req" : "handleWrite(req";
        expect(h.body, `${h.method} in ${file}`).toContain(want);
      }
    });
  }
});

describe("actor resolution", () => {
  let actor: typeof import("./actor");
  let repo: typeof import("./repo");
  let token: string;

  beforeAll(async () => {
    process.env.PM_DB_PATH = join(mkdtempSync(join(tmpdir(), "pm-actor-")), "test.db");
    repo = await import("./repo");
    actor = await import("./actor");
    token = repo.createUser("actor-user", "pw").api_token;
  });

  afterEach(() => {
    delete process.env.PM_AUTH_MODE;
  });

  const req = (auth?: string) =>
    new Request("http://x/api/tasks", { headers: auth ? { authorization: auth } : {} });

  it("resolves a valid token and treats no header as anonymous", () => {
    expect(actor.resolveActor(req(`Bearer ${token}`))?.username).toBe("actor-user");
    expect(actor.resolveActor(req())).toBeNull();
  });

  it("rejects an unknown or empty Bearer token with 401 instead of going anonymous", () => {
    for (const bad of ["Bearer nope", "Bearer ", "Bearer null"]) {
      let err: any;
      try {
        actor.resolveActor(req(bad));
      } catch (e) {
        err = e;
      }
      expect(err?.status, bad).toBe(401);
    }
  });

  it("allows anonymous writes in open mode and refuses them in write-token mode", () => {
    expect(actor.requireWriter(req())).toBeNull();
    process.env.PM_AUTH_MODE = "write-token";
    expect(() => actor.requireWriter(req())).toThrow(/requires a token/);
    expect(actor.requireWriter(req(`Bearer ${token}`))?.username).toBe("actor-user");
  });

  it("rotateApiToken invalidates the old token", () => {
    const fresh = repo.rotateApiToken("actor-user", "pw");
    expect(fresh).not.toBe(token);
    expect(() => actor.resolveActor(req(`Bearer ${token}`))).toThrow(/invalid API token/);
    expect(actor.resolveActor(req(`Bearer ${fresh}`))?.username).toBe("actor-user");
    expect(() => repo.rotateApiToken("actor-user", "wrong")).toThrow(/invalid username or password/);
    token = fresh;
  });
});
