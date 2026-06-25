# Ticket URL + Deep Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every ticket a shareable `/?task=<id>` URL; opening a ticket reflects it in the address bar, and pasting a shared link routes to that ticket (selecting its project + opening the drawer).

**Architecture:** Client-only. The `task` query param becomes the single source of truth for which ticket is open; `Board.editing` is derived from it via a pure resolver. `GET /api/tasks/[id]` already returns the task incl. `project_id`, so deep-link project resolution needs no server change.

**Tech Stack:** Next.js 15 App Router, React 19, `next/navigation` (`useRouter`/`useSearchParams`), vitest.

## Global Constraints

- **No server/API changes** — `GET /api/tasks/[id]` already exists and returns `Task` (incl. `project_id`).
- **No new runtime dependencies.**
- **URL shape is query-param only** — no new routes. Live URL while open: `?project=<pid>&task=<tid>`.
- **Shareable link is task-only:** `${origin}/?task=<tid>`.
- **History:** opening a ticket uses `router.push` (Back closes the drawer); closing strips `task` with `router.replace`.
- **Match this branch's existing styles** — drawer uses `text-white` / `text-gray-400` / `bg-blue-600` (no light-mode tokens on this branch).
- **Tests:** vitest, `npm test` (`vitest run`), config includes `**/*.test.ts`.

---

## Task 1: Pure link/resolution helpers (`lib/ticket-link.ts`)

**Files:**
- Create: `lib/ticket-link.ts`
- Test: `lib/ticket-link.test.ts`

**Interfaces:**
- Produces:
  - `shareLink(origin: string, id: string): string`
  - `type TicketAction = { kind: "open-local"; task: Task } | { kind: "fetch" } | { kind: "close" } | { kind: "noop" }`
  - `resolveTicketAction(taskParam: string | null, tasks: Task[], editingId: string | null): TicketAction`

- [ ] **Step 1: Write the failing test**

```ts
// lib/ticket-link.test.ts
import { describe, it, expect } from "vitest";
import { shareLink, resolveTicketAction } from "./ticket-link";
import type { Task } from "./types";

const t = (id: string): Task => ({
  id,
  project_id: "p",
  title: id,
  description: null,
  status_key: "todo",
  rank: 1,
  version: 1,
  created_at: "",
  updated_at: "",
  deleted_at: null,
  creator_id: null,
  assignee_id: null,
  creator_username: null,
  assignee_username: null,
});

describe("shareLink", () => {
  it("builds a task-only link", () => {
    expect(shareLink("https://h", "abc")).toBe("https://h/?task=abc");
  });
});

describe("resolveTicketAction", () => {
  it("no param + something open → close", () => {
    expect(resolveTicketAction(null, [], "x")).toEqual({ kind: "close" });
  });
  it("no param + nothing open → noop", () => {
    expect(resolveTicketAction(null, [], null)).toEqual({ kind: "noop" });
  });
  it("param already open → noop", () => {
    expect(resolveTicketAction("a", [t("a")], "a")).toEqual({ kind: "noop" });
  });
  it("param in the loaded list → open-local with that task", () => {
    const task = t("a");
    expect(resolveTicketAction("a", [task], null)).toEqual({ kind: "open-local", task });
  });
  it("param not in the loaded list → fetch", () => {
    expect(resolveTicketAction("z", [t("a")], null)).toEqual({ kind: "fetch" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ticket-link.test.ts`
Expected: FAIL — `Cannot find module './ticket-link'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/ticket-link.ts
import type { Task } from "./types";

// Canonical shareable link for a ticket: task-only, project resolved on open.
export function shareLink(origin: string, id: string): string {
  return `${origin}/?task=${id}`;
}

export type TicketAction =
  | { kind: "open-local"; task: Task }
  | { kind: "fetch" }
  | { kind: "close" }
  | { kind: "noop" };

// Decide what the board should do given the URL's `task` param, the currently
// loaded tasks, and which ticket is already open. Pure — all inputs injected.
export function resolveTicketAction(
  taskParam: string | null,
  tasks: Task[],
  editingId: string | null
): TicketAction {
  if (!taskParam) return editingId ? { kind: "close" } : { kind: "noop" };
  if (taskParam === editingId) return { kind: "noop" };
  const found = tasks.find((t) => t.id === taskParam);
  return found ? { kind: "open-local", task: found } : { kind: "fetch" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ticket-link.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ticket-link.ts lib/ticket-link.test.ts
git commit -m "feat(ui): pure ticket-link helpers (shareLink + resolveTicketAction)"
```

