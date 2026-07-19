"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { Task, StateMachine } from "@/lib/types";
import { priorityOrder } from "@/lib/priority";
import { api, ApiClientError } from "@/lib/client";
import { useProjects, usePoll, useUsers, useTaskRoute } from "./useApp";
import { resolveTicketAction, ticketRef } from "@/lib/ticket-link";
import { AppShell } from "./AppShell";
import { TaskCard } from "./TaskCard";
import { EditDrawer } from "./EditDrawer";
import { BoardSkeleton } from "./ui";
import { toast } from "./Toast";

// Screen-reader narration for drag-and-drop. @dnd-kit announces these via a
// visually-hidden live region so non-visual users can follow card moves.
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

function Column({
  statusKey,
  label,
  isFinal,
  tasks,
  onOpen,
  onAdd,
  onArchiveAll,
}: {
  statusKey: string;
  label: string;
  isFinal: boolean;
  tasks: Task[];
  onOpen: (t: Task) => void;
  onAdd: (statusKey: string, title: string) => void;
  onArchiveAll: (statusKey: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: statusKey });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");

  const submit = () => {
    if (title.trim()) onAdd(statusKey, title.trim());
    setTitle("");
    setAdding(false);
  };

  return (
    <section
      role="region"
      aria-label={`${label} column, ${tasks.length} task${tasks.length === 1 ? "" : "s"}`}
      className="flex h-full max-h-full w-72 max-w-[85vw] shrink-0 flex-col rounded-lg bg-bg-soft"
    >
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium text-fg">
          {label}
          {isFinal && (
            <span className="rounded bg-warning-bg px-1.5 py-0.5 text-[10px] font-medium text-warning">
              final
            </span>
          )}
          <span className="text-xs text-fg-subtle">{tasks.length}</span>
        </div>
        <div className="flex items-center gap-2">
          {isFinal && tasks.length > 0 && (
            <button
              onClick={() => onArchiveAll(statusKey)}
              className="rounded px-1 text-xs text-fg-subtle hover:text-fg"
              title={`Archive all ${tasks.length} ticket(s) in ${label}`}
            >
              Archive all ({tasks.length})
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
          isOver ? "rounded-lg bg-bg-card/60 ring-1 ring-accent" : ""
        }`}
      >
        {adding && (
          <textarea
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={submit}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
              if (e.key === "Escape") setAdding(false);
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
  const [sm, setSm] = useState<StateMachine | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [active, setActive] = useState<Task | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);
  const [dragging, setDragging] = useState(false);

  // Mouse: start dragging after a small 5px move (desktop, unchanged behavior).
  // Touch: require a deliberate long-press before a drag begins, so ordinary
  // vertical scrolling on mobile never gets hijacked into a card move. The
  // `tolerance` lets a finger drift slightly during the press without cancelling.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
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
  // or while the drawer is open to avoid clobbering local interaction.
  usePoll(
    () => {
      if (selectedId && !dragging && !editing) loadTasks(selectedId).catch(() => {});
    },
    [selectedId, dragging, editing]
  );

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
    api
      .getTask(taskParam)
      .then((t) => {
        setEditing(t);
        // Canonicalize the link and switch project in ONE url write. Doing the
        // project switch separately would race this replace, and whichever ran
        // last would drop the other's param — leaving the board on the wrong
        // project with the drawer's ticket nowhere in the list.
        const ref = ticketRef(t);
        const proj = t.project_id !== selectedId ? t.project_id : undefined;
        if (taskParam !== ref || proj) replaceTaskRef.current(ref, proj);
      })
      .catch(() => {
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
      await api.createTask(selectedId, title, undefined, statusKey);
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

  return (
    <>
      <AppShell
        projects={projects}
        selectedId={selectedId}
        select={select}
        reload={reload}
        contentClassName="flex min-h-0 flex-1 flex-col"
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
          <DndContext
            sensors={sensors}
            accessibility={{ announcements: dndAnnouncements }}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragCancel={() => {
              setDragging(false);
              setActive(null);
            }}
          >
            <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3 sm:p-4">
              {sm?.statuses.filter((s) => !s.hidden).map((s) => (
                <Column
                  key={s.key}
                  statusKey={s.key}
                  label={s.label}
                  isFinal={s.is_final}
                  tasks={byStatus(s.key)}
                  onOpen={(t) => openTask(ticketRef(t))}
                  onAdd={addTask}
                  onArchiveAll={archiveAll}
                />
              ))}
            </div>
            <DragOverlay>
              {active ? <TaskCard task={active} overlay /> : null}
            </DragOverlay>
          </DndContext>
        )}
      </AppShell>

      {editing && sm && sm.statuses[0]?.project_id === editing.project_id && (
        <EditDrawer
          task={editing}
          sm={sm}
          users={users}
          onClose={closeTask}
          onChanged={() => selectedId && loadTasks(selectedId)}
          onOpenTask={openTask}
        />
      )}
    </>
  );
}
