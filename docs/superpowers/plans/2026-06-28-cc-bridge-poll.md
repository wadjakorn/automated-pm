# cc-bridge poll/cron Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the push-based cc-bridge with a pull model: the dev machine's Claude Code routine polls `pm ready` for ready tickets and works them; delete all inbound push machinery.

**Architecture:** A new read-only endpoint `GET /api/cc-bridge/ready` returns ready tickets (status `todo`) across projects that have a `remote_repo_url`, joined with their repo URL. A thin `pm ready` CLI command wraps it (3 layers: CLI → HTTP → repo query, like every existing `pm` command). The routine claims each ticket via the existing `pm task move todo→doing` (optimistic version = the lock). No queue, no listener, no service.

**Tech Stack:** Next.js 15 App Router, better-sqlite3 (synchronous), TypeScript, Vitest, the `pm` flag-based CLI.

## Global Constraints

- **Auth gate:** `/api/cc-bridge/ready` requires a valid `PM_TOKEN` (Bearer) or session — `401` otherwise. Stricter than the open board on purpose (it gates autonomous code execution). Reuse the existing `currentUser(req)` resolver; add no new secret.
- **Ready status:** `process.env.CC_BRIDGE_READY_STATUS || "todo"`.
- **Opt-in projects only:** a project appears in `/ready` only if `remote_repo_url IS NOT NULL`. Excludes `deleted_at` and `archived_at`.
- **Project handle = name:** the routine pins the project *name* (e.g. `automated-pm`); `--project` resolves id OR name via existing `getProject`. No slug column.
- **Subscription-auth guardrail (doc):** the routine must NEVER set `ANTHROPIC_API_KEY` (would bill the metered API; it must use the Max subscription).
- **Keep `next.config.mjs`'s `serverExternalPackages: ["better-sqlite3"]`** — it is required app-wide for the native DB module, NOT just by the removed scheduler. Do not delete it.
- **`pm` is a thin HTTP client** with no DB access — `pm ready` MUST call the endpoint, which MUST call the repo function. Follow the existing `pm board` / `renderProjects` patterns exactly.

---

### Task 1: `listReadyTickets()` repo function + `ReadyTicket` type

**Files:**
- Modify: `lib/types.ts` (add `ReadyTicket` interface)
- Modify: `lib/repo.ts` (add `listReadyTickets`, after `listTasks` ~line 379)
- Test: `lib/repo-ready.test.ts` (create)

**Interfaces:**
- Consumes: existing `getProject(ref)`, `PRIORITY_ORDER_SQL`, `getDb()` in `lib/repo.ts`.
- Produces:
  - `interface ReadyTicket { ticket: string; project: string; projectName: string; repo: string; title: string; priority: Priority; description: string | null; }`
  - `function listReadyTickets(opts?: { projectRef?: string; assignee?: string; status?: string }): ReadyTicket[]` — `status` defaults to `"todo"`; `projectRef` (id or name) narrows to one project; `assignee` (id or username) narrows to one user; an unknown project OR assignee ref returns `[]`.

- [ ] **Step 1: Write the failing test**

