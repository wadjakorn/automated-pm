# Design: CLI Enhance/Optimize + Web Light Mode

Date: 2026-06-25
Status: Approved (pending written-spec review)

Two independent features bundled in one effort:

1. **CLI** — enhance/optimize the `pm` CLI (output, new commands, ergonomics, robustness) and realign its skill doc.
2. **Light mode** — add a light/"bright" theme to the web UI (system default + manual override).

They share no code. Each can be implemented and tested on its own.

---

## Feature 1 — CLI enhance/optimize

### Background

`cli/pm.ts` is a thin HTTP→JSON wrapper over the Next.js API (`PM_API`, default
`http://localhost:3000`). Every command prints `JSON.stringify(data, null, 2)`
to stdout; exit 0 on success, non-zero on error. The server enforces all rules
(state machine, optimistic locking, soft delete), so the CLI cannot corrupt
state.

Two problems motivate this work:

- **Output is JSON-only.** Fine for agents, noisy for humans.
- **The CLI under-exposes the server.** `lib/repo.ts` implements operations the
  CLI never surfaces: `updateProject` (rename/description), `softDeleteProject`,
  and `updateStatus`'s `label` + `sort_order`.

### Architecture

Keep the single-file `cli/pm.ts` structure. Introduce a **render layer** between
command handlers and stdout. Today handlers call `out(data)` / `unwrap(r)` which
JSON-dump directly. New flow:

```
handler -> result object  -> render(result, {command, mode}) -> stdout
                            -> mode = json | pretty (resolved once at startup)
```

`unwrap`/`out` stop printing raw JSON unconditionally; they hand the payload plus
a command tag to `render()`, which dispatches on mode.

#### Output mode resolution (the core decision)

Resolve a single `mode` at startup, in priority order:

1. `--json` flag present → `json`.
2. `--pretty` flag present → `pretty`.
3. stdout is **not** a TTY (`!process.stdout.isTTY`, e.g. piped to `jq`/file) → `json`.
4. otherwise → `pretty`.

Rationale: agents and scripts pipe stdout, so they keep getting JSON with **zero
flag changes** — no existing automation breaks. Interactive humans get tables.
`--json`/`--pretty` are explicit overrides.

Color: enabled only in `pretty` mode AND when `NO_COLOR` is unset AND `--no-color`
absent. JSON mode is never colored.

These flags (`--json`, `--pretty`, `--no-color`, `--api`, `--version`/`-v`) are
**global** — stripped from argv before command dispatch so they work in any
position.

#### Pretty renderers (per result shape)

| Result shape | Pretty rendering |
|---|---|
| Project array (`project list`) | Table: `ID  NAME  DESCRIPTION  CREATED` |
| Single project (create/update) | One-line confirmation: `✓ project <name> (<id>)` |
| StateMachine (`status list`) | Statuses table (`KEY LABEL FINAL ORDER`) + transition list `from → to` |
| Task array (`task list`) | Table: `ID  STATUS  TITLE  V` (V=version); colorized status badge |
| Single task (create/move/update/restore) | One-line: `✓ <action> <id> [<title>] → <status> (v<n>)` |
| Board (`board`) | Columns: one block per status in transition/sort order, tasks listed under each |
| `{ ok: true }` (delete) | One-line: `✓ deleted <id>` |
| Error payload | `✗ <code>: <message>` + an actionable hint line (see Error handling) |

Pretty rendering is **best-effort formatting of the same data** the JSON mode
returns — never a different data set. A renderer that doesn't recognize a shape
falls back to pretty-printed JSON (safety net).

Implementation notes:
- Plain-text column tables computed from max cell width; no table library
  (keep zero new deps). Truncate long titles/descriptions to terminal width.
- Status badge color: deterministic map by status key with a default; final
  statuses dimmed/checkmarked. ANSI codes inline, gated by the color flag.

### New & changed commands

| Command | Backend | Notes |
|---|---|---|
| `pm board --project <id\|name>` | GET statuses + tasks | New. Group live tasks by status, ordered by the project's status sort order. Pretty = columns; json = `{ project, columns:[{status,tasks:[]}] }`. |
| `pm project update --project <id\|name> [--name <new>] [--description <text>]` | `PATCH /api/projects/[id]` | New CLI surface for existing `updateProject`. Requires the route to accept PATCH (verify/add). |
| `pm project delete --project <id\|name>` | `DELETE /api/projects/[id]` | New CLI surface for existing `softDeleteProject`. Requires the route to accept DELETE (verify/add). |
| `pm status update --project <id\|name> --key <key> [--label <l>] [--final <bool>] [--order <n>]` | `PATCH /api/projects/[id]/statuses` | Generalizes `status set-final`. Keep `set-final` as a documented alias for back-compat. Route must accept `label`/`sort_order` in addition to `is_final`. |
| `pm task create ... [--stdin]` | POST per line | With `--stdin`, read newline-separated titles from stdin, create one task each (same project/status). Output = array of created tasks (json) or one ✓ line each (pretty). |

