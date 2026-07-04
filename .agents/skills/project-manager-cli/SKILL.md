---
name: project-manager-cli
description: "Drive the Project Manager Kanban app (projects + tasks) from an LLM agent via the `pm` CLI. Covers the JSON/exit-code contract, the per-project state machine, optimistic locking (409), and soft delete/restore. Use when asked to create/move/update/delete tasks or projects, or to script board changes against a running Project Manager server."
version: 1.0.0
author: wadjakorn.tonsri
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [kanban, cli, project-management, task-tracking, state-machine, json]
    related_skills: [planning-methodology]
---

# Project Manager CLI (`pm`)

Drive a browser-based Kanban app (projects + tasks) from the command line. The
`pm` CLI talks to the **same local HTTP API the browser uses**, so anything you
change shows up on the board after its poll (~4s). The server enforces every
rule (state machine, optimistic locking, soft delete) — a bad command returns a
JSON error, it cannot corrupt state.

## When to use this skill

- The user asks to create / list / move / update / delete projects or tasks.
- The user wants to script or batch board changes (e.g. "create 5 backlog tasks").
- The user asks why a move was rejected, or hits a `conflict` / `409`.
- You need to inspect a project's columns and allowed transitions before acting.

## 0. Prerequisites — check these FIRST

1. **Server running.** The CLI hits `PM_API` (default `http://localhost:3000`).
   If you see `{"error":"cli_error","message":"fetch failed"}`, the server is
   down. Start it from the repo root with `npm run dev`, wait for
   `http://localhost:3000`, then retry.
2. **`pm` on PATH.** On a fresh machine run `npm run setup` once from the repo
   — it installs deps + a global `tsx` + `npm link` + a `~/.local/bin` fallback
   symlink, and is safe to re-run. No-install fallback: `npm run cli -- <args>`
   from the repo (note the `--`).
   - **`ERR_MODULE_NOT_FOUND: Cannot find package 'tsx'` when running `pm`
     outside the repo?** This is the shebang, not a missing global package.
     Older `cli/pm.ts` shipped `#!/usr/bin/env -S node --import tsx` — `node
     --import tsx` resolves the bare `tsx` specifier against the **current
     directory**, so it only works inside a dir whose `node_modules` has tsx.
     Installing tsx globally does **not** fix it. Fix the interpreter line to
     `#!/usr/bin/env -S tsx` (tsx as a PATH executable, cwd-independent) and
     ensure a `tsx` binary is on PATH (`npm install -g tsx`). Then `pm` works
     from any directory.
3. **Non-default port.** Prefix every command: `PM_API=http://localhost:3001 pm ...`.

Quick liveness check:

```bash
pm project list
```

Exit 0 with a JSON array (possibly empty) → server is up and CLI works.

## 1. Output & error contract

- Every command prints **JSON to stdout**.
- **Exit 0 = success**; **non-zero = failure** (and the JSON has an `error` field).
- Always parse stdout as JSON and branch on `error`. Prefer `jq` when present;
  the `sed` fallback in §4 is dependency-free.

| `error` value        | HTTP | Meaning / what to do |
|----------------------|------|----------------------|
| `cli_error`          | —    | Network/usage problem (server down, missing flag). Read `message`. |
| `bad_request`        | 400  | Invalid input (empty title, removing an in-use status, orphaning a task). |
| `not_found`          | 404  | Bad id. Re-list to get a correct one. |
| `illegal_transition` | 422  | Move not allowed by the state machine. `message` says why. |
| `conflict`           | 409  | Optimistic-lock failure. `current` holds the fresh row — re-read, then retry with the new `version`. |
| `unauthorized`       | 401  | Bad login credentials (`pm login` with a wrong password). |

- **Output is TTY-aware.** A pipe/redirect (non-TTY) prints **JSON** — so the
  `jq`/`sed` recipes below are unchanged. An interactive terminal prints pretty
  tables/board. Force a mode with `--json` (always JSON, even on a TTY) or
  `--pretty`; disable color with `--no-color` or `NO_COLOR`. Agents should pass
  `--json` when they need to be certain, though piped output is already JSON.
- **Global flags:** `--api <url>` (overrides `PM_API`), `--version`, plus the
  output flags above. Output flags and `--api` may appear in any position.
  `--version` is global (print CLI version) only before the subcommand or when
  it carries no value (`pm --version`); after a subcommand, `--version <n>` is
  that command's optimistic-lock option (`task update` / `task move`). `-v` is
  always the global version flag.

## 2. Command reference

`--project` accepts a **project id OR its name** (names are unique among live
projects). `--project 'My Site'` and `--project qgYkAVRhbeVh` are equivalent —
the server resolves either, id first. Quote names with spaces.

**Auth is OPTIONAL/ADDITIVE.** Every command works anonymously. Set
`PM_TOKEN=<api_token>` to attribute created tasks to a user (`creator_id`).
`--assignee` takes a user id OR username. Anonymous tasks have `null`
creator/assignee — that is normal, not an error.