Create `lib/repo-ready.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let repo: typeof import("./repo");

beforeAll(async () => {
  process.env.PM_DB_PATH = join(mkdtempSync(join(tmpdir(), "pm-ready-")), "test.db");
  repo = await import("./repo");
});

// Helper: a project WITH a repo URL (opted in) holding one ready (todo) task.
function seedReady(name: string, title: string, priority?: string) {
  const p = repo.createProject(name);
  repo.updateProject(p.id, { remote_repo_url: "git@github.com:me/repo.git", confirm: true });
  const t = repo.createTask(p.id, { title, priority });
  repo.moveTask(t.id, "todo");
  return { p, t };
}

describe("listReadyTickets", () => {
  it("returns ready tickets only from repo-bearing projects, with the repo joined", () => {
    const { p, t } = seedReady("ready-proj-a", "do the thing", "high");
    // A project WITHOUT a repo URL must never appear, even with a ready task.
    const noRepo = repo.createProject("ready-no-repo");
    const nrTask = repo.createTask(noRepo.id, { title: "invisible" });
    repo.moveTask(nrTask.id, "todo");

    const rows = repo.listReadyTickets();
    const ids = rows.map((r) => r.ticket);
    expect(ids).toContain(t.id);
    expect(ids).not.toContain(nrTask.id);

    const row = rows.find((r) => r.ticket === t.id)!;
    expect(row.project).toBe(p.id);
    expect(row.projectName).toBe("ready-proj-a");
    expect(row.repo).toBe("git@github.com:me/repo.git");
    expect(row.title).toBe("do the thing");
    expect(row.priority).toBe("high");
  });

  it("excludes non-ready, deleted, and archived tickets", () => {
    const p = repo.createProject("ready-proj-b");
    repo.updateProject(p.id, { remote_repo_url: "git@github.com:me/b.git", confirm: true });
    const backlog = repo.createTask(p.id, { title: "still backlog" }); // not moved → backlog
    const del = repo.createTask(p.id, { title: "deleted" });
    repo.moveTask(del.id, "todo");
    repo.softDeleteTask(del.id);

    const ids = repo.listReadyTickets({ projectRef: p.id }).map((r) => r.ticket);
    expect(ids).not.toContain(backlog.id);
    expect(ids).not.toContain(del.id);
  });

  it("honors a custom status and narrows by projectRef (name or id)", () => {
    const { p, t } = seedReady("ready-proj-c", "c-task");
    repo.createTask(p.id, { title: "in doing" });
    // narrowing by NAME works (the routine pins the name)
    const byName = repo.listReadyTickets({ projectRef: "ready-proj-c" }).map((r) => r.ticket);
    expect(byName).toContain(t.id);
    // unknown project ref → empty, not a throw
    expect(repo.listReadyTickets({ projectRef: "no-such-project" })).toEqual([]);
    // custom status returns nothing here (no task in 'doing-ready')
    expect(repo.listReadyTickets({ status: "doing-ready" })).toEqual([]);
  });

  it("narrows by assignee (id or username); unknown ref → []", () => {
    const u = repo.createUser("claude-a", "pw");
    const p = repo.createProject("ready-proj-d");
    repo.updateProject(p.id, { remote_repo_url: "git@github.com:me/d.git", confirm: true });
    const mine = repo.createTask(p.id, { title: "mine", assignee: "claude-a" });
    repo.moveTask(mine.id, "todo");
    const unassigned = repo.createTask(p.id, { title: "nobody" });
    repo.moveTask(unassigned.id, "todo");

    const byUser = repo.listReadyTickets({ assignee: "claude-a" }).map((r) => r.ticket);
    expect(byUser).toContain(mine.id);
    expect(byUser).not.toContain(unassigned.id);
    // by id resolves too
    expect(repo.listReadyTickets({ assignee: u.id }).map((r) => r.ticket)).toContain(mine.id);
    // unknown assignee → empty, not a throw
    expect(repo.listReadyTickets({ assignee: "ghost-user" })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/repo-ready.test.ts`
Expected: FAIL — `repo.listReadyTickets is not a function`.

- [ ] **Step 3: Add the `ReadyTicket` type**

In `lib/types.ts`, after the `Task` interface block, add:

```ts
// A ready-to-work ticket as served by GET /api/cc-bridge/ready: the minimal
// fields the poll routine needs, with the project's repo URL joined in.
export interface ReadyTicket {
  ticket: string;        // task id
  project: string;       // project id
  projectName: string;
  repo: string;          // projects.remote_repo_url (non-null by query filter)
  title: string;
  priority: Priority;
  description: string | null;
}
```

(`Priority` is already imported at the top of `lib/types.ts`.)

- [ ] **Step 4: Implement `listReadyTickets`**

In `lib/repo.ts`, add the import of the type to the existing `./types` import, then add the function immediately after `listTasks` (around line 379):

