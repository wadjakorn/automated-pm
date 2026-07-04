# Hidden status columns + configurable default status

Two independent, additive project-level settings for the Kanban board. Both
extend existing flat-column tables (no new tables, no settings blob) and flow
through existing update paths.

Tickets: `o8zPsrId2al_` (hide status column), `XOLdM7Lmr-jL` (default status).

## Feature 1 — Hide status column

A project owner can hide specific status columns from the **web board**. The
setting is project-level (stored on the status row), so every viewer sees the
same board. Hidden columns are not rendered on the web board; their tasks stay
live and reachable via list / search / deep link, and remain movable.

### Data
- `statuses.hidden INTEGER NOT NULL DEFAULT 0`, added by idempotent `ALTER`
  guarded with the same `PRAGMA table_info` check used for `priority` /
  `archived_at`. Old rows migrate to `hidden = 0` → unchanged behavior.
- `Status` type gains `hidden: boolean`. `mapStatus` coerces 0/1 → boolean.

### Repo
- `updateStatus` patch gains `hidden?: boolean`; merged as `patch.hidden ??
  s.hidden` and written in the existing `UPDATE statuses` statement.
- No new guard. Hiding a status never orphans anything (tasks stay put), and a
  hidden status still participates in the state machine.

### API / client
- `PATCH /api/projects/:id/statuses` already forwards the whole body to
  `updateStatus`; `hidden` rides along. No route change.
- `api.updateStatus` already spreads an arbitrary `patch`. No client change.

### UI
- **Web board (`components/Board.tsx`):** render
  `sm.statuses.filter((s) => !s.hidden)`. Hidden columns disappear.
- **Settings (`components/Settings.tsx`):** add a `hidden` checkbox to each
  status row, beside the existing `final` checkbox, calling
  `api.updateStatus(pid, key, { hidden })`.
- **EditDrawer:** unchanged. Its move targets come from `allowedTargets(sm,
  status)` (transition-driven), so a task in a hidden column can still be moved
  out via its deep-linked drawer. This is why the drawer is NOT filtered.

### CLI
- `pm status update` gains `--hidden <true|false>`, parsed like `--final`.
- **`pm board` does NOT hide** — it renders every column but tags hidden ones
  with a `(hidden)` marker. Rationale: hiding is a human declutter preference;
  an agent/CLI operator needs full visibility. `renderBoard` appends the marker
  when `col.status.hidden` is true.

### Explicit non-interactions
- **cc-bridge `ready`** is unaffected — that endpoint filters by status
  server-side and never consults `hidden`. `hidden` is purely a board-render
  concern.
- Drag-and-drop into a hidden column is naturally impossible (no column on the
  board); no special handling.

## Feature 2 — Configurable default status

A project owner can set which status new tasks land in. Applies to UI and CLI
task creation when no explicit status is given. Falls back to the first status.

### Data
- `projects.default_status_key TEXT` (nullable), added by the same idempotent
  `ALTER` guard. Old rows migrate to `NULL` → fall back to first status
  (current behavior).
- `Project` type gains `default_status_key: string | null`.

### Repo
- `createTask` resolves status as:
  `data.status ?? validDefault ?? sm.statuses[0]?.key`, where `validDefault` is
  `project.default_status_key` only if it still matches a live status key.
  **Graceful stale fallback:** if the configured default status was later
  removed, creation silently falls back to the first status instead of erroring
  — no extra guard added to `removeStatus`.
- `updateProject` gains `default_status_key?: string | null`. Validated to be
  an existing status key of that project (else `bad_request`). **Not guarded**
  by `confirm` — unlike name / remote_repo_url, it is not an identity or safety
  field. Written in the existing `UPDATE projects` statement.
- Constraint deliberately minimal: the key must exist. No "non-final only"
  rule (YAGNI — a final default is odd but harmless).

### API / client
- `PATCH /api/projects/:id` already forwards the body to `updateProject`;
  `default_status_key` rides along. No route change.
- `api.updateProject` patch type gains `default_status_key?: string | null`.

### UI
- **Settings project section:** a `<select>` of the project's statuses to pick
  the default; empty option = "First status". On change, `api.updateProject(id,
  { default_status_key })`. Not behind the name/URL "Edit" confirm gate.

### CLI
- `pm project update` gains `--default-status <key>` (`''` clears → `null`).

### Non-retroactive
- Changing the default never moves existing tasks; it only affects future
  `createTask` calls with no explicit status.

## Testing
- `lib/repo-*.test.ts` pattern (in-memory/temp DB). Add cases:
  - hidden: `updateStatus({ hidden: true })` persists and round-trips as
    boolean; task in a hidden status still listed by `listTasks`.
  - default: `createTask` with no status uses `default_status_key`; stale
    default falls back to first status; `updateProject` rejects an unknown
    default key with `bad_request`.
- CLI flag parsing covered by existing `cli/*.test.ts` style if warranted;
  otherwise exercised via the repo tests above.

## Rollout
Both columns are additive and nullable/defaulted; a running dietpi instance
migrates in place on next `getDb()`. No data backfill. No breaking change to the
JSON/exit-code CLI contract.