**Aliases** (resolved before dispatch, documented in help):
`ls`→`list`, `mv`→`move`, `rm`→`delete`. Applied at the action position, e.g.
`pm task ls`, `pm task mv`, `pm task rm`. `pm project ls` etc. also work.

**Global flags / meta:**
- `--api <url>` overrides `PM_API` for that invocation.
- `--version` / `-v` prints CLI version (from package.json) and exits.
- `pm <group> --help` and `pm help <group>` print group-scoped help; bare
  `pm` / `pm help` prints the full help (existing behavior, expanded).

### Error handling

Current failure for a down server is the opaque `{"error":"cli_error","message":"fetch failed"}`.
Improve:

- Catch fetch network errors; if the cause is `ECONNREFUSED` (or message
  contains `fetch failed`), emit a hint: *"Cannot reach <BASE>. Is the server
  running? Start it with `npm run dev`."* — still exit non-zero, still valid
  JSON in json mode.
- Map known error codes → one-line actionable hint appended in pretty mode:
  - `illegal_transition` → "Run `pm status list --project <p>` to see allowed moves."
  - `conflict` → "Row changed elsewhere; re-read and retry with the new version."
  - `not_found` → "Re-list to get a valid id."
  - `bad_request` → echo server message (already actionable).
- JSON mode error shape is **unchanged** (`{ error, message, ... }`) so agents'
  parsing is untouched. Hints are pretty-mode only.

Exit codes stay binary: 0 success, non-zero failure. (No new code classes — keeps
the existing contract that scripts rely on.)

### Skill doc realignment (`~/.claude/skills/project-manager-cli/SKILL.md`)

The skill currently documents an **auth system that does not exist** (`pm user
create/list`, `pm login`, `pm whoami`, `PM_TOKEN`, `--assignee`, `--unassign`,
`401 unauthorized`). Per decision, **do not remove and do not build** — instead:

- Add a prominent banner at the top of every auth-related section:
  **`⚠️ NOT IMPLEMENTED YET — planned, low priority. The commands/flags below do
  not exist in the current CLI; do not call them.`**
- Move the auth command block under a clearly separated "Planned (not yet
  implemented)" heading so an agent never mistakes it for a live command.
- Update the live sections to document the **new** reality: TTY-aware
  output + `--json`/`--pretty`/`--no-color`, `--api`, `pm board`, `pm project
  update/delete`, generalized `pm status update`, aliases (`ls`/`mv`/`rm`),
  `--stdin` bulk create.
- Update the output/error contract section: note that **piped/non-TTY stdout is
  still JSON** (so the existing `jq`/`sed` workflows in the skill remain correct),
  and that `--json` guarantees JSON regardless of TTY.

### Testing (CLI)

- Unit-test the **render layer** in isolation (pure functions: shape in →
  string out) with vitest: project table, task table, board columns, single-item
  confirmations, error+hint lines, JSON passthrough. No server needed.
- Unit-test **mode resolution** (flag precedence + TTY fallback) by injecting a
  fake `{ isTTY, argv, env }`.
- Keep an end-to-end smoke path documented in the skill's §7 (already exists),
  extended to assert: piped output parses as JSON; `--pretty` over a pipe still
  renders a table.
- Refactor `cli/pm.ts` so the render + mode-resolution logic is importable by the
  test (extract to `cli/render.ts` + `cli/mode.ts`, or export from `pm.ts`).

---

## Feature 2 — Web light/bright mode

### Background

Tailwind is configured with `darkMode: "class"` (good base), but:
- `app/layout.tsx` hardcodes `<html className="dark">`.
- `app/globals.css` hardcodes `color-scheme: dark` and dark scrollbar colors.
- Components use semantic tokens for surfaces (`bg-bg`, `bg-bg-soft`,
  `bg-bg-card`, `border-border`) **but** ~40 hardcoded text/accent classes
  (`text-gray-*`, `text-white`, `bg-blue-600`, red/green badges) that won't flip.

### Architecture: CSS-variable semantic tokens

Chosen over scattering `dark:` prefixes: one source of truth, future themes
trivial, and the ~40 hardcoded classes become a **one-time semantic rename**
rather than a per-site color-doubling.

