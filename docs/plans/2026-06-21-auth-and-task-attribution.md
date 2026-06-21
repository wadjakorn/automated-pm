# Plan — Basic Auth + Task Attribution

Date: 2026-06-21

## Goal

Add username/password login, plus nullable `creator_id` / `assignee_id` on tasks.
Auth is **optional and additive**: every existing endpoint keeps working
unauthenticated (CLI/agents unchanged). Identity, when present, fills the new
nullable columns. Supersedes the original "no login, all users equal" decision.

## Locked decisions

- **Enforcement:** optional/additive. No endpoint requires auth.
- **Mechanism:** browser → httpOnly session cookie (`pm_session`); CLI/agent →
  `Authorization: Bearer <api_token>` from `PM_TOKEN` env (anonymous allowed).
- **Provisioning:** `pm user create` (CLI) + `/register` page (browser). No admin role.
- **Password hashing:** `node:crypto` scrypt, salted. Stored `scrypt$<saltHex>$<hashHex>`.
  No new dependency.
- **Session TTL:** session cookie expires 30 days; `api_token` non-expiring (until... user delete, deferred).
- **Assignment:** assignee must be an existing user (validated). User deletion deferred (YAGNI).

## Data model

```
users(
  id TEXT pk, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  api_token TEXT UNIQUE NOT NULL, created_at, updated_at
)
sessions(
  id TEXT pk, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at, expires_at
)
tasks  +creator_id  TEXT NULL REFERENCES users(id)
       +assignee_id TEXT NULL REFERENCES users(id)
```

- `users`/`sessions`: `CREATE TABLE IF NOT EXISTS`.
- `tasks` columns added via `ALTER TABLE ... ADD COLUMN`, guarded by `PRAGMA table_info(tasks)`
  so migration is idempotent. Existing rows → NULL on both (backward compat).
- `api_token = nanoid(32)`. `id = nanoid(12)`.

## lib/auth.ts (new)

- `hashPassword(pw): string` / `verifyPassword(pw, stored): boolean` — scrypt, timing-safe compare.
- `currentUser(req): User | null` — read `pm_session` cookie → sessions (live, unexpired)
  → user; else `Authorization: Bearer` → `users.api_token`. Returns null if neither.
- `createSession(userId): {id, expires_at}` (30d); `destroySession(id)`.
- Cookie helpers: httpOnly, sameSite=lax, path=/, maxAge 30d.

## lib/repo.ts additions

- `createUser(username, password)` — dup-username guard (`bad_request`), hash, gen token.
- `getUser(ref)` / `resolveUserId(ref)` — id first, then username (mirrors getProject).
- `verifyLogin(username, password): User | null`.
- `listUsers(): User[]`.
- `createTask(...)` — accept `creatorId?`, `assignee?` (id|username, validated via resolveUserId).
- `updateTask(...)` — accept `assignee?: string | null` (null = unassign; string validated).
- `listTasks(...)` — optional `assignee` filter (resolve to id); join usernames for display.
- Task row mapper returns `creator_id`, `assignee_id`, `creator_username`, `assignee_username`.

## API routes

- `app/api/auth/register/route.ts` — POST {username,password} → createUser + session cookie, return {user, api_token}.
- `app/api/auth/login/route.ts` — POST → verifyLogin + session cookie, return user (no token in body).
- `app/api/auth/logout/route.ts` — POST → destroySession + clear cookie.
- `app/api/auth/me/route.ts` — GET → currentUser() or null.
- `app/api/users/route.ts` — GET list (id, username, created_at only — never hash/token).
- `app/api/tasks/route.ts` POST — `creator_id` from currentUser(req); optional `assignee`.
- `app/api/tasks/[id]/route.ts` PATCH — optional `assignee` (string|null).
- `app/api/tasks/route.ts` GET — optional `?assignee=<id|username>`.
- Never serialize `password_hash`; `api_token` only returned by register / `pm user create` / `pm login`.

## CLI (cli/pm.ts)

Auth header from `PM_TOKEN` (added to `api()` when set). New commands:
```
pm user create --username <u> --password <p>     # -> {user, api_token}
pm user list
pm login --username <u> --password <p>            # -> {api_token}; user exports PM_TOKEN
pm whoami                                          # -> current user (from PM_TOKEN) or null
```
Extended:
```
pm task create ... [--assignee <id|username>]      # creator = PM_TOKEN user
pm task update --id <id> [--assignee <id|username> | --unassign]
pm task list   --project <id|name> [--assignee <id|username>]
```
HELP + `PM_TOKEN` note added.

## UI

- `lib/client.ts`: auth methods (register/login/logout/me), listUsers, assignee in create/update, assignee filter.
- `components/useApp.ts`: load `/api/auth/me` + users; expose currentUser, users.
- `components/Nav.tsx`: show current user + Logout, or Login/Register links.
- `app/login/page.tsx`, `app/register/page.tsx`.
- `components/EditDrawer.tsx`: assignee `<select>` (users) + show creator (read-only).
- `components/TaskCard.tsx`: small assignee badge.
- `lib/types.ts`: `User`; extend `Task` (creator_id, assignee_id, creator_username, assignee_username).

## Tests (lib/*.test.ts, Vitest)

- `auth`: hash≠plaintext, verify true/false, wrong-format stored → false.
- `repo` (temp PM_DB_PATH): createUser dup → bad_request; verifyLogin ok/bad; createTask without identity → creator_id NULL (backward compat); assignee by username resolves; assign unknown user → bad_request; unassign sets NULL.

## Docs

- `PROMPT.md`, `README.md`, `AGENTS.md`, `.agents/skills/project-manager-cli/SKILL.md` — auth optional/additive, new endpoints, CLI commands, PM_TOKEN, attribution.
- Re-sync skill copies: `~/.claude/skills/project-manager-cli/SKILL.md`, `~/.hermes/skills/productivity/project-manager-cli/SKILL.md`.

## Build order

1. Migrations (db.ts) + types.
2. lib/auth.ts (+ test).
3. repo.ts users/login/attribution (+ test).
4. auth API routes + users route.
5. tasks routes: creator/assignee/filter.
6. CLI: auth header, user/login/whoami, task flags.
7. UI: client + useApp + Nav + login/register + EditDrawer/TaskCard.
8. Docs + skill re-sync.
9. Verify: unit tests; e2e (register → token → create task with creator → assign → filter → anonymous create still NULL).

## Deferred (YAGNI)

User delete/soft-delete. Password reset. Roles/permissions. Token rotation. Rate limiting.
```