```ts
// cc-bridge poll: the ready-work queue. One row per ticket in the ready status
// that belongs to an opted-in project (one with a remote_repo_url), with that
// URL joined so the poll routine knows which repo to work in. Cross-project by
// default; `projectRef` (id or name) narrows to one project, `assignee` (id or
// username) to one user — an unknown project OR assignee ref yields []. A fleet
// of pollers pins distinct assignees to split work with no overlap.
// `status` defaults to "todo" (the route passes CC_BRIDGE_READY_STATUS).
export function listReadyTickets(
  opts: { projectRef?: string; assignee?: string; status?: string } = {}
): ReadyTicket[] {
  const status = opts.status ?? "todo";
  let pid: string | null = null;
  if (opts.projectRef) {
    try {
      pid = getProject(opts.projectRef).id;
    } catch {
      return []; // unknown project → no ready work, not an error
    }
  }
  let aid: string | null = null;
  if (opts.assignee) {
    try {
      aid = resolveUserId(opts.assignee);
    } catch {
      return []; // unknown assignee → no ready work, not an error
    }
  }
  return getDb()
    .prepare(
      `SELECT t.id AS ticket, t.project_id AS project, p.name AS projectName,
              p.remote_repo_url AS repo, t.title AS title,
              t.priority AS priority, t.description AS description
         FROM tasks t
         JOIN projects p ON p.id = t.project_id
        WHERE p.deleted_at IS NULL
          AND p.remote_repo_url IS NOT NULL
          AND t.deleted_at IS NULL
          AND t.archived_at IS NULL
          AND t.status_key = ?
          AND (? IS NULL OR p.id = ?)
          AND (? IS NULL OR t.assignee_id = ?)
        ORDER BY ${PRIORITY_ORDER_SQL}, t.rank`
    )
    .all(status, pid, pid, aid, aid) as ReadyTicket[];
}
```

Add `ReadyTicket` to the `./types` import line near the top of `lib/repo.ts` (it currently imports `Project, Task, ...` — append `ReadyTicket`). `resolveUserId` is already defined in `lib/repo.ts` (used by `listTasks`).

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run lib/repo-ready.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts lib/repo.ts lib/repo-ready.test.ts
git commit -m "feat: listReadyTickets() — ready-work queue for cc-bridge poll

Cross-project ready tickets from repo-bearing projects, repo URL joined.
Optional projectRef (id or name) narrows; unknown ref -> []."
```

---

### Task 2: `GET /api/cc-bridge/ready` route + auth gate

**Files:**
- Create: `app/api/cc-bridge/ready/route.ts`
- Test: `app/api/cc-bridge/ready/route.test.ts`

**Interfaces:**
- Consumes: `listReadyTickets` (Task 1), `currentUser` from `@/lib/auth`, `handle` from `@/lib/api-errors`.
- Produces: `GET` handler returning `ReadyTicket[]` (200) or `{ error: "unauthorized" }` (401).

- [ ] **Step 1: Write the failing test**

Create `app/api/cc-bridge/ready/route.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/cc-bridge/ready/route.test.ts`
Expected: FAIL — cannot find module `./route`.

- [ ] **Step 3: Implement the route**

Create `app/api/cc-bridge/ready/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { handle } from "@/lib/api-errors";
import { currentUser } from "@/lib/auth";
import { listReadyTickets } from "@/lib/repo";

export const dynamic = "force-dynamic";