---

## Task 2: `getTask` client method + `useTaskRoute` hook

**Files:**
- Modify: `lib/client.ts` (add one method to the `api` object, tasks section ~line 108)
- Modify: `components/useApp.ts` (add an exported hook)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `api.getTask(id: string): Promise<Task>`
  - `useTaskRoute(): { taskParam: string | null; openTask: (id: string) => void; closeTask: () => void }`

- [ ] **Step 1: Add `getTask` to `lib/client.ts`**

Insert into the `api` object's tasks section, immediately after the `listTasks` method (so it sits with the other task calls):

```ts
  getTask: (id: string) => req<Task>("GET", `/api/tasks/${id}`),
```

(`Task` is already imported in `lib/client.ts`.)

- [ ] **Step 2: Add `useTaskRoute` to `components/useApp.ts`**

Append this exported hook (the file already imports `useCallback`, `useRouter`, `useSearchParams`):

```ts
// Reads the `task` query param and exposes setters that push/strip it.
// openTask pushes (so browser Back closes the drawer); closeTask replaces.
export function useTaskRoute() {
  const router = useRouter();
  const params = useSearchParams();
  const taskParam = params.get("task");

  const openTask = useCallback(
    (id: string) => {
      const sp = new URLSearchParams(Array.from(params.entries()));
      sp.set("task", id);
      router.push(`?${sp.toString()}`);
    },
    [params, router]
  );

  const closeTask = useCallback(() => {
    const sp = new URLSearchParams(Array.from(params.entries()));
    sp.delete("task");
    router.replace(`?${sp.toString()}`);
  }, [params, router]);

  return { taskParam, openTask, closeTask };
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add lib/client.ts components/useApp.ts
git commit -m "feat(ui): api.getTask + useTaskRoute (task query-param plumbing)"
```

---

## Task 3: URL-driven drawer in `Board.tsx`

**Files:**
- Modify: `components/Board.tsx`

**Interfaces:**
- Consumes: `resolveTicketAction` (Task 1), `api.getTask` + `useTaskRoute` (Task 2), existing `useProjects().select`, `toast`.

- [ ] **Step 1: Update imports**

In `components/Board.tsx`, add `useRef` to the React import and import the new helpers/hook. Change:

```tsx
import { useCallback, useEffect, useState } from "react";
```
to:
```tsx
import { useCallback, useEffect, useRef, useState } from "react";
```

Add to the existing `./useApp` import so it reads:
```tsx
import { useProjects, usePoll, useUsers, useTaskRoute } from "./useApp";
```

Add a new import:
```tsx
import { resolveTicketAction } from "@/lib/ticket-link";
```

- [ ] **Step 2: Wire the hook + resolution effect inside `Board()`**

After `const { projects, selectedId, select, reload, loaded } = useProjects();` add:

```tsx
  const { taskParam, openTask, closeTask } = useTaskRoute();
  const resolvingRef = useRef<string | null>(null);
```

After the existing `usePoll(...)` block, add the resolution effect:

```tsx
  // The `task` URL param is the source of truth for the open drawer.
  useEffect(() => {
    const action = resolveTicketAction(taskParam, tasks, editing?.id ?? null);
    if (action.kind === "noop") return;
    if (action.kind === "close") {
      setEditing(null);
      return;
    }
    if (action.kind === "open-local") {
      setEditing(action.task);
      return;
    }
    // action.kind === "fetch": deep link to a task not in the loaded list.
    if (!taskParam || resolvingRef.current === taskParam) return;
    resolvingRef.current = taskParam;
    api
      .getTask(taskParam)
      .then((t) => {
        if (t.project_id !== selectedId) select(t.project_id);
        setEditing(t);
      })
      .catch(() => {
        toast("Ticket not found", "error");
        closeTask();
      })
      .finally(() => {
        resolvingRef.current = null;
      });
  }, [taskParam, tasks, selectedId, editing, select, closeTask]);
```

- [ ] **Step 3: Route card-open and drawer-close through the URL**

Change the `Column`'s `onOpen` prop (currently `onOpen={setEditing}`) to open via the URL:

```tsx
                onOpen={(t) => openTask(t.id)}
```

