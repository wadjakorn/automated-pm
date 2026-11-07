import type { Project } from "@/lib/types";

// Pure list arithmetic for the project Sidebar, so Sidebar.tsx only renders.
// Everything here works on the FULL live project list (the server's
// sort_order) plus a "display group": the rows the user can currently see
// for the project in question. Visible and hidden projects form two groups;
// moving within one must never reorder the other (PM-0027).

// Rows to render: visible projects first, in input (sort_order) order, then
// — only when the toggle is on — hidden projects, also in input order. This
// is display grouping only; sort_order is never rewritten here.
export function orderForDisplay(projects: Project[], showHidden: boolean): Project[] {
  const visible = projects.filter((p) => !p.hidden);
  if (!showHidden) return visible;
  return visible.concat(projects.filter((p) => p.hidden));
}

export type MoveTo = -1 | 1 | "top" | "bottom";

// Move `id` within its display group and return the new FULL order, or null
// when the move is a no-op (unknown id, or already at the group's edge).
// `groupIds` is that group's members in full-order sequence. The moved id is
// removed from the full list and re-inserted next to its group neighbour, so
// ids outside the group (hidden rows between visible ones, or vice-versa)
// keep their relative positions.
export function moveVisible(
  fullIds: string[],
  groupIds: string[],
  id: string,
  to: MoveTo
): string[] | null {
  const gi = groupIds.indexOf(id);
  if (gi < 0 || !fullIds.includes(id)) return null;
  const last = groupIds.length - 1;

  let anchor: string;
  let side: "before" | "after";
  if (to === -1 || to === "top") {
    if (gi === 0) return null;
    anchor = to === -1 ? groupIds[gi - 1] : groupIds[0];
    side = "before";
  } else {
    if (gi === last) return null;
    anchor = to === 1 ? groupIds[gi + 1] : groupIds[last];
    side = "after";
  }

  const rest = fullIds.filter((x) => x !== id);
  const ai = rest.indexOf(anchor);
  if (ai < 0) return null;
  rest.splice(side === "before" ? ai : ai + 1, 0, id);
  return rest;
}

// The row to select when `removedId` leaves the shown list: the one above it,
// else the one below, else nothing.
export function neighbourAfterRemoval(shownIds: string[], removedId: string): string | null {
  const i = shownIds.indexOf(removedId);
  if (i < 0) return null;
  if (i > 0) return shownIds[i - 1];
  return shownIds.length > 1 ? shownIds[1] : null;
}

// Readable error toast copy, instead of a raw API message.
export function actionFailed(verb: string, name: string): string {
  return `Couldn't ${verb} "${name}". Try again.`;
}

// Whether project `id` is still in the shown list after its hidden flag
// becomes `hidden`. Hiding a project while hidden projects are shown only
// moves it into the hidden group; it must not move the selection away.
export function stillShown(
  projects: Project[],
  id: string,
  hidden: boolean,
  showHidden: boolean
): boolean {
  const after = projects.map((p) => (p.id === id ? { ...p, hidden } : p));
  return orderForDisplay(after, showHidden).some((p) => p.id === id);
}

// Which reorder moves are available for the row at `index` of its display
// group of `length` rows (true = available). A row outside its group can't move.
export function moveAvailability(
  index: number,
  length: number
): { top: boolean; up: boolean; down: boolean; bottom: boolean } {
  const inGroup = index >= 0 && index < length;
  const up = inGroup && index > 0;
  const down = inGroup && index < length - 1;
  return { top: up, up, down, bottom: down };
}
