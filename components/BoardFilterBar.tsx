"use client";

import { useEffect, useRef, useState } from "react";
import type { PublicUser } from "@/lib/types";
import { PRIORITIES } from "@/lib/priority";
import { isFilterActive, type BoardFilter } from "./filter-logic";

const TEXT_DEBOUNCE_MS = 200;

// Filter row above the board columns. The filter itself lives in the URL
// (?q=&assignee=&priority=); this only keeps the text box responsive by
// debouncing what it writes there. `/` focuses the text box (bound in Board).
export function BoardFilterBar({
  filter,
  onChange,
  onClear,
  users,
  me,
  shown,
  total,
  inputRef,
}: {
  filter: BoardFilter;
  onChange: (patch: Partial<BoardFilter>) => void;
  onClear: () => void;
  users: PublicUser[];
  me: PublicUser | null;
  shown: number;
  total: number;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [text, setText] = useState(filter.q);
  // The last q this box wrote to the URL. A URL change to anything else came
  // from outside (Back, a shared link, Clear) and replaces the box's text; our
  // own lagging write must not clobber what the user typed since.
  const written = useRef(filter.q);

  useEffect(() => {
    if (filter.q !== written.current) {
      written.current = filter.q;
      setText(filter.q);
    }
  }, [filter.q]);

  useEffect(() => {
    if (text === written.current) return;
    const t = setTimeout(() => {
      written.current = text;
      onChange({ q: text });
    }, TEXT_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, onChange]);

  const active = isFilterActive({ ...filter, q: text });
  // A username in a shared link that isn't in the user list still shows.
  const knownAssignee =
    !filter.assignee ||
    filter.assignee === "me" ||
    filter.assignee === "none" ||
    users.some((u) => u.username === filter.assignee || u.id === filter.assignee);

  const select =
    "rounded border border-border bg-bg-card px-2 py-1.5 text-sm text-fg outline-none focus:border-accent";

  return (
    <div
      role="search"
      aria-label="Filter the board"
      className="flex flex-wrap items-center gap-2 px-3 pt-3 sm:px-4"
    >
      <div className="relative min-w-0 flex-1 basis-48 sm:max-w-xs">
        <label htmlFor="board-filter-q" className="sr-only">
          Filter cards by text
        </label>
        <input
          id="board-filter-q"
          ref={inputRef}
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && text) {
              e.preventDefault();
              e.stopPropagation();
              setText("");
            } else if (e.key === "Escape") {
              e.currentTarget.blur();
            }
          }}
          placeholder="Filter cards…"
          autoComplete="off"
          className="w-full rounded border border-border bg-bg-card py-1.5 pl-2 pr-7 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent"
        />
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-border px-1 font-sans text-[10px] text-fg-subtle sm:block"
        >
          /
        </kbd>
      </div>

      <label className="sr-only" htmlFor="board-filter-assignee">
        Assignee
      </label>
      <select
        id="board-filter-assignee"
        value={filter.assignee}
        onChange={(e) => onChange({ assignee: e.target.value })}
        className={select}
      >
        <option value="">Anyone</option>
        {me && <option value="me">Me ({me.username})</option>}
        <option value="none">Unassigned</option>
        {!knownAssignee && <option value={filter.assignee}>{filter.assignee}</option>}
        {users.length > 0 && (
          <optgroup label="People">
            {users.map((u) => (
              <option key={u.id} value={u.username}>
                {u.kind === "agent" ? `🤖 ${u.username}` : u.username}
              </option>
            ))}
          </optgroup>
        )}
      </select>

      <label className="sr-only" htmlFor="board-filter-priority">
        Priority
      </label>
      <select
        id="board-filter-priority"
        value={filter.priority}
        onChange={(e) => onChange({ priority: e.target.value as BoardFilter["priority"] })}
        className={select}
      >
        <option value="">Any priority</option>
        {[...PRIORITIES].reverse().map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>

      {active && (
        <>
          <span className="text-xs text-fg-subtle" role="status">
            {shown} of {total} card{total === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            onClick={() => {
              written.current = "";
              setText("");
              onClear();
            }}
            className="rounded px-2 py-1.5 text-sm text-fg-muted hover:bg-bg-soft hover:text-fg"
          >
            Clear
          </button>
        </>
      )}
    </div>
  );
}
