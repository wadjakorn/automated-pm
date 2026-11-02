// Pure board-UI helpers (no React, no DOM) so they can be unit-tested in the
// node test environment. Kept out of lib/statemachine.ts, which is the
// server-side source of truth for legal moves; these only shape what the web
// board shows.
import type { Project, StateMachine } from "@/lib/types";
import { allowedTargets } from "@/lib/statemachine";

// How a column should look while a card from `fromKey` is being dragged:
// "same" = the card's own column (unchanged), "legal" = a valid drop target
// (keeps the isOver highlight), "illegal" = dimmed, the server would reject it.
export type DropHint = "same" | "legal" | "illegal";

export function dropHint(sm: StateMachine, fromKey: string, toKey: string): DropHint {
  if (fromKey === toKey) return "same";
  return allowedTargets(sm, fromKey).includes(toKey) ? "legal" : "illegal";
}

// True when `to -> from` is a legal move, i.e. a just-made move can be undone.
export function canUndoMove(sm: StateMachine, from: string, to: string): boolean {
  return from !== to && allowedTargets(sm, to).includes(from);
}

// A project the board may land on by default: not hidden from the sidebar and
// not archived (archived ones are normally filtered by the API anyway).
const selectable = (p: Project) => !p.hidden && !p.archived_at;

// Default project when the URL names none (or a stale one): the last project
// the user had selected, if it still exists and is selectable, else the first
// selectable project. Falls back to the first project at all so a user whose
// every project is hidden still sees a board rather than an empty screen.
export function pickDefaultProject(
  projects: Project[],
  lastId: string | null
): string | null {
  const last = lastId ? projects.find((p) => p.id === lastId) : undefined;
  if (last && selectable(last)) return last.id;
  return (projects.find(selectable) ?? projects[0])?.id ?? null;
}

// Keyboard drag: the x of the column one step left/right of the dragged card.
// `columns` are droppable rects (any order); `centerX` is the card's current
// horizontal center. Returns the left edge that centers a `cardWidth`-wide
// card in the neighbouring column, or null at either end of the board.
export function neighbourColumnX(
  columns: { left: number; width: number }[],
  centerX: number,
  cardWidth: number,
  dir: -1 | 1
): number | null {
  const sorted = columns.slice().sort((a, b) => a.left - b.left);
  if (sorted.length === 0) return null;
  // Current column: the one containing the card center, else the nearest.
  let cur = sorted.findIndex((c) => centerX >= c.left && centerX <= c.left + c.width);
  if (cur < 0) {
    let best = Infinity;
    sorted.forEach((c, i) => {
      const d = Math.abs(c.left + c.width / 2 - centerX);
      if (d < best) {
        best = d;
        cur = i;
      }
    });
  }
  const next = sorted[cur + dir];
  if (!next) return null;
  return next.left + (next.width - cardWidth) / 2;
}
