"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { InboxItem } from "@/lib/types";
import { api, ApiClientError } from "@/lib/client";
import { notifyInboxChanged, useInboxChanged, usePoll, useProjects } from "./useApp";
import { AppShell } from "./AppShell";
import { Markdown } from "./Markdown";
import { ListSkeleton, Spinner } from "./ui";
import { toast } from "./Toast";
import { Author } from "./ActivitySection";
import { groupInbox, relativeTime, ticketHref } from "./activity-logic";

// Open questions across every project — what agents (or people) are waiting
// on. Answer inline (posts an `answer` replying to the question, which
// resolves it) or Resolve without answering. Handled items disappear at once
// and come back only if the server rejects the action.
export function Inbox() {
  const { projects, selectedId, select, reload } = useProjects();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Ids handled optimistically; filtered out even if a poll still returns
  // them before the write lands.
  const [handled, setHandled] = useState<Set<string>>(() => new Set());
  const [now, setNow] = useState(() => Date.now());
  // Answer drafts live here, not in the card: an optimistically removed card
  // unmounts, and if the write fails it must come back with its draft.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setItems(await api.listInbox());
    } catch (e) {
      toast((e as ApiClientError).message ?? "Could not load inbox", "error");
    } finally {
      setLoaded(true);
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  usePoll(load, [load], 15000);
  useInboxChanged(load);

  const setHandledId = (id: string, on: boolean) =>
    setHandled((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  // Optimistically drop the item, run the write, restore it on failure.
  async function act(item: InboxItem, fn: () => Promise<unknown>, ok: string) {
    setHandledId(item.id, true);
    try {
      await fn();
      toast(ok, "success");
      notifyInboxChanged();
      return true;
    } catch (e) {
      setHandledId(item.id, false);
      toast((e as ApiClientError).message ?? "Action failed", "error");
      return false;
    }
  }

  const visible = items.filter((i) => !handled.has(i.id));
  const groups = groupInbox(visible);

  return (
    <AppShell projects={projects} selectedId={selectedId} select={select} reload={reload}>
      <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
        <div className="mb-4 flex items-baseline gap-2">
          <h2 className="text-lg font-semibold text-fg">Inbox</h2>
          {loaded && (
            <span className="text-sm text-fg-subtle">
              {visible.length} open question{visible.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {!loaded ? (
          <ListSkeleton />
        ) : groups.length === 0 ? (
          <div className="rounded border border-border bg-bg-soft px-4 py-6 text-center text-sm text-fg-subtle">
            No open questions. Nobody is waiting on you.
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map((g) => (
              <section key={g.project_id} aria-labelledby={`inbox-${g.project_id}`}>
                <h3
                  id={`inbox-${g.project_id}`}
                  className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle"
                >
                  {g.project_name}{" "}
                  <span className="font-normal normal-case">({g.items.length})</span>
                </h3>
                <ul className="space-y-3">
                  {g.items.map((it) => (
                    <InboxCard
                      key={it.id}
                      item={it}
                      now={now}
                      draft={drafts[it.id] ?? ""}
                      setDraft={(v) => setDrafts((d) => ({ ...d, [it.id]: v }))}
                      onAnswer={(body) =>
                        act(
                          it,
                          () => api.addComment(it.task_id, body, "answer", it.id),
                          "Answer sent"
                        )
                      }
                      onResolve={() =>
                        act(it, () => api.resolveComment(it.id), "Question resolved")
                      }
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function InboxCard({
  item,
  now,
  draft,
  setDraft,
  onAnswer,
  onResolve,
}: {
  item: InboxItem;
  now: number;
  draft: string;
  setDraft: (v: string) => void;
  onAnswer: (body: string) => Promise<boolean>;
  onResolve: () => Promise<boolean>;
}) {
  const [sending, setSending] = useState(false);
  const taId = `answer-${item.id}`;

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    // The card unmounts at once (optimistic); on failure it comes back with
    // the draft intact because the draft lives in the parent.
    const ok = await onAnswer(body);
    setSending(false);
    if (ok) setDraft("");
  }

  return (
    <li className="theme-panel rounded border border-warning-border bg-bg-soft p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Link
          href={ticketHref(item)}
          className="min-w-0 flex-1 text-sm text-fg hover:text-accent hover:underline"
        >
          <span className="mr-1.5 font-mono text-xs text-fg-muted">
            {item.ticket_key ?? item.task_id}
          </span>
          <span className="font-medium">{item.task_title}</span>
        </Link>
        <span className="text-[11px] text-fg-subtle">
          {item.task_status}
          {item.task_assignee ? ` · ${item.task_assignee}` : ""}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-fg-subtle">
        <Author entry={item} />
        <span>asked</span>
        <time dateTime={item.created_at} title={new Date(item.created_at).toLocaleString()}>
          {relativeTime(item.created_at, now)}
        </time>
      </div>

      <div className="mt-1 break-words rounded border border-border bg-bg-card px-3 py-2">
        <Markdown>{item.body ?? ""}</Markdown>
      </div>

      <label htmlFor={taId} className="sr-only">
        Answer to {item.actor_username ?? "question"} on {item.ticket_key ?? item.task_id}
      </label>
      <textarea
        id={taId}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void send();
          }
        }}
        rows={2}
        placeholder="Write an answer… (Markdown, Ctrl/⌘+Enter to send)"
        className="mt-2 w-full resize-y rounded border border-border bg-bg-card px-2 py-1.5 text-sm text-fg outline-none focus:border-accent"
      />
      <div className="mt-2 flex items-center gap-2">
        <Link
          href={ticketHref(item)}
          className="text-xs text-fg-muted hover:text-fg hover:underline"
        >
          Open ticket →
        </Link>
        <button
          type="button"
          onClick={() => void onResolve()}
          className="ml-auto rounded border border-border px-3 py-1.5 text-xs text-fg-muted hover:bg-bg-card hover:text-fg"
        >
          Resolve
        </button>
        <button
          type="button"
          disabled={sending || !draft.trim()}
          onClick={() => void send()}
          className="inline-flex items-center gap-2 rounded bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {sending && <Spinner className="h-3 w-3" />}
          Answer
        </button>
      </div>
    </li>
  );
}
