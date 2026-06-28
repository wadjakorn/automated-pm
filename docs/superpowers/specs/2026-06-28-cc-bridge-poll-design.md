# cc-bridge → poll/cron redesign

**Date:** 2026-06-28
**Branch:** `claude/modest-lewin-598d57` (repurposes PR #16)
**Status:** approved design, ready for implementation plan

## Problem

The push-based cc-bridge (PR #16) auto-starts headless Claude Code when a ticket
enters Ready. It works, but setup is too hard and the architecture is
over-engineered for a single dev machine: an always-on inbound HTTP listener
bound to a Tailscale IP, an `X-Secret` gate, a `launchd`/`systemd --user`
service, a durable server-side retry queue, an in-process scheduler, and a
Python runner. Every one of those is a thing the user must install, secure, and
patch on the machine.

## Goal

Flip push → pull. The dev machine **polls** the PM server for ready work and
does it. No inbound listener, no Tailscale binding, no inbound secret, no
service to install, no server-side queue. The scheduler is **Claude Code's own
built-in routine** — the user already runs Claude Code; a native scheduled
routine fires every N minutes and works the board. The only code deliverable is
server-side: one optimized read endpoint, plus a documented routine.

## Architecture

```
BEFORE (push):
  PM server --webhook--> listener.py (Tailscale bind, X-Secret, launchd)
            --> run.py --> claude

AFTER (pull):
  Claude Code (dev machine, built-in scheduled routine, every N min)
     --GET /api/cc-bridge/ready--> PM server
     for each ready ticket:
        claim  (pm task move todo→doing, optimistic version)
        implement → test → open PR → pm task move → Code Review
```

Auth direction flips from **inbound** (`X-Secret` the Pi must present to the
machine) to **outbound** (the routine presents `PM_TOKEN` to the PM server —
the exact bearer the `pm` CLI already sends).

**The routine is `pm`-only.** It does not curl a bespoke endpoint. It runs
`pm ready` (new command, §2) to fetch work and `pm task move` to claim — the
same CLI the agent skill, AGENTS.md, and README already teach. The optimized
endpoint exists to *back* `pm ready`; the agent never touches raw HTTP.

## Components

### 1. Server endpoint — `GET /api/cc-bridge/ready`

New route `app/api/cc-bridge/ready/route.ts`. Returns the actionable work
queue as compact JSON. Two optional filters, both omittable:
- `?project=<id|name>` — **omit = all bridge-enabled projects** (cross-project);
  **pass = that one project**, resolved by id OR name (names are unique among
  live projects, so the routine pins a memorable name like `automated-pm`).
- `?assignee=<id|username>` — **omit = any assignee** (unchanged); **pass =
  only tickets assigned to that user**. Lets a fleet of pollers split work
  (machine A pins `--assignee claude-a`, B pins `claude-b`), or restricts the
  routine to tickets explicitly handed to the bot. Mirrors `pm task list`.

```json
[
  {
    "ticket": "Hv5nGMwRiigf",
    "project": "lPFgh_dyrALH",
    "projectName": "automated-pm",
    "repo": "git@github.com:me/repo.git",
    "title": "Machine: webhook listener",
    "priority": "high",
    "description": "..."
  }
]
```

Rules:

- **Ready status** = `process.env.CC_BRIDGE_READY_STATUS` (default `"todo"`).
- **Opt-in projects only** = projects with a non-null `remote_repo_url` (the
  routine needs a repo to work in). Projects without a repo URL never appear —
  even if `?project=` names one (returns `[]`).
- Excludes deleted (`deleted_at`) and archived (`archived_at`) tickets.
- Sort: priority `now → high → medium → low`, then `rank` (reuse the existing
  `PRIORITY_ORDER_SQL` ordering).
- `repo` comes from `projects.remote_repo_url` (column already exists).
- `description` included so the routine has context in one round-trip.

**Gate:** `/ready` requires a **valid `PM_TOKEN`** (`Authorization: Bearer`,
resolved to a user; `401` otherwise). This is deliberately *stricter* than the
open board — the endpoint gates **autonomous code execution**, so it must not be
anonymously enumerable. It reuses the existing token auth the `pm` CLI already
sends (no new secret, no second mechanism). Operator runs `pm user create` once
to mint the token, sets `PM_TOKEN` in the routine env.

### 2. CLI — `pm ready`

New command `pm ready [--project <id|name>] [--assignee <id|username>] [--json]`,
wrapping `GET /api/cc-bridge/ready` (sends `PM_TOKEN` like every other `pm`
call). This is what the routine calls — keeping the agent on the one CLI the
skill + AGENTS.md document, never raw HTTP. Both filters omittable (= all bridge
projects, any assignee). Output is JSON when piped (TTY-aware, like the rest of
`pm`). Add a short entry to AGENTS.md + the project-manager-cli skill so an
agent knows the command exists.

### 3. Repo function — `listReadyTickets()`

New function in `lib/repo.ts`, single SQL join. Optional `projectRef` narrows
to one project (resolved via id-or-name `getProject`); optional `assignee`
narrows to one user (resolved via the existing `resolveUserId`). An unknown
project or assignee ref yields `[]` (not an error):

```sql
SELECT t.*, p.name AS project_name, p.remote_repo_url
FROM tasks t
JOIN projects p ON p.id = t.project_id
WHERE p.deleted_at IS NULL
  AND p.remote_repo_url IS NOT NULL
  AND t.deleted_at IS NULL
  AND t.archived_at IS NULL
  AND t.status_key = ?            -- ready status
  AND (? IS NULL OR p.id = ?)     -- optional single-project filter
  AND (? IS NULL OR t.assignee_id = ?)  -- optional assignee filter
ORDER BY <PRIORITY_ORDER_SQL>, t.rank
```

Returns the shaped rows the route serializes. One query, no per-project loop.

### 4. Claim = status move (no new code)

The routine claims each ticket with the **existing** move endpoint:
`pm task move --id <id> --status doing --version <n>`. Optimistic `version`
means if two pollers ever race, the loser gets `409 conflict` and skips. A
claimed ticket leaves `todo`, so it is absent from the next `/ready` poll.
**Status is the lock — zero new locking code, no server-side queue.**

### 5. Dev-side routine (documentation, not code)

`cc-bridge/README.md` is rewritten to describe a single Claude Code built-in
scheduled routine. No script, no service, no plist. The doc gives:

- a fleet of machines can each pin `--assignee <bot-user>` so they split work
  with no overlap; a single machine omits it.
- the routine prompt: run `pm ready --project <name> --json` → for each ticket:
  `pm task move --status doing` (claim) → implement → run tests → open PR →
  `pm task move` to Code Review → on block, move to `blocked` and note why,
- the pinned project handle is the **project name** (`automated-pm`), remembered
  in the routine setting. (Known tradeoff: renaming the project breaks the
  pinned handle — re-point the routine. Omit `--project` to work all projects.)
- how to schedule it inside Claude Code (every N minutes),
- the two env values it needs: `PM_API` (PM server URL) and `PM_TOKEN` (the
  bearer; mint once with `pm user create`),
- subscription-auth guardrail: **never set `ANTHROPIC_API_KEY`** (would bill the
  metered API; the routine must use the Max subscription),
- repo mapping: the routine clones / works the `repo` URL each ticket carries.

### 6. Deletions

Remove the entire push machinery:

| Path | Reason |
|------|--------|
| `cc-bridge/listener.py` | inbound listener gone |
| `cc-bridge/run.py` | the routine IS the runner |
| `cc-bridge/install.sh` | no service to install |
| `cc-bridge/com.you.ccbridge.plist` | no launchd service |
| `cc-bridge/config.example.json` | repo map now from `remote_repo_url` |
| `lib/webhook.ts` | no server-side queue |
| `lib/scheduler.ts` | no in-process drain loop |
| `instrumentation.ts` | only existed to start the scheduler |
| `app/api/cc-bridge/tick/route.ts` | queue drain gone |
| `app/api/cc-bridge/resume/route.ts` | resume dropped (YAGNI) |
| `webhook_deliveries` table + `idx_webhook_due` (db.ts) | no queue |
| `moveTask` push hook (`enqueueDelivery`/`kickDelivery` in repo.ts) | no push |
| `lib/webhook.test.ts`, `lib/webhook-emit.test.ts` | test deleted code |

`cc-bridge/README.md` is kept but rewritten (§4). `instrumentation.ts` removal
also drops the `serverExternalPackages` edge-runtime workaround if it was added
solely for the scheduler — verify before removing.

`webhook_deliveries` is dropped from the migration. Since the table only ever
existed on this unmerged branch (never shipped to `main`), no `DROP TABLE`
migration is needed — just remove the `CREATE TABLE`. Note for review: confirm
no production DB already has it; if so add a defensive `DROP TABLE IF EXISTS`.

## Data flow (happy path)

1. User drags ticket to **Ready** (`todo`) in the browser. Project has a
   `remote_repo_url`. No webhook fires — nothing server-side reacts.
2. Within N minutes the Claude Code routine wakes, `GET /api/cc-bridge/ready`.
3. Ticket appears (compact row with repo + description).
4. Routine `pm task move --status doing` → claim succeeds.
5. Routine implements in the repo, runs tests, opens a PR.
6. Routine `pm task move --status completed` → ticket lands in **Code Review**.
7. Next poll: ticket is no longer in `todo`, so it is not returned again.

## Error handling

- **Two pollers race to claim** → optimistic `version` → loser gets `409`,
  skips. (Single-machine is the norm; this just makes double-run safe.)
- **Run crashes mid-ticket** → ticket stuck in `doing`, absent from `/ready`.
  v1: documented; the operator nudges it back to `todo`, or a future routine
  reclaims stale `doing` tickets. Out of scope for v1 (YAGNI).
- **Bad/blocked ticket** → routine moves it to `blocked` and writes why, so it
  leaves the ready set and a human can intervene.
- **PM server unreachable** → poll fails, routine logs and retries next tick.
  No durability needed: the ticket simply stays in `todo` until a poll succeeds.
- **Missing/invalid `PM_TOKEN`** → `401`, no work leaked.

## Testing

- `lib/repo.ts`: unit test `listReadyTickets()` — only returns ready-status
  tickets in repo-bearing, non-deleted projects; excludes archived/deleted;
  honors a custom `CC_BRIDGE_READY_STATUS`; optional `projectRef` narrows to one
  project (and returns `[]` for a project without a repo URL); optional
  `assignee` narrows to one user (unknown ref → `[]`); priority+rank ordering.
- `app/api/cc-bridge/ready`: route test — `401` with no/invalid token; `200` +
  correct shape with a valid `PM_TOKEN`; `?project=` and `?assignee=` narrow.
- `pm ready` CLI: returns JSON when piped; honors `--project` and `--assignee`.
- Delete the two webhook test files.
- Full suite green after deletions (no dangling imports of removed modules).

## Out of scope (v1)

- Resume-on-PR-comment events (dropped — the routine can be re-pointed at a
  ticket manually).
- Stale-`doing` auto-recovery.
- Per-ticket concurrency limits / a server-side lease endpoint (status-move
  claim is enough for one machine).

## Why this is simpler

Net code **shrinks**: one read endpoint + one repo function + one `pm ready`
command + a doc, against the deletion of a Python listener, a Python runner, an
installer, a plist, a queue module, a scheduler, an instrumentation hook, two
API routes, a DB table, and the push hook. Nothing to install or keep running
on the machine except Claude Code, which the user already runs. And the whole
routine speaks one language — `pm` — instead of mixing raw HTTP, Python, and a
service manager.
