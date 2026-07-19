Build a Project Manager Kanban web app. Do NOT ask clarifying questions — all
decisions are fixed below. Discuss briefly if you must, then build.

## Goal
Browser-based Kanban for projects + tasks. No login (all users equal permission).
No install for the end user beyond running one command. An LLM agent must be able
to create/update/delete tasks via a CLI against the SAME data the browser shows.

## Locked decisions
- Architecture: local backend server. Browser UI and CLI both hit the same HTTP
  API and share one datastore. Concurrent edits handled with OPTIMISTIC LOCKING
  (per-task integer `version`; stale write -> HTTP 409).
- Stack: Next.js (App Router, TypeScript; use a current patched 15.x — older
  releases carry CVEs) + SQLite via better-sqlite3 (set `serverExternalPackages:
  ["better-sqlite3"]` in next config). One codebase. A shared `lib/` holds types +
  state-machine logic used by API, UI, and CLI — single source of truth, no
  duplicated rules.
- State machine: per-project. Each new project is seeded from a default. Strict
  enforcement of transitions. Final states are LOCKED (no outbound transitions).
- Default statuses: backlog, todo, doing, completed, tested, released.
  `released` is final. (`deleted` is NOT a visible column — soft delete handles it.)
- Soft delete everywhere: a `deleted_at` timestamp hides the row from the board;
  restorable from a Trash view.
- CLI: flag-based subcommands, JSON to stdout, proper exit codes. Goes through the
  HTTP API so it inherits the same state-machine + locking rules.
- UI: dark-mode first (Tailwind). Drag-drop Kanban. Illegal drop snaps back +
  toast (server is authoritative). Poll active project every ~3-5s so CLI/agent
  changes appear.

## Data model (SQLite)
- projects(id TEXT pk, name, description, created_at, updated_at, deleted_at)
  Project `name` is UNIQUE among live (non-deleted) projects — partial unique
  index `WHERE deleted_at IS NULL` + app-level guards in create/update. A name
  frees up once its project is trashed. This lets `--project` take a name.
- statuses(id, project_id, key, label, sort_order, is_final, UNIQUE(project_id,key))
- transitions(id, project_id, from_key, to_key, UNIQUE(project_id,from_key,to_key))
- tasks(id, project_id, title, description, status_key, rank, version INT default 1,
        created_at, updated_at, deleted_at)
IDs = nanoid/uuid. Timestamps = ISO strings. `rank` = numeric REAL ordering within
a column (ORDER BY rank); new tasks append at max+1024, so reordering touches one
row. (Numeric, not lexorank — avoids text-sort pitfalls.)
On project create: seed default statuses + linear transition chain
backlog->todo->doing->completed->tested->released, with `released` is_final and no
outbound edges.

## Shared logic — lib/statemachine.ts (single source of truth)
- DEFAULT_STATUSES, DEFAULT_TRANSITIONS
- canTransition(project, fromKey, toKey) -> {ok:true} | {ok:false, reason}
  true only if the edge exists in that project's transitions AND `from` is not final.
- Called by PATCH /api/tasks/[id] whenever status_key changes. Illegal -> HTTP 422
  with reason.
- Settings editor may add/rename/reorder statuses, toggle final, add/remove edges.
  Guard: an edit must not orphan any existing task's current status.

## Optimistic locking
- PATCH /api/tasks/[id] requires `version` in body. Mismatch -> 409 with current row.
- On success: bump version, set updated_at.
- UI: on 409 refetch + toast "changed elsewhere, reloaded".
- CLI: `--version` optional; if omitted, GET current version then PATCH. 409 ->
  {"error":"conflict","current":{...}}, non-zero exit.

