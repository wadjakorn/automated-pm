import type { Task } from "./types";

// Canonical shareable link for a ticket: task-only, project resolved on open.
export function shareLink(origin: string, id: string): string {
  return `${origin}/?task=${id}`;
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
