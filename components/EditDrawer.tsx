"use client";

import { useEffect, useState } from "react";
import type { Task, StateMachine, PublicUser } from "@/lib/types";
import { api, ApiClientError } from "@/lib/client";
import { allowedTargets } from "@/lib/statemachine";
import { toast } from "./Toast";

// Slide-over drawer to edit a task: title, description, assignee, status move,
// delete.
export function EditDrawer({
  task,
  sm,
  users,
  onClose,
  onChanged,
}: {
  task: Task;
  sm: StateMachine;
  users: PublicUser[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [assignee, setAssignee] = useState(task.assignee_id ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? "");
    setAssignee(task.assignee_id ?? "");
  }, [task]);

  const targets = allowedTargets(sm, task.status_key);
  const statusLabel = (k: string) =>
    sm.statuses.find((s) => s.key === k)?.label ?? k;

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      const err = e as ApiClientError;
      toast(err.message ?? "Action failed", "error");
      if (err.code === "conflict") onChanged();
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    withBusy(async () => {
      await api.updateTask(
        task.id,
        {
          title: title.trim(),
          description: description || null,
          assignee: assignee || null,
        },
        task.version
      );
      toast("Saved", "success");
      onChanged();
      onClose();
    });

  const move = (to: string) =>
    withBusy(async () => {
      await api.moveTask(task.id, to, task.version);
      toast(`Moved to ${statusLabel(to)}`, "success");
      onChanged();
      onClose();
    });

  const del = () =>
    withBusy(async () => {
      await api.deleteTask(task.id);
      toast("Moved to trash", "success");
      onChanged();
      onClose();
    });

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col gap-4 border-l border-border bg-bg-soft p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-fg">Edit task</h2>
          <button onClick={onClose} className="text-fg-muted hover:text-fg">
            ✕
          </button>
        </div>

        <label className="text-xs text-fg-muted">Title</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="rounded border border-border bg-bg-card px-3 py-2 text-sm outline-none"
        />

        <label className="text-xs text-fg-muted">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={6}
          className="resize-none rounded border border-border bg-bg-card px-3 py-2 text-sm outline-none"
        />

        <label className="text-xs text-fg-muted">Assignee</label>
        <select
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          className="rounded border border-border bg-bg-card px-3 py-2 text-sm text-fg outline-none"
        >
          <option value="">Unassigned</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.username}
            </option>
          ))}
        </select>

        <div>
          <div className="mb-1 text-xs text-fg-muted">
            Status: <span className="text-fg">{statusLabel(task.status_key)}</span>
          </div>
          {targets.length === 0 ? (
            <div className="text-xs text-fg-subtle">
              No moves available (final state).
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {targets.map((to) => (
                <button
                  key={to}
                  disabled={busy}
                  onClick={() => move(to)}
                  className="rounded border border-border px-2.5 py-1 text-xs text-fg hover:bg-bg-card"
                >
                  → {statusLabel(to)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-auto flex items-center justify-between">
          <button
            disabled={busy}
            onClick={del}
            className="rounded border border-red-800 px-3 py-2 text-sm text-red-300 hover:bg-red-950"
          >
            Delete
          </button>
          <button
            disabled={busy}
            onClick={save}
            className="rounded bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover"
          >
            Save
          </button>
        </div>
        <div className="text-[10px] text-fg-subtle">
          id {task.id} · v{task.version}
          {task.creator_username && <> · created by {task.creator_username}</>}
        </div>
      </div>
    </div>
  );
}
