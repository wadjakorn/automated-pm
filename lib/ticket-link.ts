import type { Task, LinkVerb } from "./types";

// Canonical shareable link for a ticket: task-only, project resolved on open.
export function shareLink(origin: string, id: string): string {
  return `${origin}/?task=${id}`;
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
  // Bare token: ids are nanoid(12) — url-safe alphabet, no slashes or spaces.
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
  editingId: string | null
): TicketAction {
  if (!taskParam) return editingId ? { kind: "close" } : { kind: "noop" };
  if (taskParam === editingId) return { kind: "noop" };
  const found = tasks.find((t) => t.id === taskParam);
  return found ? { kind: "open-local", task: found } : { kind: "fetch" };
}
