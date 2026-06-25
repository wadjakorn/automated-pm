"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { Task, StateMachine } from "@/lib/types";
import { api, ApiClientError } from "@/lib/client";
import { useProjects, usePoll, useUsers, useTaskRoute } from "./useApp";
import { resolveTicketAction } from "@/lib/ticket-link";
import { Nav } from "./Nav";
import { TaskCard } from "./TaskCard";
import { EditDrawer } from "./EditDrawer";
import { toast } from "./Toast";

function Column({
  statusKey,
  label,
  isFinal,
  tasks,
  onOpen,
  onAdd,
}: {
  statusKey: string;
  label: string;
  isFinal: boolean;
  tasks: Task[];
  onOpen: (t: Task) => void;
  onAdd: (statusKey: string, title: string) => void;
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
    <div className="flex w-72 shrink-0 flex-col rounded-lg bg-bg-soft">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-200">
          {label}
          {isFinal && (
            <span className="rounded bg-bg-card px-1.5 py-0.5 text-[10px] text-amber-400">
              final
            </span>
          )}
          <span className="text-xs text-gray-500">{tasks.length}</span>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="text-gray-500 hover:text-gray-200"
          title="Add task"
        >
          +
        </button>
      </div>
      <div
        ref={setNodeRef}
        className={`flex min-h-[60px] flex-1 flex-col gap-2 p-2 ${
          isOver ? "rounded-lg bg-bg-card/60 ring-1 ring-blue-600" : ""
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
            className="resize-none rounded-md border border-border bg-bg-card p-2 text-sm outline-none"
          />
        )}
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

export function Board() {
  const { projects, selectedId, select, reload, loaded } = useProjects();
  const { taskParam, openTask, closeTask } = useTaskRoute();
  const resolvingRef = useRef<string | null>(null);
  const selectRef = useRef(select);
  selectRef.current = select;
  const closeTaskRef = useRef(closeTask);
  closeTaskRef.current = closeTask;
  const { users } = useUsers();
  const [sm, setSm] = useState<StateMachine | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [active, setActive] = useState<Task | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);
  const [dragging, setDragging] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
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
        if (t.project_id !== selectedId) selectRef.current(t.project_id);
        setEditing(t);
      })
      .catch(() => {
        toast("Ticket not found", "error");
        closeTaskRef.current();
      })
      .finally(() => {
        resolvingRef.current = null;
      });
  }, [taskParam, tasks, selectedId, editing]);

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

  const byStatus = (key: string) =>
    tasks
      .filter((t) => t.status_key === key)
      .sort((a, b) => a.rank - b.rank);

  return (
    <div className="flex h-screen flex-col">
      <Nav
        projects={projects}
        selectedId={selectedId}
        onSelect={select}
        onProjectsChanged={reload}
      />

      {!selectedId ? (
        <div className="flex flex-1 items-center justify-center text-gray-500">
          {loaded ? "Create a project to begin." : "Loading…"}
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => {
            setDragging(false);
            setActive(null);
          }}
        >
          <div className="flex flex-1 gap-3 overflow-x-auto p-4">
            {sm?.statuses.map((s) => (
              <Column
                key={s.key}
                statusKey={s.key}
                label={s.label}
                isFinal={s.is_final}
                tasks={byStatus(s.key)}
                onOpen={(t) => openTask(t.id)}
                onAdd={addTask}
              />
            ))}
          </div>
          <DragOverlay>
            {active ? <TaskCard task={active} overlay /> : null}
          </DragOverlay>
        </DndContext>
      )}

      {editing && sm && sm.statuses[0]?.project_id === editing.project_id && (
        <EditDrawer
          task={editing}
          sm={sm}
          users={users}
          onClose={closeTask}
          onChanged={() => selectedId && loadTasks(selectedId)}
        />
      )}
    </div>
  );
}
