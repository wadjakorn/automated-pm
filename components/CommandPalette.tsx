"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Project } from "@/lib/types";
import { api, ApiClientError, type SearchHit } from "@/lib/client";
import { useAuth } from "./useApp";
import { PriorityIcon } from "./PriorityIcon";
import { Spinner } from "./ui";
import { toast } from "./Toast";
import {
  paletteActions,
  parseSnippet,
  splitActions,
  ticketHref,
  type PaletteAction,
} from "./search-logic";

type Item = { kind: "ticket"; id: string; hit: SearchHit } | PaletteAction;

const DEBOUNCE_MS = 200;

// Ctrl/⌘+K command palette: full-text ticket search across projects plus a few
// actions matching the typed text (go to a project, Inbox, My work, create a
// ticket). A combobox: focus stays in the input, arrows move the active row,
// Enter runs it, Esc closes. Below `sm` it is a full-screen sheet.
export function CommandPalette({
  onClose,
  projects,
  currentProjectId,
}: {
  onClose: () => void;
  projects: Project[];
  currentProjectId: string | null;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const baseId = useId();
  const optionId = (i: number) => `${baseId}-opt-${i}`;

  // Focus the input on open; give focus back to whatever had it on close.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => prev?.focus?.();
  }, []);

  // Debounced search; a newer query aborts the request in flight so a slow
  // stale response can never overwrite fresher results.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      api
        .search(q, { limit: 20 }, ctl.signal)
        .then((rows) => {
          setHits(rows);
          setError(null);
        })
        .catch((e) => {
          if (ctl.signal.aborted) return;
          setHits([]);
          setError((e as ApiClientError).message ?? "Search failed");
        })
        .finally(() => {
          if (!ctl.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [query]);

  const currentProject = projects.find((p) => p.id === currentProjectId) ?? null;
  const actions = useMemo(
    () => paletteActions(query, { projects, currentProject }),
    [query, projects, currentProject]
  );
  const ticketItems: Item[] = query.trim()
    ? hits.map((hit) => ({ kind: "ticket" as const, id: `ticket:${hit.task.id}`, hit }))
    : [];
  const { lead, rest } = splitActions(actions, query, projects);
  const items: Item[] = [...lead, ...ticketItems, ...rest];
  // Index ranges, for the divider lines between the groups.
  const ticketsStart = lead.length;
  const restStart = lead.length + ticketItems.length;

  // New results → the top row is active again.
  useEffect(() => setActive(0), [query, hits]);

  useEffect(() => {
    const el = document.getElementById(optionId(active));
    el?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  async function run(item: Item | undefined) {
    if (!item || busy) return;
    if (item.kind === "ticket") {
      onClose();
      router.push(ticketHref(item.hit.task));
    } else if (item.kind === "project") {
      onClose();
      router.push(`/?project=${encodeURIComponent(item.projectId)}`);
    } else if (item.kind === "nav") {
      onClose();
      const q = currentProjectId ? `?project=${encodeURIComponent(currentProjectId)}` : "";
      router.push(item.href + q);
    } else {
      setBusy(true);
      try {
        const t = await api.createTask(item.projectId, item.title, undefined, undefined, user?.id);
        toast(`Created ${t.ticket_key ?? "ticket"}`, "success");
        onClose();
        router.push(ticketHref(t));
      } catch (e) {
        toast((e as ApiClientError).message ?? "Could not create ticket", "error");
      } finally {
        setBusy(false);
      }
    }
  }

  // Esc closes and Tab is trapped. Handled on window in the CAPTURE phase and
  // stopped there: the ticket drawer underneath listens on `document` (where
  // React's own root listener also sits), so a React-level stopPropagation
  // could not keep it from closing too.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
      } else if (e.key === "Tab") {
        e.stopPropagation();
        const f = dialogRef.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]),input:not([disabled])"
        );
        if (!f || !f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        const inside = dialogRef.current?.contains(document.activeElement);
        if (!inside || (e.shiftKey && document.activeElement === first)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.target !== inputRef.current) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!items.length) return;
      const d = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + d + items.length) % items.length);
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void run(items[active]);
    }
  }

  const q = query.trim();
  const statusText = !q
    ? ""
    : loading
      ? "Searching…"
      : error
        ? error
        : `${hits.length} ticket${hits.length === 1 ? "" : "s"} found`;

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-stretch justify-center bg-black/50 sm:items-start sm:p-4 sm:pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search and commands"
        onKeyDown={onKeyDown}
        // bg-bg, not bg-bg-card: some theme packs use translucent cards, and
        // the board must not show through the result list.
        className="theme-panel flex h-full w-full flex-col overflow-hidden border-border bg-bg shadow-2xl backdrop-blur-xl sm:h-auto sm:max-h-[70vh] sm:max-w-xl sm:rounded-lg sm:border"
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className="h-4 w-4 shrink-0 text-fg-subtle"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          >
            <circle cx="9" cy="9" r="5.5" />
            <path d="M13.5 13.5 17 17" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            role="combobox"
            aria-label="Search tickets or type a command"
            aria-expanded={items.length > 0}
            aria-controls={`${baseId}-list`}
            aria-autocomplete="list"
            aria-activedescendant={items.length ? optionId(active) : undefined}
            placeholder="Search tickets, projects, or type a new ticket title…"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-base text-fg outline-none placeholder:text-fg-subtle sm:text-sm"
          />
          {(loading || busy) && <Spinner className="h-3.5 w-3.5 text-fg-subtle" />}
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-xs text-fg-muted hover:bg-bg-soft hover:text-fg"
            aria-label="Close search"
          >
            Esc
          </button>
        </div>

        <ul
          ref={listRef}
          id={`${baseId}-list`}
          role="listbox"
          aria-label="Results"
          className="min-h-0 flex-1 overflow-y-auto py-1"
        >
          {items.map((item, i) => {
            const isActive = i === active;
            const firstAction =
              i > 0 && ((i === ticketsStart && ticketItems.length > 0) || i === restStart);
            return (
              <li
                key={item.id}
                id={optionId(i)}
                role="option"
                aria-selected={isActive}
                onMouseMove={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()} // keep focus in the input
                onClick={() => void run(item)}
                className={`mx-1 cursor-pointer rounded px-3 py-2 ${
                  isActive ? "bg-accent-soft" : ""
                } ${firstAction ? "mt-1 border-t border-border pt-2" : ""}`}
              >
                {item.kind === "ticket" ? <TicketRow hit={item.hit} query={q} /> : <ActionRow action={item} />}
              </li>
            );
          })}
        </ul>

        {q && !loading && !error && hits.length === 0 && (
          <p className="border-t border-border px-4 py-2 text-xs text-fg-subtle">
            No tickets match “{q}”.
          </p>
        )}
        <div className="hidden items-center gap-3 border-t border-border px-4 py-2 text-[11px] text-fg-subtle sm:flex">
          <span>↑↓ to move</span>
          <span>Enter to open</span>
          <span>Esc to close</span>
        </div>
        <p className="sr-only" role="status" aria-live="polite">
          {statusText}
        </p>
      </div>
    </div>
  );
}

