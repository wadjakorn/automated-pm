import type { Task, LinkVerb } from "./types";

// How a ticket names itself in URLs, the API and the CLI: the human key when
// the project has a prefix, else the raw nanoid. Prefixes are globally unique
// (see lib/db.ts), so a key resolves to exactly one task.
export function ticketRef(task: Pick<Task, "id" | "ticket_key">): string {
  return task.ticket_key ?? task.id;
}

// Canonical shareable link for a ticket: task-only, project resolved on open.
export function shareLink(origin: string, task: Pick<Task, "id" | "ticket_key">): string {
  return `${origin}/?task=${ticketRef(task)}`;
}

// The five labels a user picks from when linking. Each maps to one stored verb
// plus which endpoint is the source — "blocked-by X" is just "X blocks this".
export type LinkOption =
  | "blocks"
  | "blocked-by"
  | "causes"
  | "caused-by"
  | "relates";

export const LINK_OPTIONS: { value: LinkOption; label: string }[] = [
  { value: "blocks", label: "Blocks" },
  { value: "blocked-by", label: "Blocked by" },
  { value: "causes", label: "Causes" },
  { value: "caused-by", label: "Caused by" },
  { value: "relates", label: "Relates to" },
];

// Human label for a stored edge as seen from one endpoint. `relates` is
// symmetric so it reads the same from both sides.
export function linkLabel(verb: LinkVerb, isSource: boolean): string {
  switch (verb) {
    case "blocks":
      return isSource ? "Blocks" : "Blocked by";
    case "causes":
      return isSource ? "Causes" : "Caused by";
    case "relates":
      return "Relates to";
    default:
      // verb comes from an untyped DB row; fail loud on an unknown value
      // rather than returning undefined.
      throw new Error(`unknown link verb "${verb}"`);
  }
}

// Turn a UI option + the two endpoints into a canonical directed edge.
// `relates` is symmetric, so we normalize to (min,max) id order — that makes
// A↔B and B↔A the same row, so the UNIQUE index dedupes them.
export function edgeFromOption(
  thisId: string,
  otherId: string,
  option: LinkOption
): { sourceId: string; targetId: string; verb: LinkVerb } {
  switch (option) {
    case "blocks":
      return { sourceId: thisId, targetId: otherId, verb: "blocks" };
    case "blocked-by":
      return { sourceId: otherId, targetId: thisId, verb: "blocks" };
    case "causes":
      return { sourceId: thisId, targetId: otherId, verb: "causes" };
    case "caused-by":
      return { sourceId: otherId, targetId: thisId, verb: "causes" };
    case "relates": {
      const [a, b] = thisId < otherId ? [thisId, otherId] : [otherId, thisId];
      return { sourceId: a, targetId: b, verb: "relates" };
    }
  }
}

// Extract a task id from a pasted share URL (.../?task=<id>) or a bare id.
// Returns null when nothing usable is found so callers can reject cleanly.
export function parseTicketRef(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  // URL form first: `task=` may sit anywhere in the query, with other params.
  const m = s.match(/[?&]task=([^&\s]+)/);
  if (m) return decodeURIComponent(m[1]);
  // Bare token: either a nanoid(12) (url-safe alphabet, no slashes or spaces)
  // or a human ticket key like PM-0002 — both match this shape.
  if (/^[A-Za-z0-9_-]+$/.test(s)) return s;
  return null;
}

export type TicketAction =
  | { kind: "open-local"; task: Task }
  | { kind: "fetch" }
  | { kind: "close" }
  | { kind: "noop" };

// Decide what the board should do given the URL's `task` param, the currently
// loaded tasks, and which ticket is already open. Pure — all inputs injected.
export function resolveTicketAction(
  taskParam: string | null,
  tasks: Task[],
  editing: Pick<Task, "id" | "ticket_key"> | null
): TicketAction {
  if (!taskParam) return editing ? { kind: "close" } : { kind: "noop" };

  // Storage id wins over ticket key, mirroring getTask() on the server. A
  // random id can coincidentally spell a valid key ("ABC-00012345"), so every
  // id candidate must be exhausted before any key is considered — otherwise a
  // legacy link could open whichever ticket happens to own that key.
  if (taskParam === editing?.id) return { kind: "noop" };
  const byId = tasks.find((t) => t.id === taskParam);
  if (byId) return { kind: "open-local", task: byId };

  // Only now interpret the param as a key. Checking the open ticket separately
  // from `tasks` matters: a deep link names it by key while the drawer holds
  // the nanoid, and it may not be in `tasks` at all (archived, or in another
  // project) — comparing against the list alone would refetch it every render.
  if (taskParam === editing?.ticket_key) return { kind: "noop" };
  const byKey = tasks.find((t) => t.ticket_key === taskParam);
  return byKey ? { kind: "open-local", task: byKey } : { kind: "fetch" };
}