// GET /api/cc-bridge/ready[?project=<id|name>]
// The poll routine's source of work: ready tickets across opted-in (repo-
// bearing) projects, repo URL joined. STRICTER than the open board — it gates
// autonomous code execution, so it requires a valid PM_TOKEN (or session).
export function GET(req: NextRequest) {
  if (!currentUser(req)) {
    return NextResponse.json(
      { error: "unauthorized", message: "a valid PM_TOKEN is required for /ready" },
      { status: 401 }
    );
  }
  return handle(() => {
    const sp = new URL(req.url).searchParams;
    return listReadyTickets({
      projectRef: sp.get("project") ?? undefined,
      assignee: sp.get("assignee") ?? undefined,
      status: process.env.CC_BRIDGE_READY_STATUS || "todo",
    });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/api/cc-bridge/ready/route.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/cc-bridge/ready/route.ts app/api/cc-bridge/ready/route.test.ts
git commit -m "feat: GET /api/cc-bridge/ready — token-gated ready-work endpoint"
```

---

### Task 3: `pm ready` CLI command + render kind

**Files:**
- Modify: `cli/render.ts` (add `"ready"` to `Kind`, add `renderReady`, wire the `case`)
- Modify: `cli/pm.ts` (handle `group === "ready"`; add a HELP line)
- Test: `cli/render.test.ts` (add `renderReady` cases)

**Interfaces:**
- Consumes: `GET /api/cc-bridge/ready` (Task 2), existing `api()`, `emit()`, `parseFlags()` in `cli/pm.ts`, `table()` in `cli/render.ts`.
- Produces: `pm ready [--project <id|name>] [--json]` → prints the ready list (table on a TTY, JSON when piped).

- [ ] **Step 1: Write the failing test**

Append to `cli/render.test.ts` (inside the `describe("render pretty", ...)` block or as a new `describe`):

```ts
describe("render ready", () => {
  const pretty = { mode: "pretty" as const, color: false };
  it("ready → table with ticket + repo columns", () => {
    const out = render(
      "ready",
      [{ ticket: "t1", project: "p1", projectName: "demo", repo: "git@github.com:me/r.git", title: "Do X", priority: "high" }],
      pretty
    );
    expect(out).toContain("TICKET");
    expect(out).toContain("t1");
    expect(out).toContain("demo");
    expect(out).toContain("git@github.com:me/r.git");
    expect(out).toContain("Do X");
  });

  it("empty ready → placeholder", () => {
    expect(render("ready", [], pretty)).toBe("(no ready tickets)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run cli/render.test.ts`
Expected: FAIL — `render("ready", ...)` falls through to JSON (no `(no ready tickets)` / no `TICKET` header), and TypeScript errors that `"ready"` is not assignable to `Kind`.

- [ ] **Step 3: Add the `ready` render kind**

In `cli/render.ts`, extend the `Kind` union:

```ts
export type Kind =
  | "projects" | "project" | "statemachine"
  | "tasks" | "task" | "board" | "ready" | "ok" | "raw";
```

Add the renderer (next to `renderTasks`):

```ts
function renderReady(list: any[]): string {
  if (!list.length) return "(no ready tickets)";
  return table(
    ["TICKET", "PROJECT", "PRIO", "REPO", "TITLE"],
    list.map((r) => [r.ticket, r.projectName ?? r.project, r.priority ?? "", r.repo ?? "", r.title])
  );
}
```

Wire it into the `switch` in `render()`:

```ts
    case "board": return renderBoard(data, o);
    case "ready": return renderReady(data);
    case "ok": return `${paint("✓", ANSI.green, o.color)} done`;
```

- [ ] **Step 4: Run the render test to verify it passes**

Run: `npx vitest run cli/render.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `pm ready` into the CLI dispatch**

In `cli/pm.ts`, extend the single-word command branch (currently `if (group === "login" || group === "whoami" || group === "board")`, ~line 188) to include `ready`, and handle it before the `board` fallthrough:

```ts
  // Single-word commands: flags live in [rawAction, ...rest].
  if (group === "login" || group === "whoami" || group === "board" || group === "ready") {
    const sf = parseFlags([rawAction, ...rest].filter((x): x is string => !!x));
    if (group === "whoami") return emit("raw", await api("GET", "/api/auth/me"));
    if (group === "login")
      return emit(
        "raw",
        await api("POST", "/api/auth/login", {
          username: need(sf, "username"),
          password: need(sf, "password"),
        })
      );
    if (group === "ready") {
      const qs = new URLSearchParams();
      if (typeof sf.project === "string") qs.set("project", sf.project);
      if (typeof sf.assignee === "string") qs.set("assignee", sf.assignee);
      const q = qs.toString() ? `?${qs.toString()}` : "";
      return emit("ready", await api("GET", `/api/cc-bridge/ready${q}`));
    }
    // board — Task 7 fills this in.
    return board(sf);
  }
```

- [ ] **Step 6: Add a HELP line**

In the `HELP` template in `cli/pm.ts`, add after the `pm board` line:

```
  pm ready [--project <id|name>] [--assignee <id|username>]   # ready tickets (repo + desc) for the poll routine
```

- [ ] **Step 7: Verify the full CLI test suite + types**

Run: `npx vitest run cli/ && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add cli/render.ts cli/pm.ts cli/render.test.ts
git commit -m "feat: pm ready — CLI wrapper over /api/cc-bridge/ready

Single-word command like pm board; renders a TICKET/PROJECT/PRIO/REPO/TITLE
table on a TTY, JSON when piped. This is what the poll routine calls."
```

---

### Task 4: Delete the push machinery

**Files:**
- Modify: `lib/repo.ts` (remove the `./webhook` import line 7 + the `moveTask` push hook, ~lines 492–501)
- Modify: `lib/db.ts` (remove the `webhook_deliveries` CREATE TABLE block + `idx_webhook_due`)
- Delete: `lib/webhook.ts`, `lib/webhook.test.ts`, `lib/webhook-emit.test.ts`
- Delete: `lib/scheduler.ts`, `instrumentation.ts`
- Delete: `app/api/cc-bridge/tick/route.ts`, `app/api/cc-bridge/resume/route.ts` (and their now-empty dirs)
- Delete: `cc-bridge/listener.py`, `cc-bridge/run.py`, `cc-bridge/install.sh`, `cc-bridge/com.you.ccbridge.plist`, `cc-bridge/config.example.json`

**Interfaces:**
- Consumes: nothing new.
- Produces: a `moveTask` with no side effects beyond the status update; a migration with no `webhook_deliveries`.

- [ ] **Step 1: Remove the `moveTask` push hook**

In `lib/repo.ts`, delete line 7:

```ts
import { bridgeConfig, enqueueDelivery, kickDelivery } from "./webhook";
```

and delete the hook block inside `moveTask` (the comment + the `const cfg = bridgeConfig(); if (...) { ... }` block, ~lines 491–502), so the function ends:

```ts
    .run(toStatus, rank, now(), taskId);
  return getTask(taskId);
}
```

- [ ] **Step 2: Remove the `webhook_deliveries` schema**

In `lib/db.ts`, delete the entire `CREATE TABLE IF NOT EXISTS webhook_deliveries (...)` block (the comment above it too) and the line:

```sql
    CREATE INDEX IF NOT EXISTS idx_webhook_due ON webhook_deliveries(state, next_attempt_at);
```

Leave the other `CREATE INDEX` lines intact.

- [ ] **Step 3: Delete the dead files**

```bash
git rm lib/webhook.ts lib/webhook.test.ts lib/webhook-emit.test.ts \
       lib/scheduler.ts instrumentation.ts \
       app/api/cc-bridge/tick/route.ts app/api/cc-bridge/resume/route.ts \
       cc-bridge/listener.py cc-bridge/run.py cc-bridge/install.sh \
       cc-bridge/com.you.ccbridge.plist cc-bridge/config.example.json
rmdir app/api/cc-bridge/tick app/api/cc-bridge/resume 2>/dev/null || true
```

- [ ] **Step 4: Verify nothing still imports the removed modules**

Run: `grep -rnE "webhook|scheduler|instrumentation|enqueueDelivery|bridgeConfig|kickDelivery|processQueue" lib app cli --include=*.ts | grep -v "node_modules"`
Expected: NO matches (empty output). If anything prints, remove that reference.

- [ ] **Step 5: Verify the build + full suite are green**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS — no dangling imports, no references to deleted symbols. (`next.config.mjs` keeps `serverExternalPackages: ["better-sqlite3"]` — do NOT remove it; the app's DB routes still need it.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: delete push cc-bridge machinery (listener, runner, queue, scheduler)

Pull model replaces it: the dev machine polls pm ready. Removes the inbound
listener, runner, installer, plist, server-side delivery queue, in-process
scheduler, instrumentation hook, tick/resume routes, the webhook_deliveries
table, and the moveTask push hook."
```

---

### Task 5: Documentation — routine doc + CLI references

**Files:**
- Rewrite: `cc-bridge/README.md`
- Modify: `README.md` (the cc-bridge Layout bullet, ~lines 171–173)
- Modify: `AGENTS.md` (add a `pm ready` entry to the command reference)
- Modify: `.agents/skills/project-manager-cli/SKILL.md` (add `pm ready` to §2 command reference)

**Interfaces:** none (docs only). Use the exact command names from Tasks 2–3.

- [ ] **Step 1: Rewrite `cc-bridge/README.md`**

Replace the whole file with the pull-model routine doc:

```markdown
# cc-bridge — auto-run ready tickets (poll model)

Move a ticket to **Ready** and a Claude Code routine on your dev machine picks
it up, implements it, opens a PR, and moves it to Code Review. No server to
install on the machine, no inbound listener, no Tailscale binding — the machine
**polls** the PM server.

## How it works

```
Claude Code (your machine, a built-in scheduled routine, every N min)
   pm ready --project <name> --json         # GET /api/cc-bridge/ready
   for each ready ticket:
     pm task move --id <id> --status doing   # claim (optimistic version = lock)
     implement → run tests → open PR
     pm task move --id <id> --status completed   # → Code Review
```

A claimed ticket leaves `todo`, so the next poll never returns it twice. Status
is the lock.

## One-time setup

1. **Opt a project in:** give it a remote repo URL so the routine knows where to
   work. Only projects with a repo URL appear in `pm ready`.

   ```bash
   pm project update --project "automated-pm" \
     --remote-url git@github.com:you/automated-pm.git --confirm
   ```

2. **Mint a token** (the `/ready` endpoint requires one — it triggers autonomous
   code execution, so it is not anonymous):

   ```bash
   pm user create --username poller --password "$(openssl rand -hex 16)"
   # copy the api_token from the output
   ```

3. **Env for the routine** (the machine that runs Claude Code):

   ```bash
   export PM_API=http://dietpi:3000        # your PM server URL
   export PM_TOKEN=<api_token from step 2>
   # NEVER set ANTHROPIC_API_KEY — the routine must use your Max subscription,
   # not the metered API.
   ```

4. **Install the routine in Claude Code.** Create a scheduled routine that runs
   every few minutes with this prompt (pin your project name):

   > Run `pm ready --project automated-pm --json`. For each ticket: claim it with
   > `pm task move --id <id> --status doing`, then implement it in the repo at its
   > `repo` URL — follow the repo's conventions, run its tests, open a PR with
   > `gh pr create`. On success move it to Code Review (`pm task move --id <id>
   > --status completed`). If blocked, `pm task move --id <id> --status blocked`
   > and append a STATUS note to the ticket describing why. Never set
   > `ANTHROPIC_API_KEY`. Keep secrets out of the repo.

   Omit `--project` to work every opted-in project at once. Running a **fleet**
   of machines? Give each one a distinct bot user and pin `--assignee <bot>` in
   its prompt — they split the ready tickets with no overlap.

## Notes & limits

- **Renaming a project breaks the pinned handle** — re-point the routine to the
  new name (or use the project id, which never changes).
- **A crashed run leaves a ticket in `doing`** (absent from `pm ready`). Nudge it
  back to `todo` to retry. Auto-recovery of stale `doing` tickets is future work.
- **Resume-on-PR-comment is not wired** in this model — to re-run a ticket, move
  it back to Ready or point the routine at it manually.
```

- [ ] **Step 2: Update the root `README.md` Layout bullet**

Replace the existing cc-bridge bullet (the `lib/webhook.ts, app/api/cc-bridge/** — cc-bridge ...` lines) with:

```markdown
- `app/api/cc-bridge/ready`, `pm ready` — **cc-bridge (poll model)**: a Claude
  Code routine on your dev machine polls `pm ready` for tickets in Ready and
  works them (claim → implement → PR → Code Review). Opt a project in by setting
  its remote repo URL. Setup in [`cc-bridge/README.md`](cc-bridge/README.md).
```

- [ ] **Step 3: Add `pm ready` to `AGENTS.md`**

In `AGENTS.md`, in the task/command reference section, add:

```markdown
- `pm ready [--project <id|name>] [--assignee <id|username>]` — list
  ready-to-work tickets (status `todo`) across projects that have a remote repo
  URL, with the repo URL + description joined. `--assignee` narrows to one user
  (a fleet of pollers pins distinct assignees). Requires `PM_TOKEN`. This is the
  source of work for the cc-bridge poll routine; claim a ticket by moving it
  `todo → doing`.
```

- [ ] **Step 4: Add `pm ready` to the in-repo skill**

In `.agents/skills/project-manager-cli/SKILL.md`, in the §2 command reference (near the `pm board` line), add:

```markdown
pm ready        [--project <id|name>] [--assignee <id|username>]   # ready tickets (+repo, +desc) for the poll routine; needs PM_TOKEN
```

- [ ] **Step 5: Commit**

```bash
git add cc-bridge/README.md README.md AGENTS.md .agents/skills/project-manager-cli/SKILL.md
git commit -m "docs: cc-bridge poll routine + pm ready in README/AGENTS/skill"
```

---

### Task 6: Full verification + PR retitle

**Files:** none (verification + git/gh only).

- [ ] **Step 1: Full suite + types**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests PASS, no type errors. Confirm the two webhook test files are gone and the new `repo-ready` / `route` / `render` tests pass.

- [ ] **Step 2: Smoke-test `pm ready` against a running server**

```bash
npm run dev          # in one shell; wait for http://localhost:3000
# in another shell:
export PM_API=http://localhost:3000
TOKEN=$(pm user create --username smoke --password pw | jq -r .api_token)
PID=$(pm project create --name smoke-ready | jq -r .id)
pm project update --project "$PID" --remote-url git@github.com:me/r.git --confirm
TID=$(pm task create --project "$PID" --title "ready smoke" | jq -r .id)
pm task move --id "$TID" --status todo
PM_TOKEN=$TOKEN pm ready --project smoke-ready --json    # → array containing $TID with repo + description
PM_TOKEN=bad pm ready --json                              # → unauthorized (exit non-zero)
```

Expected: the authed call lists the ticket with its `repo` and `description`; the bad-token call returns `{"error":"unauthorized",...}` and a non-zero exit.

- [ ] **Step 3: Retitle PR #16 to the poll/cron pivot**

```bash
gh pr edit 16 --title "feat: cc-bridge poll model (pm ready) — replace push webhook" \
  --body "$(cat <<'EOF'
Flip cc-bridge from push to pull. The dev machine's Claude Code routine polls
`pm ready` for tickets in Ready and works them (claim via `todo→doing`, implement,
PR, Code Review). Deletes the inbound listener, runner, installer, plist,
server-side delivery queue, in-process scheduler, instrumentation hook,
tick/resume routes, the `webhook_deliveries` table, and the `moveTask` push hook.

New surface: `GET /api/cc-bridge/ready` (token-gated) + `pm ready` CLI wrapper +
`listReadyTickets()`. Opt-in = a project's `remote_repo_url`. Setup in
`cc-bridge/README.md`.

Design: docs/superpowers/specs/2026-06-28-cc-bridge-poll-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Push**

```bash
git push
```

Expected: PR #16 updated, CI green.

---

## Notes for the implementer

- `repo.createTask` signature is `createTask(projectId, { title, description?, status?, assignee?, priority? })` — the tests above use the object form; confirm against `lib/repo.ts` if a call fails.
- `repo.softDeleteTask(id)` is the soft-delete function used in Task 1's test — confirm its exact name in `lib/repo.ts` (search `softDelete`) and adjust if needed.
- Route tests construct `NextRequest` directly and call the exported `GET` — no running server needed.
- Do not touch `next.config.mjs` — `serverExternalPackages` stays.
