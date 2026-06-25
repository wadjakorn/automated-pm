# Design: Ticket URL + Deep Link

Date: 2026-06-26
Status: Approved (user delegated remaining decisions; proceed to implementation)
Tracks board ticket: `PAt6mCAK3pqH` ("feature: ticket's url + deep link to ticket")

## Goal

Give every ticket a shareable URL. Opening a ticket reflects it in the address
bar; pasting a shared link routes straight to that ticket — selecting its
project and opening the drawer — even for a recipient who doesn't know the
project.

## Background

The app is a single client page (`app/page.tsx` → `<Board/>`, App Router,
`force-dynamic`). Project selection already lives in the URL as `?project=<id>`
(`components/useApp.ts` `useProjects`). Opening a ticket today is **local
state only** — `Board`'s `editing: Task | null`, rendered as `<EditDrawer/>` —
so it has no URL presence and cannot be shared.

`GET /api/tasks/[id]` already exists and returns the full `Task` (including
`project_id`). **No server/API changes are needed.**

## Locked decisions

- **URL shape:** query param (no new routes). While a ticket is open the live
  URL is `?project=<pid>&task=<tid>`.
- **Shareable/copied link:** **task-only** — `${origin}/?task=<tid>`. The app
  resolves the project from the task. (Recommended + chosen.)
- **History:** opening a ticket uses `router.push` so browser **Back closes the
  drawer**; closing strips the `task` param with `router.replace`.
- **Copy affordance:** a "Copy link" button in the `EditDrawer` header;
  clipboard write with a manual-copy fallback toast.

## Architecture

Client-only. The `task` query param becomes the **single source of truth** for
which ticket is open; `Board.editing` is derived from it.

### Files

1. **`lib/client.ts`** — add one method:
   `getTask: (id: string) => req<Task>("GET", \`/api/tasks/${id}\`)`.

2. **`lib/ticket-link.ts`** (new, pure, unit-tested) — two helpers with no
   React/DOM deps:
   - `shareLink(origin: string, id: string): string` → `\`${origin}/?task=${id}\``.
   - `resolveTicketAction(taskParam: string | null, tasks: Task[], editingId: string | null): TicketAction`
     where
     `type TicketAction = { kind: "open-local"; task: Task } | { kind: "fetch" } | { kind: "close" } | { kind: "noop" }`.
     Logic:
     - `!taskParam` → `editingId ? {kind:"close"} : {kind:"noop"}`
     - `taskParam === editingId` → `{kind:"noop"}`
     - task found in `tasks` → `{kind:"open-local", task}`
     - otherwise → `{kind:"fetch"}`

3. **`components/useApp.ts`** — add `useTaskRoute()` returning
   `{ taskParam, openTask, closeTask }`:
   - `taskParam = useSearchParams().get("task")`
   - `openTask(id)`: clone current params, `set("task", id)`, `router.push`.
   - `closeTask()`: clone current params, `delete("task")`, `router.replace`.

4. **`components/Board.tsx`** — wire the drawer to the URL:
   - Call `useTaskRoute()`; keep `editing` state but make the URL drive it.
   - A resolution effect on `[taskParam, tasks, selectedId]` runs
     `resolveTicketAction(taskParam, tasks, editing?.id ?? null)`:
     - `noop` → nothing
     - `close` → `setEditing(null)`
     - `open-local` → `setEditing(action.task)`
     - `fetch` → guarded by a `useRef` keyed on `taskParam` (dedupe in-flight):
       `api.getTask(taskParam)` →
       - success: if `t.project_id !== selectedId` call `select(t.project_id)`
         (updates `?project`, triggers the existing `loadSm` effect); then
         `setEditing(t)`.
       - failure (`not_found` — covers a soft-deleted ticket, since `getTask`
         excludes deleted by default): `toast("Ticket not found", "error")` then
         `closeTask()` to strip the bad param.
   - Card click handler `onOpen` → `openTask(t.id)` (was `setEditing`).
   - `EditDrawer` `onClose` → `closeTask()`.
   - **Stale-`sm` guard on render:** show the drawer only when `sm` belongs to
     the open ticket's project —
     `{editing && sm && sm.statuses[0]?.project_id === editing.project_id && <EditDrawer .../>}`.
     (All of a project's statuses share `project_id`.) This prevents a
     cross-project deep link from briefly rendering the drawer against the
     previous project's state machine.

5. **`components/EditDrawer.tsx`** — header gets a "Copy link" button next to
   the ✕:
   ```tsx
   <button
     onClick={async () => {
       const link = shareLink(window.location.origin, task.id);
       try { await navigator.clipboard.writeText(link); toast("Link copied", "success"); }
       catch { toast(link, "success"); } // fallback: surface the link to copy manually
     }}
     className="text-gray-400 hover:text-gray-200"
     title="Copy link to this ticket"
   >🔗 Copy link</button>
   ```
   (Match the existing drawer's gray classes on this branch.)

## Data flow

```
open /?task=Y
  → Board: resolveTicketAction(Y, tasks, null)
      in current list  → open-local → setEditing
      not in list      → fetch → api.getTask(Y)
                            ok      → select(project_id) if needed; setEditing(t); URL → ?project=X&task=Y
                            404/del → toast "Ticket not found"; closeTask()
click ticket → openTask(id) [push] → effect → drawer opens
close (✕)    → closeTask() [replace strip] → effect → drawer closes
Back button  → pops the pushed entry → no task param → effect → close
Copy link    → copy `${origin}/?task=id` → toast
```

## Error handling / edge cases

- **Not found / soft-deleted:** toast + strip the `task` param; stay on the board.
- **Cross-project link:** auto-`select` the ticket's project; the stale-`sm`
  render guard holds the drawer until the correct state machine loads.
- **Projects not yet loaded:** `getTask` is independent of project load; once
  fetched, `select(project_id)` drives the rest.
- **Fetch loop safety:** the `useRef` dedupe key prevents re-fetching the same
  `taskParam`; once `editing.id === taskParam`, the action is `noop`.
- **Auth:** tasks are not access-controlled, so deep links work anonymously.
- **Polling:** the existing poll already pauses while `editing` is set; opening
  via URL keeps that behavior.

## Testing

- **Unit (`lib/ticket-link.test.ts`):**
  - `shareLink("https://h", "abc")` === `"https://h/?task=abc"`.
  - `resolveTicketAction` across all four branches: null+editing→close,
    null+none→noop, param===editing→noop, param in tasks→open-local(task),
    param not in tasks→fetch.
- **Preview verification (browser):** click a ticket → URL gains `task=`;
  Copy link → clipboard holds `${origin}/?task=<id>`; paste the task-only link
  in a fresh tab → correct project board loads and the drawer opens; bad/deleted
  id → "Ticket not found" toast and clean URL; Back closes the drawer.

## Out of scope (YAGNI)

- New path-based routes (`/t/<id>`), breadcrumbs, project id in the share link,
  per-comment/section anchors. Query param only.

## Build order

1. `lib/ticket-link.ts` + tests (pure).
2. `lib/client.ts` `getTask`.
3. `components/useApp.ts` `useTaskRoute`.
4. `components/Board.tsx` URL-driven drawer + resolution effect + stale-sm guard.
5. `components/EditDrawer.tsx` Copy link button.
6. Preview verification.
