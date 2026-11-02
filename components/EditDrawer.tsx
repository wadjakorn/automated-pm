"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Task, StateMachine, PublicUser, LinkedTicket } from "@/lib/types";
import { PRIORITIES } from "@/lib/priority";
import { api, ApiClientError } from "@/lib/client";
import { allowedTargets } from "@/lib/statemachine";
import { shareLink, LINK_OPTIONS, type LinkOption } from "@/lib/ticket-link";
import { copyText } from "@/lib/clipboard";
import { canUndoMove } from "./board-logic";
import { compressImage, exceedsHardMax } from "@/lib/image-compress";
import { PriorityIcon } from "./PriorityIcon";
import { Markdown } from "./Markdown";
import { ActivitySection } from "./ActivitySection";
import { Spinner } from "./ui";
import { toast } from "./Toast";

// Slide-over drawer to edit a task: title, description, assignee, status move,
// delete. The top bar (outside the scroll area) carries the ticket key, status
// badge, legal moves, assignee and priority so they're reachable without
// scrolling past a long description. Moving keeps the drawer open.
export function EditDrawer({
  task,
  sm,
  users,
  onClose,
  onChanged,
  onTaskUpdated,
  onOpenTask,
  tasks,
  refreshKey,
}: {
  // Bumped by the board when the live stream reports a change to this ticket
  // (from anyone: web, CLI, MCP) so the timeline and links refetch at once.
  refreshKey?: number;
  task: Task;
  sm: StateMachine;
  users: PublicUser[];
  // Loaded tickets of the current project, used to show link events in the
  // timeline by ticket key instead of the raw id. Optional.
  tasks?: Task[];
  onClose: () => void;
  onChanged: () => void;
  // Hand the server's fresh copy of the ticket back to the owner (new status
  // and version after a move), so the drawer re-renders it without a 409 on
  // the next move/save.
  onTaskUpdated?: (t: Task) => void;
  // Navigate to another ticket (used by linked-ticket rows). Falls back to a
  // no-op so the drawer still works if a caller doesn't wire it.
  onOpenTask?: (id: string) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [assignee, setAssignee] = useState(task.assignee_id ?? "");
  const [priority, setPriority] = useState(task.priority);
  const [descTab, setDescTab] = useState<"edit" | "preview">("preview");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Synchronous re-entry guard. `uploading` state is async, so two rapid
  // paste/pick events could both pass a state check before the first re-render;
  // the ref flips immediately and serializes uploads.
  const uploadingRef = useRef(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Accessible discard prompt replaces window.confirm() so it's keyboard- and
  // screen-reader-friendly and themed.
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // An unsent comment draft in the Activity composer also counts as unsaved.
  const [commentDirty, setCommentDirty] = useState(false);

  // A different ticket resets every field. The same ticket at a new version
  // (e.g. after a status move) only adopts the fresh saved value for fields
  // the user hasn't touched, so unsaved edits survive a move.
  const savedRef = useRef(task);
  useEffect(() => {
    const prev = savedRef.current;
    savedRef.current = task;
    if (prev.id !== task.id) {
      setTitle(task.title);
      setDescription(task.description ?? "");
      setAssignee(task.assignee_id ?? "");
      setPriority(task.priority);
      return;
    }
    // A field the user is editing that also changed on the server (another
    // tab, an agent — the live board hands the drawer fresh copies) keeps the
    // user's text, but say so: saving now would overwrite that change.
    const clash = (local: string, before: string, after: string) =>
      before !== after && local !== before && local !== after;
    const clashes = [
      clash(title, prev.title, task.title) && "title",
      clash(description, prev.description ?? "", task.description ?? "") && "description",
      clash(assignee, prev.assignee_id ?? "", task.assignee_id ?? "") && "assignee",
      clash(priority, prev.priority, task.priority) && "priority",
    ].filter(Boolean);
    if (clashes.length) {
      toast(
        `Someone else changed the ${clashes.join(", ")} of this ticket. Saving will overwrite it.`,
        "info"
      );
    }
    setTitle((v) => (v === prev.title ? task.title : v));
    setDescription((v) => (v === (prev.description ?? "") ? (task.description ?? "") : v));
    setAssignee((v) => (v === (prev.assignee_id ?? "") ? (task.assignee_id ?? "") : v));
    setPriority((v) => (v === prev.priority ? task.priority : v));
    // Reads the current field values only to compare; re-running on every
    // keystroke would be wrong.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task]);

  // Unsaved edits: any editable field differs from the task's saved value.
  // Used to guard accidental closes (backdrop misclick / ✕) so work isn't lost.
  const dirty =
    title !== task.title ||
    description !== (task.description ?? "") ||
    assignee !== (task.assignee_id ?? "") ||
    priority !== task.priority;
  const fieldsDirty = dirty;
  const anyDirty = fieldsDirty || commentDirty;

  // Confirm before discarding unsaved edits. A clean drawer closes instantly;
  // a dirty one raises an in-drawer accessible confirm dialog.
  const requestClose = useCallback(() => {
    if (anyDirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }, [anyDirty, onClose]);

  // Focus the panel once on mount so keyboard users land inside it. Kept in its
  // own mount-only effect: folding it into the keydown effect below re-ran
  // `panelRef.focus()` whenever `requestClose` changed identity (first keystroke
  // flips `dirty`), stealing focus off the title/description input.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // Esc closes the drawer (routes through the dirty guard), and Tab is trapped
  // within the drawer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (confirmDiscard) setConfirmDiscard(false);
        else requestClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      if (e.shiftKey && activeEl === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [requestClose, confirmDiscard]);

  // Insert text at the textarea caret (or append), keeping React state in sync.
  function insertAtCaret(snippet: string) {
    const ta = taRef.current;
    if (!ta) {
      setDescription((d) => d + snippet);
      return;
    }
    const start = ta.selectionStart ?? description.length;
    const end = ta.selectionEnd ?? description.length;
    const next = description.slice(0, start) + snippet + description.slice(end);
    setDescription(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + snippet.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  // Compress (client-side) then upload, then insert the markdown image. Guarded
  // against re-entry: a second paste/pick is ignored while one is in flight.
  async function uploadAndInsert(file: File) {
    if (uploadingRef.current) return; // synchronous guard (state lags a render)
    uploadingRef.current = true;
    setDescTab("edit"); // so the inserted markdown is visible and the caret resolves
    setUploading(true);
    try {
      const { file: out } = await compressImage(file);
      if (exceedsHardMax(out)) {
        toast(
          `Image is ${(out.size / 1024 / 1024).toFixed(1)}MB after compression; max is 10MB`,
          "error"
        );
        return;
      }
      const { url } = await api.uploadImage(out);
      const alt = (file.name || "image").replace(/\.[^.]+$/, "");
      insertAtCaret(`\n![${alt}](${url})\n`);
      toast("Image uploaded", "success");
    } catch (e) {
      toast((e as ApiClientError)?.message ?? "Upload failed", "error");
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const img = Array.from(e.clipboardData.items).find((it) =>
      it.type.startsWith("image/")
    );
    if (!img) return;
    const file = img.getAsFile();
    if (!file) return;
    e.preventDefault();
    void uploadAndInsert(file);
  }

  const targets = allowedTargets(sm, task.status_key);
  const ticketRefFor = useCallback(
    (id: string) => tasks?.find((t) => t.id === id)?.ticket_key ?? id,
    [tasks]
  );
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
      const saved = await api.updateTask(
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
      // Keep the drawer open while a comment draft is pending so Save never
      // silently drops it; adopt the saved copy so the fields read clean.
      if (commentDirty) onTaskUpdated?.(saved);
      else onClose();
    });

  // Move without closing: the returned ticket (new status + version) replaces
  // the drawer's copy, so the badge and move buttons update in place. Offers
  // Undo when the state machine allows the reverse edge.
  const move = (to: string) =>
    withBusy(async () => {
      const from = task.status_key;
      const moved = await api.moveTask(task.id, to, task.version);
      onTaskUpdated?.(moved);
      onChanged();
      toast(
        `Moved to ${statusLabel(to)}`,
        "success",
        canUndoMove(sm, from, to)
          ? { label: "Undo", onClick: () => void undoMove(moved.id, from, to) }
          : undefined
      );
    });

  // Undo may fire after the drawer closed or another edit landed, so re-read
  // the ticket for its current version and only move back if it's still where
  // we put it.
  async function undoMove(id: string, from: string, to: string) {
    try {
      const cur = await api.getTask(id);
      if (cur.status_key !== to) {
        toast("Ticket has moved since; nothing undone", "error");
        return;
      }
      const back = await api.moveTask(id, from, cur.version);
      onTaskUpdated?.(back);
      onChanged();
      toast(`Moved back to ${statusLabel(from)}`, "success");
    } catch (e) {
      toast((e as ApiClientError).message ?? "Undo failed", "error");
    }
  }

  const del = () =>
    withBusy(async () => {
      await api.deleteTask(task.id);
      toast("Moved to trash", "success");
      onChanged();
      onClose();
    });

  return (
    <div
      className="fixed inset-0 z-40 flex animate-fade-in justify-end bg-black/50"
      onClick={requestClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        tabIndex={-1}
        className="relative flex h-full w-full max-w-full animate-drawer-in flex-col border-l border-border bg-bg-soft outline-none sm:w-[60%] sm:min-w-[560px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top bar: everything needed to triage the ticket, pinned above the
            scrolling body so a long description never pushes it out of reach. */}
        <div className="shrink-0 space-y-3 border-b border-border px-5 pt-4 pb-4">
          <div className="flex items-center gap-2">
            <h2 id="drawer-title" className="sr-only">
              Edit task {task.ticket_key ?? task.id}
            </h2>
            <button
              onClick={async () => {
                const link = shareLink(window.location.origin, task);
                if (await copyText(link)) {
                  toast("Link copied", "success");
                } else {
                  toast(link, "success"); // last resort: surface the link to copy manually
                }
              }}
              className="shrink-0 font-mono text-xs text-fg-muted hover:text-fg"
              title="Copy link to this ticket"
            >
              🔗 {task.ticket_key ?? task.id}
            </button>
            <span
              className="min-w-0 truncate rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent ring-1 ring-accent-border"
              title="Current status"
            >
              {statusLabel(task.status_key)}
            </span>
            {targets.length === 0 && (
              <span className="shrink-0 rounded bg-warning-bg px-1.5 py-0.5 text-[10px] font-medium text-warning">
                final
              </span>
            )}
            <button
              onClick={requestClose}
              aria-label="Close"
              className="ml-auto shrink-0 rounded px-1 text-fg-muted hover:text-fg"
            >
              ✕
            </button>
          </div>

          <div>
            <label htmlFor="task-title" className="sr-only">
              Title
            </label>
            <input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              className="w-full rounded border border-border bg-bg-card px-3 py-2 text-sm font-medium text-fg outline-none focus:border-accent"
            />
          </div>

          <div
            role="group"
            aria-label="Move to status"
            className="flex flex-wrap items-center gap-2"
          >
            <span className="text-xs text-fg-muted">Move</span>
            {targets.length === 0 ? (
              <span className="text-xs text-fg-subtle">
                No moves available (final state).
              </span>
            ) : (
              targets.map((to) => (
                <button
                  key={to}
                  disabled={busy}
                  onClick={() => move(to)}
                  className="rounded border border-border px-2.5 py-1 text-xs text-fg hover:bg-bg-card disabled:opacity-50"
                >
                  → {statusLabel(to)}
                </button>
              ))
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="task-assignee" className="text-xs text-fg-muted">
                Assignee
              </label>
              <select
                id="task-assignee"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="min-w-0 rounded border border-border bg-bg-card px-2 py-1.5 text-sm text-fg outline-none focus:border-accent"
              >
                <option value="">Unassigned</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.username}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="task-priority" className="text-xs text-fg-muted">
                Priority
              </label>
              <div className="flex min-w-0 items-center gap-2">
                <PriorityIcon priority={priority} className="h-4 w-4 shrink-0" />
                <select
                  id="task-priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as typeof priority)}
                  className="min-w-0 flex-1 rounded border border-border bg-bg-card px-2 py-1.5 text-sm text-fg outline-none focus:border-accent"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label htmlFor="task-desc" className="text-xs text-fg-muted">
              Description
            </label>
            <div className="flex items-center gap-3 text-xs">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="text-fg-muted hover:text-fg disabled:opacity-50"
                title="Attach image"
              >
                {uploading ? "Uploading…" : "📎 Image"}
              </button>
              <div className="flex gap-1">
                {(["edit", "preview"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setDescTab(t)}
                    className={`rounded px-2 py-0.5 capitalize ${
                      descTab === t
                        ? "bg-bg-card text-fg"
                        : "text-fg-muted hover:text-fg"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadAndInsert(f);
              e.target.value = "";
            }}
          />
          {descTab === "edit" ? (
            <textarea
              id="task-desc"
              ref={taRef}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onPaste={onPaste}
              placeholder="Markdown supported. Paste or attach an image…"
              className="min-h-[280px] resize-y rounded border border-border bg-bg-card px-3 py-2 text-sm outline-none focus:border-accent"
            />
          ) : (
            <div className="min-h-[280px] overflow-auto rounded border border-border bg-bg-card px-4 py-3">
              {description.trim() ? (
                <Markdown>{description}</Markdown>
              ) : (
                <span className="text-sm text-fg-subtle">No description.</span>
              )}
            </div>
          )}
        </div>

        <LinksSection task={task} onOpenTask={onOpenTask} refreshKey={refreshKey} />

        <ActivitySection
          key={task.id}
          task={task}
          sm={sm}
          ticketRef={ticketRefFor}
          onDraftDirty={setCommentDirty}
          refreshKey={refreshKey}
        />
        </div>

        <div className="shrink-0 border-t border-border px-5 py-4">
          <div className="flex items-center justify-between">
            <button
              disabled={busy}
              onClick={del}
              className="inline-flex items-center gap-2 rounded border border-danger-border px-3 py-2 text-sm text-danger hover:bg-danger-bg disabled:opacity-50"
            >
              {busy && <Spinner className="h-3.5 w-3.5" />}
              Delete
            </button>
            <button
              disabled={busy}
              onClick={save}
              className="inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {busy && <Spinner className="h-3.5 w-3.5" />}
              Save
            </button>
          </div>
          {task.creator_username && (
            <div className="mt-2 text-[10px] text-fg-subtle">
              created by {task.creator_username}
            </div>
          )}
        </div>

        {confirmDiscard && (
          <div
            className="absolute inset-0 z-10 flex animate-fade-in items-center justify-center bg-black/40 p-6"
            onClick={() => setConfirmDiscard(false)}
          >
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="discard-title"
              className="w-full max-w-xs rounded-lg border border-border bg-bg-card p-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="discard-title" className="font-semibold text-fg">
                Discard unsaved changes?
              </h3>
              <p className="mt-1 text-sm text-fg-muted">
                {fieldsDirty && commentDirty
                  ? "Your edits and unsent comment will be lost."
                  : commentDirty
                    ? "Your unsent comment will be lost."
                    : "Your edits to this ticket will be lost."}
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  autoFocus
                  onClick={() => setConfirmDiscard(false)}
                  className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-bg-soft"
                >
                  Keep editing
                </button>
                <button
                  onClick={() => {
                    setConfirmDiscard(false);
                    onClose();
                  }}
                  className="rounded bg-danger px-3 py-1.5 text-sm text-danger-fg hover:opacity-90"
                >
                  Discard
                </button>
              </div>
            </div>
          </div>
        )}
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
  refreshKey,
}: {
  task: Task;
  onOpenTask?: (id: string) => void;
  refreshKey?: number;
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
  }, [reload, refreshKey]);

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
                    className="text-fg-subtle hover:text-danger"
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