function TicketRow({ hit, query }: { hit: SearchHit; query: string }) {
  const t = hit.task;
  const parts = parseSnippet(hit.snippet, query);
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 text-sm">
        <PriorityIcon priority={t.priority} className="h-3.5 w-3.5 shrink-0" />
        <span className="shrink-0 font-mono text-xs text-fg-muted">{t.ticket_key ?? t.id}</span>
        <span className="min-w-0 flex-1 truncate font-medium text-fg">{t.title}</span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-[1.375rem] text-[11px] text-fg-subtle">
        <span>{hit.project_name}</span>
        <span aria-hidden="true">·</span>
        <span>{t.status_key}</span>
        {t.assignee_username && (
          <>
            <span aria-hidden="true">·</span>
            <span>{t.assignee_username}</span>
          </>
        )}
        {t.archived_at && (
          <span className="rounded bg-bg-soft px-1 py-px text-[10px] font-medium uppercase tracking-wide text-fg-muted">
            archived
          </span>
        )}
      </div>
      {parts.length > 0 && (
        <div className="mt-1 line-clamp-2 break-words pl-[1.375rem] text-xs text-fg-muted">
          {parts.map((p, i) =>
            p.hit ? (
              <mark key={i} className="rounded-sm bg-warning-bg text-fg">
                {p.text}
              </mark>
            ) : (
              <span key={i}>{p.text}</span>
            )
          )}
        </div>
      )}
    </div>
  );
}

function ActionRow({ action }: { action: PaletteAction }) {
  const icon = action.kind === "project" ? "→" : action.kind === "new-ticket" ? "+" : "↗";
  return (
    <div className="flex items-center gap-2 text-sm text-fg">
      <span aria-hidden="true" className="w-3.5 shrink-0 text-center text-fg-subtle">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {action.label}
        {action.kind === "new-ticket" && (
          <span className="text-fg-muted">: “{action.title}”</span>
        )}
      </span>
    </div>
  );
}
