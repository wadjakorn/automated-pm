# Agent Guide — driving Project Manager via the `pm` CLI

This file is for an LLM agent that needs to create/update/delete projects and
tasks. You operate through the `pm` CLI, which calls the local HTTP API. The
server enforces all rules (state machine, optimistic locking, soft delete), so
you cannot corrupt state by issuing a bad command — you get a JSON error instead.

## Prerequisites (check these first)

1. **Server must be running.** The CLI talks to `PM_API` (default
   `http://localhost:3000`). If you get `{"error":"cli_error","message":"fetch failed"}`,
   the server is down — start it with `npm run dev` and retry.
2. **`pm` on PATH.** If `pm` is "command not found", run `npm run setup` once
   from the repo (installs deps + global `tsx` + `npm link` + a `~/.local/bin`
   symlink; safe to re-run). As a no-install fallback, call it as
   `npm run cli -- <args>` from the repo. If you instead see
   `ERR_MODULE_NOT_FOUND: Cannot find package 'tsx'`, the global `tsx`
   interpreter is missing — `npm run setup` (or `npm install -g tsx`) fixes it.
3. **Different port?** Prefix commands with `PM_API=http://localhost:<port>`.

## Output & error contract

- Every command prints **JSON to stdout**.
- **Exit 0** = success; **non-zero** = failure (JSON has an `error` field).
- Parse stdout as JSON. Branch on `error`:

| `error` value         | HTTP | Meaning / what to do |
|-----------------------|------|----------------------|
| `cli_error`           | —    | Network/usage problem (server down, missing flag). Read `message`. |
| `bad_request`         | 400  | Invalid input (e.g. empty title, removing an in-use status). |
| `not_found`           | 404  | Bad id. |
| `illegal_transition`  | 422  | Move not allowed by the state machine. `message` says why. |
| `conflict`            | 409  | Optimistic-lock failure. `current` holds the fresh row — re-read and retry with the new `version`. |

## Commands

```
pm project create --name <name> [--description <text>]
pm project list

pm status list --project <id>
pm status add --project <id> --key <key> --label <label> [--final]
pm status set-final --project <id> --key <key> --final <true|false>
pm status remove --project <id> --key <key>

pm transition add --project <id> --from <key> --to <key>
pm transition remove --project <id> --from <key> --to <key>

pm task create --project <id> --title <title> [--description <text>] [--status <key>]
pm task list --project <id> [--status <key>] [--include-deleted]
pm task move --id <id> --status <key> [--version <n>]
pm task update --id <id> [--title <t>] [--description <text>] [--version <n>]
pm task delete --id <id>          # soft delete (recoverable)
pm task restore --id <id>
```

## Key rules you must respect

- **State machine is per project.** Default statuses:
  `backlog → todo → doing → completed → tested → released`. `released` is **final**
  (no moves out of it). Moves only succeed along defined transitions.
- **Discover the real graph before moving.** A project's statuses/transitions may
  have been customized. Run `pm status list --project <id>` and read the returned
  `statuses` (each has `is_final`) and `transitions` (`from_key`→`to_key`) instead
  of assuming the defaults.
- **Optimistic locking.** `--version` is optional. If omitted, the CLI reads the
  current version and writes (convenient, last-writer-wins). If you pass
  `--version` and it's stale, you get `conflict` with the current row — reconcile
  and retry. Use `--version` when you must not clobber a concurrent edit.
- **Soft delete only.** `pm task delete` sets `deleted_at`; the task disappears
  from normal lists but is recoverable via `pm task restore`. Find deleted tasks
  with `pm task list --project <id> --include-deleted` (filter where
  `deleted_at != null`).

## Typical workflow

```bash
# 1. Find or create the project, capture its id
pm project list
PID=$(pm project create --name "Sprint 12" | sed -n 's/.*"id": "\(.*\)".*/\1/p' | head -1)

# 2. Inspect the state machine before moving anything
pm status list --project "$PID"

# 3. Create a task (defaults to first status, usually backlog)
TID=$(pm task create --project "$PID" --title "Write API tests" | sed -n 's/.*"id": "\(.*\)".*/\1/p' | head -1)

# 4. Move it forward, one legal step at a time
pm task move --id "$TID" --status todo
pm task move --id "$TID" --status doing

# 5. Edit fields
pm task update --id "$TID" --description "cover the 409 path"

# 6. List current board state
pm task list --project "$PID"
```

When extracting ids, prefer a JSON parser if you have one (`jq -r .id`); the
`sed` above is a dependency-free fallback.
