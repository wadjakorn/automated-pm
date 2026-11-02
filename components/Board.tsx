"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardCode,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import type { Task, StateMachine } from "@/lib/types";
import { priorityOrder } from "@/lib/priority";
import { api, ApiClientError } from "@/lib/client";
import { useAuth, useProjects, usePoll, useUsers, useTaskRoute } from "./useApp";
import { dropHint, neighbourColumnX, type DropHint } from "./board-logic";
import { resolveTicketAction, ticketRef } from "@/lib/ticket-link";
import { AppShell } from "./AppShell";
import { TaskCard } from "./TaskCard";
import { EditDrawer } from "./EditDrawer";
import { BoardSkeleton } from "./ui";
import { toast } from "./Toast";
import { BoardFilterBar } from "./BoardFilterBar";
import {
  EMPTY_FILTER,
  countLabel,
  isFilterActive,
  matchesFilter,
  readFilter,
  writeFilter,
  type BoardFilter,
} from "./filter-logic";
import { boardPollMs, parseStreamEvent } from "./live-logic";

const LIVE_DEBOUNCE_MS = 300;
// After the browser gives up on the stream (non-retryable error), try a fresh
// connection this much later; the fast poll covers the gap.
const LIVE_RECONNECT_MS = 15000;

// Typing context where a bare "/" is text, not the filter shortcut.
function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return (
    el.isContentEditable ||
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT"
  );
}

// Screen-reader narration for drag-and-drop. @dnd-kit announces these via a
// visually-hidden live region so non-visual users can follow card moves.
// Read out when a card gets focus; matches the KeyboardSensor bindings below.
const dndInstructions = {
  draggable:
    "Press Enter to open the task. Press Space to pick it up, Left and Right arrows to move between columns, Space to drop, or Escape to cancel.",
};

const dndAnnouncements = {
  onDragStart({ active }: { active: { data: { current?: any } } }) {
    return `Picked up task ${active.data.current?.task?.title ?? ""}.`;
  },
  onDragOver({ over }: { over: { id: string | number } | null }) {
    return over ? `Over ${over.id} column.` : "Not over a column.";
  },
  onDragEnd({ over }: { over: { id: string | number } | null }) {
    return over ? `Dropped in ${over.id} column.` : "Drop cancelled.";
  },
  onDragCancel() {
    return "Move cancelled.";
  },
};

// Keyboard drag: Left/Right jump the picked-up card one whole column instead
// of dnd-kit's default 25px nudge (columns are ~288px wide). Up/Down are inert
// — order within a column is by priority/rank, not position.
const columnKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { context, currentCoordinates }
) => {
  const dir =
    event.code === KeyboardCode.Right ? 1 : event.code === KeyboardCode.Left ? -1 : 0;
  const rect = context.collisionRect;
  if (!dir || !rect) return undefined;
  event.preventDefault();
  const x = neighbourColumnX(
    Array.from(context.droppableRects.values()),
    rect.left + rect.width / 2,
    rect.width,
    dir
  );
  return x === null ? undefined : { ...currentCoordinates, x };
};