## File layout
project-manager/
  app/
    page.tsx                              # board: project switcher + columns
    settings/page.tsx                     # per-project state-machine editor
    trash/page.tsx                        # soft-deleted tasks + restore
    api/
      projects/route.ts                   # GET list, POST create
      projects/[id]/route.ts              # GET, PATCH, DELETE (soft)
      projects/[id]/statuses/route.ts     # GET, POST, PATCH (order/final)
      projects/[id]/transitions/route.ts  # GET, POST, DELETE edges
      tasks/route.ts                      # GET (by project+filters), POST
      tasks/[id]/route.ts                 # GET, PATCH (version-checked), DELETE (soft)
      tasks/[id]/restore/route.ts         # POST
  lib/ db.ts, types.ts, statemachine.ts, repo.ts, api-errors.ts, client.ts
  components/ Board, TaskCard, EditDrawer, Settings, Trash, Nav, Toast, useApp
  cli/ pm.ts
  .claude/launch.json   # saved dev-server configs (next-dev / next-start)
  package.json   # scripts: dev, build, start, cli, test; bin: { pm }
  README.md      # human run instructions
  AGENTS.md      # CLI guide for LLM agents (commands, JSON/error contract, rules)

## CLI surface (cli/pm.ts) — base URL from PM_API env, default http://localhost:3000
`--project` accepts a project id OR its (unique) name — server resolves either,
id tried first so an id never shadowed by a name. Names unique among live
projects; create/rename to a taken name -> bad_request. Quote names with spaces.
pm project create --name "X" [--description ...]   # name must be unique
pm project list
pm status list --project <id|name>
pm status add --project <id|name> --key qa --label "QA" [--final]
pm status set-final --project <id|name> --key released --final true
pm transition add --project <id|name> --from doing --to qa
pm transition remove --project <id|name> --from doing --to qa
pm task create --project <id|name> --title "..." [--description ...] [--status backlog] [--priority now]
pm task list --project <id|name> [--status doing] [--include-deleted] [--include-archived] [--priority high]
# every --id below takes the nanoid OR the human ticket key (e.g. PM-0002)
pm task move --id <id|key> --status doing [--version N]
pm task update --id <id|key> [--title ...] [--description ...] [--version N] [--priority high]
pm task delete --id <id|key>          # soft
pm task restore --id <id|key>
pm task archive --id <id|key>         # final-status only; off-board but stays live
pm task unarchive --id <id|key>
pm task archive-final --project <id|name> --status <final-key>   # bulk-archive a final column
pm task create --project <id|name> --stdin                # one task per stdin line

# Ticket links (--to takes a URL, id, or ticket key; shows in both tickets; --type = blocks|blocked-by|causes|caused-by|relates)
pm task link add  --id <id|key> --to <url|id|key> --type <type>
pm task link list --id <id|key>
pm task link rm   --id <id|key> --link <linkId>
pm board --project <id|name>                              # columns grouped by status
pm project update --project <id|name> [--name <new>] [--description ...] [--remote-url <url>] [--default-status <key>] [--confirm]  # name/url need --confirm; --default-status sets new-task status, '' clears
pm project delete --project <id|name>                     # soft delete
pm status update --project <id|name> --key <key> [--label ...] [--final <bool>] [--order N] [--hidden <bool>]  # --hidden = off web board only, still listed/movable
# aliases: ls=list, mv=move, rm=delete
Output is TTY-aware: piped/non-TTY stdout = JSON (parsing unchanged); a terminal
gets pretty tables. Force with --json / --pretty; --api <url> overrides PM_API;
`pm --version` prints the version (after a subcommand, --version <n> is the
optimistic-lock option, not the global flag). Exit 0 ok / non-zero on error.

Make `pm` a standalone command: shebang `#!/usr/bin/env -S tsx` on cli/pm.ts
(run tsx as the interpreter — a PATH executable; do NOT use `node --import tsx`,
which resolves `tsx` against the cwd and fails outside the repo) + `"bin": { "pm": "cli/pm.ts" }` in package.json + `npm link`. (No build
step — tsx runs the TS directly.) Fallback without link: `npm run cli -- <args>`.
If the npm global bin isn't on PATH, symlink it where the shell looks, e.g.
`ln -sf "$(npm prefix -g)/bin/pm" ~/.local/bin/pm`.

