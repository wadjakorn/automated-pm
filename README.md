# Project Manager — Kanban + CLI

Browser Kanban board with a per-project **state machine**, **soft delete**, optimistic
locking, and a JSON **CLI** so an LLM agent can drive the same data the browser shows.

- **Optional login** (username/password). Auth is additive — the board and CLI
  work fully without it; signing in just attributes who **created** and who is
  **assigned** a task. No roles; all users have the same permissions.
- Dark mode first.
- Default statuses: `backlog → todo → doing → completed → tested → released` (released is final).
- State machine (statuses, transitions, final flags) is **per project** and editable in Settings.
- Deleting is soft: tasks go to **Trash** and can be restored.

## Run (no extra install for the user)

```bash
npm install      # one time
npm run dev      # starts server at http://localhost:3000
```

Open http://localhost:3000. SQLite data is stored at `./data/pm.db`.

> The dev server can also be started via the saved config in
> [`.claude/launch.json`](.claude/launch.json) (`next-dev` / `next-start`).

## CLI (for agents / scripting)

The CLI talks to the **running server** (`PM_API`, default `http://localhost:3000`).
Start the server first (`npm run dev`) — otherwise commands fail with
`{"error":"cli_error","message":"fetch failed"}`. Output is TTY-aware — piped
output is JSON (so scripts/`jq` keep working), an interactive terminal prints
pretty tables; pass `--json` to force JSON anywhere. Exit non-zero on error.

> **Driving this from an LLM agent?** See [`AGENTS.md`](AGENTS.md) for the full
> command reference, JSON/error contract, and the rules (state machine,
> optimistic locking, soft delete) an agent must respect.

Install the standalone `pm` command once. On a fresh machine, the one-shot
setup does everything (deps + global `tsx` + `npm link` + a `~/.local/bin`
fallback symlink) and is safe to re-run:

```bash
npm run setup   # installs pm so it works from ANY directory
```

`pm` runs `cli/pm.ts` directly via the `tsx` interpreter (shebang
`#!/usr/bin/env -S tsx`), so a global `tsx` must be on PATH — `npm run setup`
ensures it. If `pm` still isn't found, add the printed bin dir to your `PATH`.

Manual equivalent if you'd rather not use the script:

```bash
npm install && npm install -g tsx && npm link
ln -sf "$(npm prefix -g)/bin/pm" ~/.local/bin/pm   # fallback if npm global bin isn't on PATH
```

Then call it directly (no `npm run cli --` prefix):

```bash
pm project create --name "Website" --description "marketing site"
pm project list

PID=<project id from above>
pm task create --project $PID --title "Design hero" --status backlog
pm task list --project $PID
pm task move --id <task id> --status todo
pm task delete --id <task id>
pm task restore --id <task id>
pm board --project $PID                              # columns view (tasks by status)
printf 'task one\ntask two\n' | pm task create --project $PID --stdin   # bulk
# aliases: pm task ls / mv / rm

# projects
pm project update --project $PID --description "updated"
pm project delete --project $PID                    # soft delete

# state machine
pm status list --project $PID
pm status add --project $PID --key qa --label "QA"
pm status update --project $PID --key qa --label "Quality" --order 3
pm transition add --project $PID --from doing --to qa

# optional auth (attributes creator/assignee)
pm user create --username alice --password secret   # -> { user, api_token }
export PM_TOKEN=<api_token>                          # creator of new tasks = alice
pm task create --project $PID --title "Triage bug" --assignee alice
pm task list --project $PID --assignee alice

# priority: low|medium|high|now (default medium); lists auto-sort now→high→medium→low
pm task create --project $PID --title "Prod down" --priority now
pm task list --project $PID --priority now           # filter by priority
```

`--project` accepts a project **id or its name** — names are unique among live
projects, so `--project "Website"` works anywhere an id does (quote names with
spaces). Creating or renaming a project to a name already in use returns a
`bad_request`.

**Login is optional.** Without `PM_TOKEN` (or a browser session) everything
still works — tasks just have a `null` creator/assignee. Create an account with
`pm user create` (or the `/register` page in the browser), then set
`PM_TOKEN=<api_token>` so the CLI attributes new tasks to you. `--assignee`
takes a user id or username. Browser sessions use an httpOnly cookie (30 days);
the CLI token does not expire.

Without `npm link`, the same commands work via `npm run cli -- <args>`.

Illegal moves (no transition, or out of a final state) return HTTP 422 with a reason.
Concurrent edits are guarded by an optimistic `version`; a stale write returns 409.

## Backup & migrate (DB export / restore)

The whole database lives in one SQLite file (`./data/pm.db`) — **projects, tasks,
state machines, AND users/sessions**. `scripts/db.ts` exports and restores it
directly (no web UI, no running server needed). It uses SQLite's online-backup
API, so it folds the `-wal` in and is safe to run while the dev server is up; a
plain `cp data/pm.db` can miss data still sitting in the WAL.

```bash
npm run db -- info                       # DB path + row counts
npm run db:export                        # -> data/backups/pm-<timestamp>.db
npm run db:export -- --out ~/pm.db       # custom path
npm run db:restore -- --in ~/pm.db       # prints a preview, refuses without --yes
npm run db:restore -- --in ~/pm.db --yes # snapshots current DB first, then swaps in
```

The export is a single self-contained `.db` file. SQLite's format is
architecture-independent, so a backup taken on your laptop restores cleanly on
the dietpi (ARM) server. `restore` validates the source is a real PM database,
snapshots the current DB to `data/backups/pre-restore-*.db`, then replaces the
file and clears stale `-wal`/`-shm`. **Restart the server after a restore** so it
reopens the new file. `data/` is gitignored — copy backups out (e.g. `scp`).

### Localhost → dietpi home server

```bash
# 1. on your laptop
npm run db:export -- --out ~/pm-export.db
scp ~/pm-export.db dietpi@<host>:/path/to/project-manager/data/

# 2. on the dietpi (clone the repo, npm install, then)
npm run db:restore -- --in data/pm-export.db --yes
npm run build && npm run start        # serves the board on the dietpi
```

`PM_DB_PATH` overrides the DB location on either machine if you keep the file
elsewhere.

## Layout

- `lib/statemachine.ts` — single source of truth for transition rules (unit tested).
- `lib/auth.ts` — scrypt password hashing + session/token → user resolution.
- `lib/repo.ts` — SQLite data access (soft-delete aware, version checks).
- `app/api/**` — REST endpoints used by both the browser and the CLI.
- `cli/pm.ts` — flag-based CLI → API.
- `scripts/db.ts` — export/restore the SQLite DB (includes users); for backup + migrating between machines.
- `components/**`, `app/**` — dark Kanban UI (board, settings, trash).

## Test

```bash
npm test         # state machine unit tests (Vitest)
```