function Column({
  statusKey,
  label,
  isFinal,
  tasks,
  onOpen,
  onAdd,
  onArchiveAll,
  hint,
  total,
  filtered,
}: {
  statusKey: string;
  label: string;
  isFinal: boolean;
  // Cards shown (after the filter bar), and the column's unfiltered size.
  tasks: Task[];
  total: number;
  filtered: boolean;
  onOpen: (t: Task) => void;
  onAdd: (statusKey: string, title: string) => void;
  onArchiveAll: (statusKey: string) => void;
  // Drag-in-progress hint for this column; null when nothing is being dragged.
  hint: DropHint | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: statusKey });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");

  // Quick add: Enter files the task and keeps the composer open, cleared and
  // focused, for rapid entry. Esc, or blurring an empty composer, closes it;
  // blurring with text still files that last task.
  const submit = () => {
    if (title.trim()) onAdd(statusKey, title.trim());
    setTitle("");
  };

  const illegal = hint === "illegal";

  return (
    <section
      role="region"
      aria-label={
        filtered
          ? `${label} column, ${tasks.length} of ${total} task${total === 1 ? "" : "s"} shown`
          : `${label} column, ${total} task${total === 1 ? "" : "s"}`
      }
      className={`flex h-full max-h-full w-72 max-w-[85vw] shrink-0 flex-col rounded-lg bg-bg-soft transition-opacity ${
        illegal ? "opacity-40" : ""
      }`}
    >
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium text-fg">
          {label}
          {isFinal && (
            <span className="rounded bg-warning-bg px-1.5 py-0.5 text-[10px] font-medium text-warning">
              final
            </span>
          )}
          <span
            className={`text-xs ${filtered ? "text-accent" : "text-fg-subtle"}`}
            title={filtered ? `${tasks.length} of ${total} shown by the filter` : undefined}
          >
            {countLabel(tasks.length, total, filtered)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Bulk archive acts on the whole column, filtered or not. */}
          {isFinal && total > 0 && (
            <button
              onClick={() => onArchiveAll(statusKey)}
              className="rounded px-1 text-xs text-fg-subtle hover:text-fg"
              title={`Archive all ${total} ticket(s) in ${label}`}
            >
              Archive all ({total})
            </button>
          )}
          <button
            onClick={() => setAdding(true)}
            className="grid h-6 w-6 place-items-center rounded text-lg leading-none text-fg-subtle hover:bg-bg-card hover:text-fg"
            title={`Add task to ${label}`}
            aria-label={`Add task to ${label}`}
          >
            +
          </button>
        </div>
      </div>
      <div
        ref={setNodeRef}
        role="list"
        className={`flex min-h-[60px] flex-1 flex-col gap-2 overflow-y-auto p-2 transition-colors ${
          isOver && !illegal ? "rounded-lg bg-bg-card/60 ring-1 ring-accent" : ""
        }`}
      >
        {adding && (
          <textarea
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              submit();
              setAdding(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
              if (e.key === "Escape") {
                setTitle("");
                setAdding(false);
              }
            }}
            placeholder="Task title…"
            rows={2}
            aria-label={`New task title in ${label}`}
            className="resize-none rounded-md border border-border bg-bg-card p-2 text-sm outline-none focus:border-accent"
          />
        )}
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