Change the `EditDrawer` close handler (currently `onClose={() => setEditing(null)}`) to:

```tsx
          onClose={closeTask}
```

- [ ] **Step 4: Add the stale-`sm` render guard**

Change the drawer render condition from:
```tsx
      {editing && sm && (
        <EditDrawer
```
to (only render when the loaded state machine belongs to the open ticket's project):
```tsx
      {editing && sm && sm.statuses[0]?.project_id === editing.project_id && (
        <EditDrawer
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/Board.tsx
git commit -m "feat(ui): drive the edit drawer from the task URL param (deep link)"
```

---

## Task 4: "Copy link" button in `EditDrawer.tsx`

**Files:**
- Modify: `components/EditDrawer.tsx`

**Interfaces:**
- Consumes: `shareLink` (Task 1), existing `toast`.

- [ ] **Step 1: Import `shareLink`**

In `components/EditDrawer.tsx`, add:
```tsx
import { shareLink } from "@/lib/ticket-link";
```

- [ ] **Step 2: Replace the header block with a Copy-link + close pair**

Change the header (currently):
```tsx
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-white">Edit task</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200">
            ✕
          </button>
        </div>
```
to:
```tsx
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-white">Edit task</h2>
          <div className="flex items-center gap-3">
            <button
              onClick={async () => {
                const link = shareLink(window.location.origin, task.id);
                try {
                  await navigator.clipboard.writeText(link);
                  toast("Link copied", "success");
                } catch {
                  toast(link, "success"); // fallback: surface the link to copy manually
                }
              }}
              className="text-xs text-gray-400 hover:text-gray-200"
              title="Copy link to this ticket"
            >
              🔗 Copy link
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-200">
              ✕
            </button>
          </div>
        </div>
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Run the full unit suite**

Run: `npm test`
Expected: PASS (existing tests + Task 1's 6 new tests).

- [ ] **Step 5: Commit**

```bash
git add components/EditDrawer.tsx
git commit -m "feat(ui): copy-link button in the edit drawer"
```

---

## Task 5: Preview verification

**Files:** none (verification only)

A dev server is available (see `.claude/launch.json`; this branch's default is `next-dev` on port 3000 — if 3000/3001 are busy it auto-bumps, so note the actual port). Use a project with at least one task; the board ticket `PAt6mCAK3pqH` lives in project `lPFgh_dyrALH`.

- [ ] **Step 1:** Ensure the dev server is running and the board loads.
- [ ] **Step 2: Open reflects in URL** — click a ticket; confirm the address bar gains `task=<id>` and the drawer opens.
- [ ] **Step 3: Copy link** — click "🔗 Copy link"; confirm a "Link copied" toast and that the clipboard holds `${origin}/?task=<id>` (read it back via `navigator.clipboard.readText()` in the preview console, or paste).
- [ ] **Step 4: Deep link** — open `${origin}/?task=<id>` in a fresh tab/navigation; confirm the correct project board loads and the drawer opens on that ticket.
- [ ] **Step 5: Cross-project deep link** — use a task id from a non-selected project; confirm the board switches to that task's project and opens the drawer (no flash of the wrong project's status buttons).
- [ ] **Step 6: Bad id** — open `${origin}/?task=does-not-exist`; confirm a "Ticket not found" toast and that the `task` param is stripped from the URL.
- [ ] **Step 7: Back closes** — with a ticket open, press browser Back; confirm the drawer closes and the URL returns to the board.
- [ ] **Step 8: Screenshot** the drawer showing the Copy-link button as proof.

---

## Self-Review

- **Spec coverage:** `shareLink`/`resolveTicketAction` (T1) ✓; `getTask` (T2) ✓; `useTaskRoute` openTask-push/closeTask-replace (T2) ✓; URL-driven drawer + fetch + cross-project select + not-found toast + stale-sm guard (T3) ✓; Copy-link button + clipboard fallback (T4) ✓; all verification cases incl. Back-closes and cross-project (T5) ✓. No server changes (constraint) ✓.
- **Placeholder scan:** none — every code step carries full code.
- **Type consistency:** `TicketAction`/`resolveTicketAction`/`shareLink` (T1) consumed verbatim in T3/T4; `useTaskRoute` return shape (T2) consumed in T3; `api.getTask` signature (T2) consumed in T3; render guard uses `sm.statuses[0]?.project_id` and `editing.project_id`, both real `Task`/`Status` fields.