```
# auth (optional)
pm user create --username <u> --password <p>   # -> { user, api_token }
pm user list
pm login --username <u> --password <p>          # -> { api_token }; export PM_TOKEN
pm whoami                                        # current user (needs PM_TOKEN) or null

pm project create --name <name> [--description <text>]   # name must be unique
pm project list

pm status list   --project <id|name>
pm status add    --project <id|name> --key <key> --label <label> [--final]
pm status set-final --project <id|name> --key <key> --final <true|false>
pm status remove --project <id|name> --key <key>

pm transition add    --project <id|name> --from <key> --to <key>
pm transition remove --project <id|name> --from <key> --to <key>

pm task create  --project <id|name> --title <title> [--description <text>] [--status <key>] [--assignee <id|username>] [--priority <low|medium|high|now>]
pm task create  --project <id|name> --stdin              # one task per non-empty stdin line
pm task list    --project <id|name> [--status <key>] [--include-deleted] [--include-archived] [--assignee <id|username>] [--priority <low|medium|high|now>]
pm task move    --id <id> --status <key> [--version <n>]
pm task update  --id <id> [--title <t>] [--description <text>] [--version <n>] [--assignee <id|username> | --unassign] [--priority <low|medium|high|now>]
pm task delete  --id <id>          # soft delete (recoverable)
pm task restore --id <id>

# Archive: file a FINISHED ticket off the board while it stays live (direct
# link + future search still find it). Only tickets in a FINAL status can be
# archived. archive-final does a whole final column at once.
pm task archive       --id <id>
pm task unarchive     --id <id>
pm task archive-final --project <id|name> --status <final-key>

# Ticket links: --to accepts a ticket URL or bare id; --type is one of
# blocks | blocked-by | causes | caused-by | relates (inverse label derived for the other ticket)
pm task link add  --id <id> --to <url|id> --type <type>
pm task link list --id <id>
pm task link rm   --id <id> --link <linkId>

pm board        --project <id|name>                      # columns view: tasks grouped by status
pm ready        [--project <id|name>] [--assignee <id|username>]   # ready tickets (+repo, +desc) for the poll routine; needs PM_TOKEN

# changing --name or --remote-url is a GUARDED edit: it needs --confirm (else
# bad_request). --description and --default-status are NOT guarded. --remote-url
# '' clears the URL; --default-status '' clears the default (→ first status).
# --default-status sets the status new tasks land in when created without an
# explicit --status; the key must be an existing status (else bad_request), and
# a stale default (its status later removed) falls back to the first status.
pm project update --project <id|name> [--name <new>] [--description <text>] [--remote-url <url>] [--default-status <key>] [--confirm]
pm project delete --project <id|name>                    # soft delete (recoverable via the UI/Trash)

# --hidden hides a status column from the WEB board only (project-level; every
# viewer sees the same board). Tasks in a hidden status stay live, listed, and
# movable; `pm board` still shows the column tagged "(hidden)".
pm status update --project <id|name> --key <key> [--label <l>] [--final <true|false>] [--order <n>] [--hidden <true|false>]
#   generalizes `status set-final`; `set-final` still works.

# Action aliases: ls=list, mv=move, rm=delete  (e.g. `pm task ls --project demo`)
```

## 3. Rules you MUST respect

- **Reflect your work in the ticket's status.** When you start implementing a
  ticket, move it to `doing` FIRST (`pm task move --id <id> --status doing`),
  before writing any code. When the work is finished, move it to `completed`.
  Step through each legal edge (e.g. `todo → doing`, `doing → completed`); there
  is no multi-hop move. This keeps the board honest about what is in progress vs
  done — do it even when the user only says "implement this ticket".
- **State machine is per project.** Default chain:
  `backlog → todo → doing → completed → tested → released`. `released` is
  **final** — no moves out of it. Moves only succeed along defined edges.
- **Discover the real graph before moving.** A project may have customized
  statuses/edges. Run `pm status list --project <id>` and read the returned
  `statuses` (each has `is_final`) and `transitions` (`from_key`→`to_key`)
  instead of assuming defaults. Move ONE legal step at a time.
- **Optimistic locking.** `--version` is optional. Omit it → CLI reads the
  current version then writes (convenient, last-writer-wins). Pass `--version`
  when you must not clobber a concurrent edit; on stale you get `conflict` with
  the current row — reconcile and retry with the fresh `version`.
- **Soft delete only.** `pm task delete` sets `deleted_at`; the task vanishes
  from normal lists but is recoverable via `pm task restore`. Find deleted ones
  with `pm task list --project <id> --include-deleted` (filter `deleted_at != null`).
- **Archive ≠ delete.** `pm task archive` sets `archived_at` and is allowed
  **only for tickets in a final status** (else `bad_request`). Archived tickets
  leave every board but stay **live** — `pm task list` hides them (pass
  `--include-archived` to see them), yet a direct id lookup (`pm task list ... `
  / the UI deep link) still resolves them, and future search will include them.
  Reverse with `pm task unarchive`. `archived_at` and `deleted_at` are
  independent: archived tickets are not in Trash and trashed tickets are not in
  Archive. `pm task archive-final --project <p> --status <final-key>` archives a
  whole final column in one call.
