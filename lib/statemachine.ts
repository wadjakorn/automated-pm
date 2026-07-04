import { nanoid } from "nanoid";
import type { StateMachine, Status, Transition, TransitionCheck } from "./types";

// Default status template. Order matters: it becomes sort_order.
// `deleted` is intentionally NOT a visible status — soft delete (deleted_at)
// replaces it.
export const DEFAULT_STATUSES: ReadonlyArray<{
  key: string;
  label: string;
  is_final: boolean;
}> = [
  { key: "backlog", label: "Backlog", is_final: false },
  { key: "todo", label: "To Do", is_final: false },
  { key: "doing", label: "Doing", is_final: false },
  { key: "completed", label: "Completed", is_final: false },
  { key: "tested", label: "Tested", is_final: false },
  { key: "released", label: "Released", is_final: true },
];

// Default allowed transitions: a simple linear chain.
export const DEFAULT_TRANSITIONS: ReadonlyArray<{
  from_key: string;
  to_key: string;
}> = [
  { from_key: "backlog", to_key: "todo" },
  { from_key: "todo", to_key: "doing" },
  { from_key: "doing", to_key: "completed" },
  { from_key: "completed", to_key: "tested" },
  { from_key: "tested", to_key: "released" },
];

// Materialise the default template into project-scoped rows (with ids).
export function buildDefaultStateMachine(projectId: string): StateMachine {
  const statuses: Status[] = DEFAULT_STATUSES.map((s, i) => ({
    id: nanoid(12),
    project_id: projectId,
    key: s.key,
    label: s.label,
    sort_order: i,
    is_final: s.is_final,
    hidden: false,
  }));
  const transitions: Transition[] = DEFAULT_TRANSITIONS.map((t) => ({
    id: nanoid(12),
    project_id: projectId,
    from_key: t.from_key,
    to_key: t.to_key,
  }));
  return { statuses, transitions };
}

// Single source of truth for whether a status move is legal.
// Called by the API; the CLI inherits it by going through the API.
export function canTransition(
  sm: StateMachine,
  fromKey: string,
  toKey: string
): TransitionCheck {
  const from = sm.statuses.find((s) => s.key === fromKey);
  const to = sm.statuses.find((s) => s.key === toKey);
  if (!from) return { ok: false, reason: `Unknown source status "${fromKey}"` };
  if (!to) return { ok: false, reason: `Unknown target status "${toKey}"` };

  // No-op move is always fine.
  if (fromKey === toKey) return { ok: true };

  // Final states are locked: no outbound moves.
  if (from.is_final) {
    return { ok: false, reason: `Status "${fromKey}" is final and locked` };
  }

  const edge = sm.transitions.find(
    (t) => t.from_key === fromKey && t.to_key === toKey
  );
  if (!edge) {
    return {
      ok: false,
      reason: `No transition defined from "${fromKey}" to "${toKey}"`,
    };
  }
  return { ok: true };
}

// All statuses reachable in one step from `fromKey` (empty if final/unknown).
export function allowedTargets(sm: StateMachine, fromKey: string): string[] {
  const from = sm.statuses.find((s) => s.key === fromKey);
  if (!from || from.is_final) return [];
  return sm.transitions
    .filter((t) => t.from_key === fromKey)
    .map((t) => t.to_key);
}