#### Token layer (`globals.css` + `tailwind.config.ts`)

Define CSS variables on `:root` (light) and `.dark` (dark), then map Tailwind
color tokens to `var(--...)`:

- Surfaces: `--bg`, `--bg-soft`, `--bg-card`, `--border` (existing tokens, now
  variable-backed with light values added).
- Text: **new** `--fg` (primary), `--fg-muted`, `--fg-subtle` → Tailwind
  `text-fg`, `text-fg-muted`, `text-fg-subtle`.
- Accent: `--accent`, `--accent-hover` → `bg-accent` / `hover:bg-accent-hover`
  (replaces hardcoded `bg-blue-600`/`hover:bg-blue-500`).
- Semantic state colors (danger/success used by Trash/badges): keep red/green
  but provide light-appropriate values via variables (`--danger-*`,
  `--success-*`) or `dark:` on those few spots.

Dark values reuse current palette (`#0d1117`, `#161b22`, `#1c2128`, `#30363d`,
gray-200 text, blue-600 accent). Light values: a clean bright set (e.g. `#ffffff`
/ `#f6f8fa` / `#ffffff` surfaces, `#1f2328` text, accent `#0969da`) — GitHub-light-like
to mirror the existing GitHub-dark-like palette.

`color-scheme` becomes a variable-driven declaration: `dark` under `.dark`,
`light` under `:root`, so native form controls / scrollbars follow the theme.

#### Theme runtime

- **`ThemeProvider`** (client component, wraps the app in `layout.tsx`):
  resolved theme = `localStorage.theme` if set, else `matchMedia('(prefers-color-scheme: dark)')`.
  Applies/removes `.dark` on `document.documentElement`. Exposes
  `{ theme, setTheme }` via context. `theme` is `'light' | 'dark' | 'system'`;
  `system` follows the media query live (listener).
- **Anti-FOUC inline script** in `layout.tsx` `<head>`: a tiny blocking script
  that sets the `.dark` class from localStorage/media **before** first paint, so
  there's no dark→light flash on load. `<html>` no longer hardcodes `dark`.
- **Toggle** in `Nav.tsx`: a sun/moon button cycling/setting theme; writes
  `localStorage.theme`; updates context. Shows current state.

#### Component refactor

Mechanical sweep across `components/*` and `app/**`:
- `text-gray-200/300` → `text-fg`; `text-gray-400/500` → `text-fg-muted`/`text-fg-subtle`;
  `text-white` → `text-fg` (or a `--fg-strong` if contrast needs it).
- `bg-blue-600 hover:bg-blue-500` → `bg-accent hover:bg-accent-hover`.
- Leave `bg-bg*` / `border-border` as-is (already tokens; just gain light values).
- Red/green Trash + badge spots: switch to state tokens or add `dark:` variants
  for those few.

### Data flow

```
first load → inline head script reads localStorage/media → sets .dark pre-paint
React mounts → ThemeProvider syncs context to the same source of truth
user clicks toggle → setTheme → write localStorage + toggle .dark class → context updates
system theme changes (theme==='system') → media listener re-applies .dark
```

### Error handling / edge cases

- `localStorage` unavailable (SSR / privacy mode): fall back to `system`; never throw.
- SSR: the inline script runs client-side only; server renders neutral markup,
  the script fixes the class before paint. Provider uses `useEffect` for the
  listener so SSR is safe.
- No flash: verified by the blocking head script.

### Testing (light mode)

- Manual/preview verification via the dev server (the change is visual):
  toggle flips all surfaces+text+accent in both themes; reload persists; no FOUC;
  system mode follows OS; native scrollbars/inputs match.
- Optional unit test for the theme-resolution helper (pure function:
  `(stored, prefersDark) → 'light'|'dark'`).
- Screenshot both themes (board + settings) as proof.

---

## Out of scope

- Building real auth/users/assignee (server, CLI, UI). Documented as
  "planned, low priority" in the skill only.
- Table/TUI libraries or new runtime deps for the CLI (hand-rolled formatting).
- Additional themes beyond light/dark (token layer makes them easy later).
- WAL checkpoint / DB maintenance.

## Build order

1. CLI: extract render + mode layers, wire TTY-aware output, add new commands,
   error hints, aliases, `--stdin`. Tests.
2. Verify/extend API routes for `project update/delete` (PATCH/DELETE) and
   `status update` (label/sort_order) if missing.
3. Skill doc realignment.
4. Light mode: token layer → ThemeProvider + anti-FOUC → toggle → component sweep.
   Preview-verify + screenshots.
