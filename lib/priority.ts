// Task priority: a small fixed scale, independent of the per-project state
// machine. Higher rank sorts to the TOP of a column (now → high → medium → low).
// Shared by repo (sort + validation), API, CLI, and UI.

export const PRIORITIES = ["low", "medium", "high", "now"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const DEFAULT_PRIORITY: Priority = "medium";

// Display order, top → bottom. Lower number = higher up the column.
const ORDER: Record<Priority, number> = { now: 0, high: 1, medium: 2, low: 3 };

export function isPriority(x: unknown): x is Priority {
  return typeof x === "string" && (PRIORITIES as readonly string[]).includes(x);
}

// Sort key for a column (ascending): now=0 … low=3. Unknown values sort last.
export function priorityOrder(p: string | null | undefined): number {
  return isPriority(p) ? ORDER[p] : ORDER.low + 1;
}
