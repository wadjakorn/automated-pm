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

- Output is **TTY-aware**: piped/redirected (non-TTY) stdout prints **JSON**, so
  agent parsing is unchanged; an interactive terminal prints pretty tables/board.
  Pass `--json` to force JSON anywhere (`--pretty` forces tables;
  `--no-color`/`NO_COLOR` disable color).
- **Exit 0** = success; **non-zero** = failure (JSON has an `error` field).
- **Global flags** (any position): `--json`, `--pretty`, `--no-color`,
  `--api <url>` (overrides `PM_API`), `--version`.
- Parse stdout as JSON. Branch on `error`:

| `error` value         | HTTP | Meaning / what to do |
|-----------------------|------|----------------------|
| `cli_error`           | —    | Network/usage problem (server down, missing flag). Read `message`. |
| `bad_request`         | 400  | Invalid input (e.g. empty title, removing an in-use status). |
| `not_found`           | 404  | Bad id. |
| `illegal_transition`  | 422  | Move not allowed by the state machine. `message` says why. |
| `conflict`            | 409  | Optimistic-lock failure. `current` holds the fresh row — re-read and retry with the new `version`. |
| `unauthorized`        | 401  | Bad login credentials. |

## Auth (optional)

Auth is **additive** — every command works without logging in. Set
`PM_TOKEN=<api_token>` and the CLI sends it as a bearer token so tasks you
create are attributed to you (`creator_id`). Get a token once:

```
pm user create --username <u> --password <p>   # -> { user, api_token }
pm login --username <u> --password <p>          # -> { api_token }
pm whoami                                        # current user (needs PM_TOKEN) or null
pm user list                                     # id + username for --assignee
export PM_TOKEN=<api_token>
```

Anonymous tasks (no `PM_TOKEN`) have `creator_id`/`assignee_id` = `null` —
this is the default and fully supported.

## Commands

`--project` accepts a project **id or name** (names are unique among live
projects); the server resolves either. Quote names with spaces.

```
pm project create --name <name> [--description <text>]   # name must be unique
pm project list

pm status list --project <id|name>
pm status add --project <id|name> --key <key> --label <label> [--final]
pm status set-final --project <id|name> --key <key> --final <true|false>
pm status remove --project <id|name> --key <key>

pm transition add --project <id|name> --from <key> --to <key>
pm transition remove --project <id|name> --from <key> --to <key>

pm task create --project <id|name> --title <title> [--description <text>] [--status <key>] [--assignee <id|username>] [--priority <low|medium|high|now>]
pm task list --project <id|name> [--status <key>] [--include-deleted] [--include-archived] [--assignee <id|username>] [--priority <low|medium|high|now>]
pm task move --id <id> --status <key> [--version <n>]
pm task update --id <id> [--title <t>] [--description <text>] [--version <n>] [--assignee <id|username> | --unassign] [--priority <low|medium|high|now>]
pm task delete --id <id>          # soft delete (recoverable)
pm task restore --id <id>
pm task archive --id <id>         # final-status only; off the board but stays live
pm task unarchive --id <id>
pm task archive-final --project <id|name> --status <final-key>   # bulk-archive a final column
pm task create --project <id|name> --stdin          # one task per non-empty stdin line

# Ticket links: --to is a ticket URL or bare id; --type = blocks|blocked-by|causes|caused-by|relates
pm task link add  --id <id> --to <url|id> --type <type>   # link shows in BOTH tickets (inverse label)
pm task link list --id <id>
pm task link rm   --id <id> --link <linkId>

pm board --project <id|name>                        # columns view: tasks grouped by status

# changing --name or --remote-url is a guarded edit: it needs --confirm.
pm project update --project <id|name> [--name <new>] [--description <text>] [--remote-url <url>] [--confirm]
pm project delete --project <id|name>               # soft delete (recoverable via UI/Trash)

pm status update --project <id|name> --key <key> [--label <l>] [--final <true|false>] [--order <n>]
#   generalizes `status set-final`; set-final still works.

# Action aliases: ls=list, mv=move, rm=delete  (e.g. pm task ls --project demo)
```

`--assignee` accepts a user **id or username**; assignee must be an existing
user. Creator is set from `PM_TOKEN` (the authenticated caller), not a flag.

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
- **Archive ≠ delete.** `pm task archive` sets `archived_at`, allowed **only for
  tickets in a final status**. Archived tickets leave every board but stay live:
  hidden from `pm task list` unless `--include-archived`, still openable by
  direct link, and included in future search. `archived_at` is independent of
  `deleted_at` (archived tickets are not in Trash). Reverse with
  `pm task unarchive`; `pm task archive-final --project <p> --status <final-key>`
  archives a whole final column at once.
- **Always set an assignee.** Every task you create or pick up should name an
  owner — pass `--assignee <id|username>` on `pm task create`, or `pm task update
  --id <id> --assignee <id|username>` for an existing one. Default to the acting
  user (`pm whoami` when `PM_TOKEN` is set); if there's no user context, ask who
  owns it rather than leaving it `null`. The assignee must be an existing user
  (else `not_found`). Use `--unassign` only when deliberately clearing ownership.
- **Always set a priority.** Tickets carry a fixed scale `low | medium | high |
  now` (default `medium`). Pass `--priority <p>` on create/update to reflect real
  urgency instead of relying on the default; an unknown value returns
  `bad_request`. `pm task list` auto-sorts each column `now → high → medium → low`
  then by rank. Filter with `--priority <p>`.

## Typical workflow

```bash
# 1. Find or create the project, capture its id
pm project list
PID=$(pm project create --name "Sprint 12" | sed -n 's/.*"id": "\(.*\)".*/\1/p' | head -1)

# 2. Inspect the state machine before moving anything
pm status list --project "$PID"

# 3. Create a task — always name an owner and a priority (defaults to first status)
TID=$(pm task create --project "$PID" --title "Write API tests" --assignee alice --priority high | sed -n 's/.*"id": "\(.*\)".*/\1/p' | head -1)

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