- **Status edits are guarded.** Removing a status or edge that an existing task
  depends on returns `bad_request` — the server refuses to orphan a task.
- **`--project` takes id OR name.** Project names are unique among live
  projects, so you can address one by name (`--project 'My Site'`) instead of
  copying its id. Creating/renaming to a name already taken returns
  `bad_request`. A name frees up once its project is trashed.
- **Auth is optional; identity is attribution only.** No command requires a
  login. With `PM_TOKEN` set, new tasks get `creator_id` = that user. `--assignee
  <id|username>` must name an existing user (else `not_found`); `--unassign`
  clears it. There are no roles — auth never grants or denies access, it only
  records who created/owns a task. User deletion is not implemented yet.
- **Always set an assignee.** Every task you create or pick up should name an
  owner — pass `--assignee <id|username>` on `pm task create`, or `pm task
  update --id <id> --assignee <id|username>` for an existing one. Default to the
  acting user (`pm whoami` when `PM_TOKEN` is set); if there's no user context,
  ask who owns it rather than leaving it `null`. The assignee must be a real
  user (else `not_found`) — create one with `pm user create` if the board has
  none. Use `--unassign` only when deliberately clearing ownership.
- **Always set a priority.** Tickets carry a fixed scale `low | medium | high |
  now` (default `medium`, not per-project unlike statuses). Set `--priority <p>`
  on create/update to reflect real urgency instead of relying on the default; an
  unknown value returns `bad_request`. `pm task list` auto-sorts each status
  column by priority (`now → high → medium → low`), then by rank — so the most
  urgent ticket per column is always on top. Filter with `--priority <p>`.

## 4. Typical workflow

```bash
# 1. Find or create the project, capture its id (jq preferred)
pm project list
PID=$(pm project create --name "Sprint 12" | jq -r .id)
# dependency-free fallback if no jq:
# PID=$(pm project create --name "Sprint 12" | sed -n 's/.*"id": *"\([^"]*\)".*/\1/p' | head -1)

# 2. Inspect the state machine BEFORE moving anything
pm status list --project "$PID"

# 3. Create a task — always name an owner and a priority (defaults to first
#    status, usually backlog)
TID=$(pm task create --project "$PID" --title "Write API tests" \
  --assignee alice --priority high | jq -r .id)

# 4. Move it forward, one legal step at a time
pm task move --id "$TID" --status todo
pm task move --id "$TID" --status doing

# 5. Edit fields
pm task update --id "$TID" --description "cover the 409 path"

# 6. List current board state
pm task list --project "$PID"
```

## 5. Handling a conflict (409)

When you pass `--version` and it's stale:

```bash
pm task move --id "$TID" --status doing --version 3
# -> {"error":"conflict","current":{...,"version":5,"status_key":"todo"}}, non-zero exit
```

Recovery: read `current` from the payload, decide whether your change still
applies, then retry with the fresh version:

```bash
pm task move --id "$TID" --status doing --version 5
```

If you don't care about clobbering, just omit `--version` and the CLI handles
the read-then-write for you.

## 6. Pitfalls (learn these once)

- **Forgetting `--` with the npm fallback.** `npm run cli project list` passes
  args to npm, not `pm`. Use `npm run cli -- project list`.
- **Assuming default statuses.** Always `pm status list` first — a project may
  have added `qa` / removed `tested` / changed which state is final.
- **Multi-step moves in one call.** There is no multi-hop move. `backlog →
  doing` directly fails with `illegal_transition` unless an edge exists. Step
  through each legal transition.
- **Treating soft delete as gone.** A "missing" task may just be soft-deleted.
  Check with `--include-deleted` before recreating it (avoids duplicates).
- **Server not started.** `fetch failed` is almost always the server being down,
  not a CLI bug. Start `npm run dev` and retry.
- **`Cannot find package 'tsx'` outside the repo.** Shebang bug, not a missing
  install — see §0.2. Use `#!/usr/bin/env -S tsx`, not `node --import tsx`.
  Until fixed, `npm run cli -- <args>` from the repo always works.
- **Wrong port.** If the dev server picked another port (3001+), every command
  needs `PM_API=http://localhost:<port>`.
- **Pretty vs JSON.** If you script `pm` and parse stdout, you already get JSON
  (non-TTY). Only humans in a terminal see tables. Never parse pretty output —
  pass `--json` if unsure.

## 7. Verification (know when you're done)

Run this end-to-end against a running server; it exercises every rule:

```bash
PID=$(pm project create --name "skill-verify" | jq -r .id)
TID=$(pm task create --project "$PID" --title "demo" | jq -r .id)
pm task move --id "$TID" --status todo            # exit 0 (legal)
pm task move --id "$TID" --status released         # non-zero, illegal_transition (no direct edge)
pm task delete --id "$TID"                          # exit 0, soft delete
pm task list --project "$PID" --include-deleted    # shows it with deleted_at set
pm task restore --id "$TID"                         # exit 0, back on board
```

Pass criteria: legal move exits 0; the illegal jump exits non-zero with
`{"error":"illegal_transition"}`; the deleted task appears only under
`--include-deleted`; restore returns it to a normal list.
