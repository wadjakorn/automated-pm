"use client";

import { useCallback, useEffect, useState } from "react";
import type { Task, StateMachine, PublicUser, LinkedTicket } from "@/lib/types";
import { PRIORITIES } from "@/lib/priority";
import { api, ApiClientError } from "@/lib/client";
import { allowedTargets } from "@/lib/statemachine";
import { shareLink, LINK_OPTIONS, type LinkOption } from "@/lib/ticket-link";
import { toast } from "./Toast";

// Slide-over drawer to edit a task: title, description, assignee, status move,
// delete.
export function EditDrawer({
  task,
  sm,
  users,
  onClose,
  onChanged,
  onOpenTask,
}: {
  task: Task;
  sm: StateMachine;
  users: PublicUser[];
  onClose: () => void;
  onChanged: () => void;
  // Navigate to another ticket (used by linked-ticket rows). Falls back to a
  // no-op so the drawer still works if a caller doesn't wire it.
  onOpenTask?: (id: string) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [assignee, setAssignee] = useState(task.assignee_id ?? "");
  const [priority, setPriority] = useState(task.priority);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? "");
    setAssignee(task.assignee_id ?? "");
    setPriority(task.priority);
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
          priority,
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
        className="flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto border-l border-border bg-bg-soft p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-fg">Edit task</h2>
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
              className="text-xs text-fg-muted hover:text-fg"
              title="Copy link to this ticket"
            >
              🔗 Copy link
            </button>
            <button onClick={onClose} className="text-fg-muted hover:text-fg">
              ✕
            </button>
          </div>
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

        <label className="text-xs text-fg-muted">Priority</label>
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as typeof priority)}
          className="rounded border border-border bg-bg-card px-3 py-2 text-sm text-fg outline-none"
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
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

        <LinksSection task={task} onOpenTask={onOpenTask} />

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

// Linked tickets: lists existing links grouped by label and lets the user add
// one by pasting a ticket URL/id and picking a relation. Links live in their
// own table, so this manages its own state independent of the task's version.
function LinksSection({
  task,
  onOpenTask,
}: {
  task: Task;
  onOpenTask?: (id: string) => void;
}) {
  const [links, setLinks] = useState<LinkedTicket[]>([]);
  const [ref, setRef] = useState("");
  const [option, setOption] = useState<LinkOption>("relates");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    api
      .listLinks(task.id)
      .then(setLinks)
      .catch(() => setLinks([]));
  }, [task.id]);

  useEffect(() => {
    reload();
  }, [reload]);

  const add = async () => {
    if (!ref.trim()) return;
    setBusy(true);
    try {
      await api.addLink(task.id, ref.trim(), option);
      setRef("");
      reload();
    } catch (e) {
      toast((e as ApiClientError).message ?? "Could not add link", "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (linkId: string) => {
    setBusy(true);
    try {
      await api.removeLink(task.id, linkId);
      reload();
    } catch (e) {
      toast((e as ApiClientError).message ?? "Could not remove link", "error");
    } finally {
      setBusy(false);
    }
  };

  const open = (id: string) => {
    onOpenTask?.(id);
  };

  // Group by displayed label so e.g. all "Blocked by" rows sit together.
  const groups = links.reduce<Record<string, LinkedTicket[]>>((acc, l) => {
    (acc[l.label] ??= []).push(l);
    return acc;
  }, {});

  return (
    <div>
      <label className="text-xs text-fg-muted">Linked tickets</label>

      {links.length === 0 ? (
        <div className="mt-1 text-xs text-fg-subtle">No links yet.</div>
      ) : (
        <div className="mt-1 flex flex-col gap-2">
          {Object.entries(groups).map(([label, items]) => (
            <div key={label}>
              <div className="text-[10px] uppercase tracking-wide text-fg-subtle">
                {label}
              </div>
              {items.map((l) => (
                <div
                  key={l.link_id}
                  className="flex items-center justify-between gap-2 rounded border border-border bg-bg-card px-2 py-1 text-sm"
                >
                  <button
                    onClick={() => open(l.task.id)}
                    className="flex-1 truncate text-left text-fg hover:text-accent"
                    title={l.task.title}
                  >
                    <span
                      className={l.task.deleted_at ? "line-through opacity-60" : ""}
                    >
                      {l.task.title || l.task.id}
                    </span>{" "}
                    <span className="text-[10px] text-fg-subtle">
                      {l.task.status_key}
                      {l.task.project_id !== task.project_id && " · other project"}
                      {l.task.deleted_at && " · deleted"}
                    </span>
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => remove(l.link_id)}
                    className="text-fg-subtle hover:text-red-400"
                    title="Remove link"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 flex gap-2">
        <select
          value={option}
          onChange={(e) => setOption(e.target.value as LinkOption)}
          className="rounded border border-border bg-bg-card px-2 py-1 text-xs text-fg outline-none"
        >
          {LINK_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Paste ticket URL or id…"
          className="flex-1 rounded border border-border bg-bg-card px-2 py-1 text-xs outline-none"
        />
        <button
          disabled={busy || !ref.trim()}
          onClick={add}
          className="rounded border border-border px-2 py-1 text-xs text-fg hover:bg-bg-card disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}