export function Board() {
  const { projects, selectedId, select, reload, loaded } = useProjects();
  const { taskParam, openTask, replaceTask, closeTask } = useTaskRoute();
  const resolvingRef = useRef<string | null>(null);
  const closeTaskRef = useRef(closeTask);
  closeTaskRef.current = closeTask;
  const replaceTaskRef = useRef(replaceTask);
  replaceTaskRef.current = replaceTask;
  const { users } = useUsers();
  const { user } = useAuth();
  const [sm, setSm] = useState<StateMachine | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [active, setActive] = useState<Task | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);
  const [dragging, setDragging] = useState(false);
  // Live stream (/api/stream) connected → "live" dot + slow backstop poll.
  const [live, setLive] = useState(false);
  // Bumped when the stream reports a change to the open drawer's ticket.
  const [drawerTick, setDrawerTick] = useState(0);
  const draggingRef = useRef(dragging);
  draggingRef.current = dragging;
  const editingRef = useRef(editing);
  editingRef.current = editing;

  // Filter bar state lives in the URL (?q=&assignee=&priority=) — shareable.
  const router = useRouter();
  const params = useSearchParams();
  const filter = readFilter(params);
  const filterActive = isFilterActive(filter);
  const filterInputRef = useRef<HTMLInputElement>(null);
  // Merge into whatever the URL holds right now (not a render snapshot), so a
  // debounced text write can't undo a select change made in between.
  const setFilter = useCallback(
    (patch: Partial<BoardFilter>) => {
      const cur = new URLSearchParams(window.location.search);
      const sp = writeFilter(cur, { ...readFilter(cur), ...patch });
      const qs = sp.toString();
      router.replace(qs ? `?${qs}` : window.location.pathname, { scroll: false });
    },
    [router]
  );
  const clearFilter = useCallback(() => setFilter(EMPTY_FILTER), [setFilter]);

  // Mouse: start dragging after a small 5px move (desktop, unchanged behavior).
  // Touch: require a deliberate long-press before a drag begins, so ordinary
  // vertical scrolling on mobile never gets hijacked into a card move. The
  // `tolerance` lets a finger drift slightly during the press without cancelling.
  // Keyboard: Space picks up / drops, arrows move between columns, Esc cancels.
  // Enter is deliberately NOT a drag key — TaskCard keeps Enter for "open".
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      keyboardCodes: {
        start: [KeyboardCode.Space],
        cancel: [KeyboardCode.Esc],
        end: [KeyboardCode.Space],
      },
      coordinateGetter: columnKeyboardCoordinates,
    })
  );

  const loadSm = useCallback(async (pid: string) => {
    setSm(await api.getStateMachine(pid));
  }, []);

  const loadTasks = useCallback(async (pid: string) => {
    setTasks(await api.listTasks(pid));
  }, []);

  // Reload state machine when project changes.
  useEffect(() => {
    if (selectedId) loadSm(selectedId).catch(() => {});
  }, [selectedId, loadSm]);

  // Poll tasks for freshness (catches CLI/agent edits). Pause while dragging
  // or while the drawer is open to avoid clobbering local interaction. While
  // the live stream is connected this is only a slow backstop.
  usePoll(
    () => {
      if (selectedId && !dragging && !editing) loadTasks(selectedId).catch(() => {});
    },
    [selectedId, dragging, editing, live],
    boardPollMs(live)
  );

  // Live board: every change in this project (web, CLI, MCP alike) arrives as
  // an `activity` event. Bursts are coalesced into one reload; a drag in
  // progress defers it so the card under the pointer isn't yanked away. If the
  // open drawer's ticket changed, its timeline/links refetch and it adopts the
  // fresh copy (the drawer keeps any field the user is editing).
  useEffect(() => {
    if (!selectedId || typeof EventSource === "undefined") return;
    const pid = selectedId;
    let es: EventSource | null = null;
    let disposed = false;
    let wasDown = false;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let changed = new Set<string>();

    const flush = () => {
      debounce = undefined;
      if (disposed) return;
      if (draggingRef.current) {
        debounce = setTimeout(flush, LIVE_DEBOUNCE_MS);
        return;
      }
      const ids = changed;
      changed = new Set();
      loadTasks(pid).catch(() => {});
      const open = editingRef.current;
      if (open && ids.has(open.id)) {
        setDrawerTick((n) => n + 1);
        api
          .getTask(open.id)
          .then((fresh) =>
            setEditing((cur) =>
              cur && cur.id === fresh.id && fresh.version > cur.version ? fresh : cur
            )
          )
          .catch(() => {});
      }
    };

    const connect = () => {
      if (disposed) return;
      es = new EventSource(`/api/stream?project=${encodeURIComponent(pid)}`);
      es.onopen = () => {
        setLive(true);
        // Our own reconnect starts from "now": catch up on anything missed.
        if (wasDown) loadTasks(pid).catch(() => {});
        wasDown = false;
      };
      es.onerror = () => {
        setLive(false);
        wasDown = true;
        // CONNECTING = the browser retries by itself (resuming via
        // Last-Event-ID); CLOSED = it gave up, so start over later.
        if (es && es.readyState === EventSource.CLOSED) {
          es.close();
          es = null;
          retry = setTimeout(connect, LIVE_RECONNECT_MS);
        }
      };
      es.addEventListener("activity", (e) => {
        const ev = parseStreamEvent((e as MessageEvent).data);
        if (!ev) return;
        changed.add(ev.task_id);
        clearTimeout(debounce);
        debounce = setTimeout(flush, LIVE_DEBOUNCE_MS);
      });
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(debounce);
      clearTimeout(retry);
      es?.close();
      setLive(false);
    };
  }, [selectedId, loadTasks]);

  // "/" focuses the filter box, unless the user is typing somewhere or a
  // dialog (drawer, palette) is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target) || editingRef.current) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const input = filterInputRef.current;
      if (!input) return;
      e.preventDefault();
      input.focus();
      input.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The `task` URL param is the source of truth for the open drawer.
  useEffect(() => {
    if (resolvingRef.current !== null) return; // a deep-link fetch is in flight; don't re-enter
    const action = resolveTicketAction(taskParam, tasks, editing ?? null);
    if (action.kind === "noop") return;
    if (action.kind === "close") {
      setEditing(null);
      return;
    }
    if (action.kind === "open-local") {
      setEditing(action.task);
      // Canonicalize a legacy `?task=<nanoid>` link to the human key once the
      // ticket resolves. replace(), not push(), so Back still leaves the board
      // rather than bouncing between the two spellings of the same URL.
      const ref = ticketRef(action.task);
      if (taskParam !== ref) replaceTask(ref);
      return;
    }
    // action.kind === "fetch": deep link to a task not in the loaded list.
    if (!taskParam || resolvingRef.current === taskParam) return;
    resolvingRef.current = taskParam;
    const requested = taskParam;
    // The URL still has to be asking for THIS ticket when the request lands.
    // The effect is blocked from re-running while a fetch is in flight, so a
    // Back or a click elsewhere meanwhile would otherwise be undone: the late
    // result would reopen the old drawer and rewrite ?task= back to it.
    const stillWanted = () =>
      new URLSearchParams(window.location.search).get("task") === requested;
    api
      .getTask(requested)
      .then((t) => {
        if (!stillWanted()) return;
        setEditing(t);
        // Canonicalize the link and switch project in ONE url write. Doing the
        // project switch separately would race this replace, and whichever ran
        // last would drop the other's param — leaving the board on the wrong
        // project with the drawer's ticket nowhere in the list.
        const ref = ticketRef(t);
        const proj = t.project_id !== selectedId ? t.project_id : undefined;
        if (requested !== ref || proj) replaceTaskRef.current(ref, proj);
      })
      .catch(() => {
        if (!stillWanted()) return;
        toast("Ticket not found", "error");
        closeTaskRef.current();
      })
      .finally(() => {
        resolvingRef.current = null;
      });
  }, [taskParam, tasks, selectedId, editing, replaceTask]);

  function onDragStart(e: DragStartEvent) {
    setDragging(true);
    setActive((e.active.data.current as any)?.task ?? null);
  }

  async function onDragEnd(e: DragEndEvent) {
    setDragging(false);
    const task = (e.active.data.current as any)?.task as Task | undefined;
    const overKey = e.over?.id as string | undefined;
    setActive(null);
    if (!task || !overKey || task.status_key === overKey) return;

    // Optimistic move; revert on failure.
    const prev = tasks;
    setTasks((ts) =>
      ts.map((t) => (t.id === task.id ? { ...t, status_key: overKey } : t))
    );
    try {
      await api.moveTask(task.id, overKey, task.version);
      if (selectedId) loadTasks(selectedId);
    } catch (err) {
      setTasks(prev);
      const e2 = err as ApiClientError;
      toast(e2.message ?? "Move rejected", "error");
      if (selectedId) loadTasks(selectedId);
    }
  }

  async function addTask(statusKey: string, title: string) {
    if (!selectedId) return;
    try {
      // Quick-adds default to the logged-in user (anonymous → server default).
      await api.createTask(selectedId, title, undefined, statusKey, user?.id);
      loadTasks(selectedId);
    } catch (e: any) {
      toast(e.message ?? "Failed to add task", "error");
    }
  }

  async function archiveAll(statusKey: string) {
    if (!selectedId) return;
    const count = tasks.filter((t) => t.status_key === statusKey).length;
    const label = sm?.statuses.find((s) => s.key === statusKey)?.label ?? statusKey;
    if (
      !window.confirm(
        `Archive all ${count} ticket(s) in “${label}”? They leave the board but stay searchable and openable by link. Find them under Archive.`
      )
    )
      return;
    try {
      const { archived } = await api.bulkArchive(selectedId, statusKey);
      toast(`Archived ${archived.length} ticket(s)`, "success");
      loadTasks(selectedId);
    } catch (e: any) {
      toast(e.message ?? "Failed to archive", "error");
    }
  }

  // Within a column: priority first (now→low), then rank — mirrors the server.
  const byStatus = (key: string) =>
    tasks
      .filter((t) => t.status_key === key)
      .sort(
        (a, b) =>
          priorityOrder(a.priority) - priorityOrder(b.priority) || a.rank - b.rank
      );
  const meId = user?.id ?? null;
  const shownOf = (list: Task[]) =>
    filterActive ? list.filter((t) => matchesFilter(t, filter, meId)) : list;
  // Totals cover visible columns only, so "x of y" matches what's on screen.
  const visibleStatuses = sm?.statuses.filter((s) => !s.hidden) ?? [];
  const onBoard = tasks.filter((t) => visibleStatuses.some((s) => s.key === t.status_key));
  const shownTotal = shownOf(onBoard).length;

  return (
    <>
      <AppShell
        projects={projects}
        selectedId={selectedId}
        select={select}
        reload={reload}
        contentClassName="flex min-h-0 flex-1 flex-col"
        live={live}
      >
        {!selectedId ? (
          loaded ? (
            <div className="flex flex-1 items-center justify-center text-fg-subtle">
              Create a project to begin.
            </div>
          ) : (
            <BoardSkeleton />
          )
        ) : !sm ? (
          <BoardSkeleton />
        ) : (
          <>
            <BoardFilterBar
              filter={filter}
              onChange={setFilter}
              onClear={clearFilter}
              users={users}
              me={user}
              shown={shownTotal}
              total={onBoard.length}
              inputRef={filterInputRef}
            />
            <DndContext
              sensors={sensors}
              accessibility={{
                announcements: dndAnnouncements,
                screenReaderInstructions: dndInstructions,
              }}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragCancel={() => {
                setDragging(false);
                setActive(null);
              }}
            >
              <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3 sm:p-4">
                {visibleStatuses.map((s) => {
                  const all = byStatus(s.key);
                  return (
                    <Column
                      key={s.key}
                      statusKey={s.key}
                      label={s.label}
                      isFinal={s.is_final}
                      tasks={shownOf(all)}
                      total={all.length}
                      filtered={filterActive}
                      onOpen={(t) => openTask(ticketRef(t))}
                      onAdd={addTask}
                      onArchiveAll={archiveAll}
                      hint={active ? dropHint(sm, active.status_key, s.key) : null}
                    />
                  );
                })}
              </div>
              <DragOverlay>
                {active ? <TaskCard task={active} overlay /> : null}
              </DragOverlay>
            </DndContext>
          </>
        )}
      </AppShell>

      {editing && sm && sm.statuses[0]?.project_id === editing.project_id && (
        <EditDrawer
          task={editing}
          sm={sm}
          users={users}
          tasks={tasks}
          onClose={closeTask}
          onChanged={() => selectedId && loadTasks(selectedId)}
          // Only refresh the drawer if it still shows this ticket (an Undo can
          // land after it closed or switched — don't reopen/clobber it).
          onTaskUpdated={(t) => setEditing((cur) => (cur && cur.id === t.id ? t : cur))}
          onOpenTask={openTask}
          refreshKey={drawerTick}
        />
      )}
    </>
  );
}
