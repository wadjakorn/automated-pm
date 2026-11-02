"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ActivityEntry, StateMachine, Task } from "@/lib/types";
import { api, ApiClientError } from "@/lib/client";
import { Markdown } from "./Markdown";
import { Spinner } from "./ui";
import { toast } from "./Toast";
import { notifyInboxChanged, usePoll } from "./useApp";
import {
  actorName,
  describeActivity,
  excerpt,
  isOpenQuestion,
  lastSeq,
  mergeActivity,
  relativeTime,
} from "./activity-logic";

type ComposeKind = "note" | "question" | "handoff";

const KIND_OPTIONS: { value: ComposeKind; label: string }[] = [
  { value: "note", label: "Note" },
  { value: "question", label: "Question" },
  { value: "handoff", label: "Handoff" },
];

// The ticket's history (comments + every change), oldest first, with a
// comment composer underneath. Mount it with `key={task.id}` so a different
// ticket starts from a clean timeline and an empty draft.
//
// Fetching is incremental: ?since=<last seq>. A save/move on the drawer bumps
// task.version, which triggers a fetch; otherwise it polls every 5s while the
// tab is visible. The list scrolls inside its own box (newest at the bottom),
// so jumping to the latest entry never pushes the description out of view.
export function ActivitySection({
  task,
  sm,
  ticketRef,
  onDraftDirty,
  refreshKey,
}: {
  task: Task;
  sm: StateMachine;
  ticketRef: (id: string) => string;
  // Reports whether an unsent comment draft exists (drawer close guard).
  onDraftDirty?: (dirty: boolean) => void;
  // Bumped when the live stream reports a change to this ticket → refetch now.
  refreshKey?: number;
}) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [draft, setDraft] = useState("");
  const [kind, setKind] = useState<ComposeKind>("note");
  const [replyTo, setReplyTo] = useState<ActivityEntry | null>(null);
  const [sending, setSending] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);

  const seqRef = useRef(0);
  const listRef = useRef<HTMLOListElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Follow new entries only while the user is at (or near) the bottom, so
  // reading older history isn't yanked away by a poll.
  const stickRef = useRef(true);

  const statusLabel = useCallback(
    (k: string) => sm.statuses.find((s) => s.key === k)?.label ?? k,
    [sm]
  );

  const fetchNew = useCallback(async () => {
    try {
      const rows = await api.listActivity(task.id, { since: seqRef.current, limit: 1000 });
      // Never move the cursor backwards; a locally merged post (below) doesn't
      // advance it, so rows from others in between still arrive.
      seqRef.current = Math.max(seqRef.current, lastSeq(rows));
      if (rows.length) setEntries((prev) => mergeActivity(prev, rows));
    } catch {
      // transient; the next poll retries
    } finally {
      setLoaded(true);
      setNow(Date.now());
    }
  }, [task.id]);

  // Initial load + refetch after the drawer saves/moves this ticket, or when
  // the board's live stream says someone else changed it.
  useEffect(() => {
    void fetchNew();
  }, [fetchNew, task.version, refreshKey]);

  usePoll(fetchNew, [fetchNew], 5000);

  useEffect(() => {
    onDraftDirty?.(draft.trim() !== "");
  }, [draft, onDraftDirty]);
  // Clear the parent's flag when this ticket's section goes away.
  useEffect(() => () => onDraftDirty?.(false), [onDraftDirty]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [entries.length, loaded]);

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    const k = replyTo ? "answer" : kind;
    setSending(true);
    try {
      const created = await api.addComment(task.id, body, k, replyTo?.id);
      stickRef.current = true;
      setEntries((prev) => mergeActivity(prev, [created]));
      setDraft("");
      setReplyTo(null);
      setKind("note"); // a question is deliberate; don't leave it sticky
      if (k === "question" || k === "answer") notifyInboxChanged();
      void fetchNew();
    } catch (e) {
      toast((e as ApiClientError).message ?? "Could not post comment", "error");
    } finally {
      setSending(false);
    }
  }

  async function resolve(q: ActivityEntry) {
    setResolving(q.id);
    try {
      const updated = await api.resolveComment(q.id);
      setEntries((prev) => mergeActivity(prev, [updated]));
      if (replyTo?.id === q.id) setReplyTo(null);
      notifyInboxChanged();
      void fetchNew();
    } catch (e) {
      toast((e as ApiClientError).message ?? "Could not resolve", "error");
    } finally {
      setResolving(null);
    }
  }

  function answer(q: ActivityEntry) {
    setReplyTo(q);
    requestAnimationFrame(() => {
      taRef.current?.focus();
      taRef.current?.scrollIntoView({ block: "nearest" });
    });
  }

  return (
    <section aria-labelledby="activity-heading" className="flex flex-col gap-2">
      <h3 id="activity-heading" className="text-xs text-fg-muted">
        Activity
      </h3>

      {!loaded ? (
        <div className="flex items-center gap-2 text-xs text-fg-subtle">
          <Spinner className="h-3 w-3" /> Loading activity…
        </div>
      ) : entries.length === 0 ? (
        <div className="text-xs text-fg-subtle">No activity yet.</div>
      ) : (
        <ol
          ref={listRef}
          onScroll={onScroll}
          aria-label="Ticket activity, oldest first"
          className="flex max-h-[28rem] flex-col gap-1.5 overflow-y-auto pr-1"
        >
          {entries.map((e) =>
            e.type === "comment" ? (
              <CommentRow
                key={e.id}
                entry={e}
                parent={e.reply_to ? entries.find((x) => x.id === e.reply_to) : undefined}
                now={now}
                busy={resolving === e.id}
                onAnswer={() => answer(e)}
                onResolve={() => resolve(e)}
              />
            ) : (
              <li
                key={e.id}
                className="flex items-baseline gap-2 px-1 text-xs text-fg-subtle"
              >
                <span aria-hidden="true">·</span>
                <span className="min-w-0 flex-1 break-words">
                  {describeActivity(e, { statusLabel, ticketRef })}
                </span>
                <time
                  dateTime={e.created_at}
                  title={new Date(e.created_at).toLocaleString()}
                  className="shrink-0"
                >
                  {relativeTime(e.created_at, now)}
                </time>
              </li>
            )
          )}
        </ol>
      )}

      {/* Composer */}
      <div className="flex flex-col gap-2 rounded border border-border bg-bg-card p-2">
        {replyTo && (
          <div className="flex items-center gap-2 text-xs text-fg-muted">
            <span className="min-w-0 flex-1 truncate">
              Answering {actorName(replyTo)}: “{excerpt(replyTo.body)}”
            </span>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              className="shrink-0 text-fg-subtle hover:text-fg"
            >
              Cancel
            </button>
          </div>
        )}
        <label htmlFor="comment-body" className="sr-only">
          {replyTo ? "Answer" : "Comment"}
        </label>
        <textarea
          id="comment-body"
          ref={taRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
          rows={3}
          placeholder={replyTo ? "Write an answer… (Markdown)" : "Add a comment… (Markdown)"}
          className="resize-y rounded border border-border bg-bg-soft px-2 py-1.5 text-sm text-fg outline-none focus:border-accent"
        />
        <div className="flex items-center gap-2">
          {!replyTo && (
            <>
              <label htmlFor="comment-kind" className="sr-only">
                Comment kind
              </label>
              <select
                id="comment-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as ComposeKind)}
                className="rounded border border-border bg-bg-soft px-2 py-1 text-xs text-fg outline-none"
              >
                {KIND_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </>
          )}
          <span className="hidden text-[10px] text-fg-subtle sm:inline">
            Ctrl/⌘+Enter to send
          </span>
          <button
            type="button"
            disabled={sending || !draft.trim()}
            onClick={() => void send()}
            className="ml-auto inline-flex items-center gap-2 rounded bg-accent px-3 py-1 text-xs text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {sending && <Spinner className="h-3 w-3" />}
            {replyTo ? "Send answer" : "Send"}
          </button>
        </div>
      </div>
    </section>
  );
}


export function KindBadge({ entry }: { entry: ActivityEntry }) {
  const base = "rounded px-1.5 py-0.5 text-[10px] font-medium";
  switch (entry.kind) {
    case "question":
      return entry.resolved_at ? (
        <span className={`${base} bg-success-bg text-success`}>Question · resolved</span>
      ) : (
        <span className={`${base} bg-warning-bg text-warning`}>Question · open</span>
      );
    case "answer":
      return <span className={`${base} bg-accent-soft text-accent`}>Answer</span>;
    case "handoff":
      return (
        <span className={`${base} border border-border bg-bg-soft text-fg-muted`}>Handoff</span>
      );
    default:
      return null;
  }
}

// Author name with a robot marker for agents (screen readers hear "agent").
export function Author({ entry }: { entry: Pick<ActivityEntry, "actor_username" | "actor_kind"> }) {
  return (
    <span className="font-medium text-fg">
      {entry.actor_username ?? "someone"}
      {entry.actor_kind === "agent" && (
        <>
          <span aria-hidden="true" title="Agent">
            {" "}🤖
          </span>
          <span className="sr-only"> (agent)</span>
        </>
      )}
    </span>
  );
}

function CommentRow({
  entry,
  parent,
  now,
  busy,
  onAnswer,
  onResolve,
}: {
  entry: ActivityEntry;
  parent?: ActivityEntry;
  now: number;
  busy: boolean;
  onAnswer: () => void;
  onResolve: () => void;
}) {
  const open = isOpenQuestion(entry);
  return (
    <li
      className={`rounded border bg-bg-card px-3 py-2 ${
        open ? "border-warning-border" : "border-border"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <Author entry={entry} />
        <KindBadge entry={entry} />
        <time
          dateTime={entry.created_at}
          title={new Date(entry.created_at).toLocaleString()}
          className="ml-auto text-fg-subtle"
        >
          {relativeTime(entry.created_at, now)}
        </time>
      </div>
      {parent && (
        <div className="mt-1 truncate border-l-2 border-border pl-2 text-[11px] text-fg-subtle">
          ↳ {actorName(parent)}: “{excerpt(parent.body)}”
        </div>
      )}
      <div className="mt-1 break-words">
        <Markdown>{entry.body ?? ""}</Markdown>
      </div>
      {open && (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={onAnswer}
            className="rounded border border-border px-2.5 py-1 text-xs text-fg hover:bg-bg-soft"
          >
            Answer
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onResolve}
            className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-xs text-fg-muted hover:bg-bg-soft hover:text-fg disabled:opacity-50"
          >
            {busy && <Spinner className="h-3 w-3" />}
            Resolve
          </button>
        </div>
      )}
    </li>
  );
}