## UI detail
Dark theme default. Board: project switcher top, columns from statuses ordered by
sort_order, draggable cards (dnd-kit). Card shows title + truncated description +
quick status menu; click opens edit drawer. Illegal drop -> snap back + toast.
Settings page: manage statuses + transition matrix. Trash page: list soft-deleted
+ restore.

## Build order (TDD where noted)
1. Scaffold Next.js + Tailwind (dark) + better-sqlite3; lib/db.ts migrations.
2. lib/types.ts + lib/statemachine.ts — UNIT TEST FIRST (Vitest): legal/illegal
   edges, final lock, default seed.
3. lib/repo.ts — soft-delete-aware, parameterized queries.
4. API routes: projects -> statuses/transitions -> tasks (version + transition checks).
5. CLI pm.ts; smoke-test every subcommand against a running server.
6. UI: board + dnd + polling; then settings; then trash.
7. package.json scripts + `bin` (standalone `pm`) + README + AGENTS.md (agent CLI
   guide) + .claude/launch.json (dev-server configs).

## Verification before done
- Unit: statemachine (legal/illegal, final lock, seed).
- API: project create seeds defaults; illegal move -> 422; stale version -> 409;
  soft delete hides + restore brings back.
- CLI e2e: create project -> create task -> legal move -> illegal move (non-zero +
  JSON error) -> delete -> list --include-deleted shows it -> restore.
- UI manual: dark board loads; legal drag persists; illegal snaps back w/ toast;
  CLI edit shows on board after poll; settings add status/edge -> new column; trash
  restore works.
- Run: `npm install && npm run dev` -> http://localhost:3000;
  `npm run cli -- project list` from a second shell.

## Addendum: Auth + task attribution (added 2026-06-21)

Supersedes the original "no login" decision — login is now **optional and
additive**. Every endpoint still works unauthenticated (CLI/agents unchanged);
identity, when present, fills new nullable columns.

- **Mechanism:** browser → httpOnly session cookie (`pm_session`, 30-day TTL);
  CLI/agent → `Authorization: Bearer <api_token>` from `PM_TOKEN` (token
  non-expiring). Anonymous still allowed.
- **Password hashing:** `node:crypto` scrypt, salted, stored `scrypt$<salt>$<hash>`.
  No new dependency.
- **Provisioning:** `pm user create` + `/register` page. No admin role.
- **Data model:** `users(id, username UNIQUE, password_hash, api_token UNIQUE,
  created_at, updated_at)`, `sessions(id, user_id, created_at, expires_at)`.
  `tasks` gains nullable `creator_id` / `assignee_id` (FK users) via idempotent
  `ALTER TABLE` — old rows stay NULL.
- **Endpoints:** `POST /api/auth/register|login|logout`, `GET /api/auth/me`,
  `GET /api/users`. `POST /api/tasks` sets `creator_id` from caller + optional
  `assignee`; `PATCH` accepts `assignee` (null = unassign); `GET /api/tasks`
  takes `?assignee=<id|username>`.
- **CLI:** `pm user create|list`, `pm login`, `pm whoami`; `task create/list`
  gain `--assignee <id|username>`, `task update` gains `--assignee`/`--unassign`.
- **Assignment:** assignee must be an existing user (validated). User deletion deferred.
- **Priority:** fixed scale `low|medium|high|now` (default `medium`) on every
  task. `GET /api/tasks` takes `?priority=`; create/update accept `priority`;
  each status column auto-sorts `now → high → medium → low`, then rank. CLI:
  `--priority` on `task create/list/update`.

## Deferred (YAGNI — do not build now)
No hard purge of trash. No SSE/websocket (polling only). No single-binary
packaging. User delete/soft-delete, password reset, roles, token rotation.