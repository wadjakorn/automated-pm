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

// Drag-and-drop: move `id` onto the slot of `overId` within its display group
// (after it when dragging down, before it when dragging up) and splice the
// result into the full order, like moveVisible. Null when nothing changes or
// the target is outside the group.
export function dropOnto(
  fullIds: string[],
  groupIds: string[],
  id: string,
  overId: string | null
): string[] | null {
  if (!overId || overId === id) return null;
  const from = groupIds.indexOf(id);
  const to = groupIds.indexOf(overId);
  if (from < 0 || to < 0 || !fullIds.includes(id)) return null;
  const rest = fullIds.filter((x) => x !== id);
  const ai = rest.indexOf(overId);
  if (ai < 0) return null;
  rest.splice(to < from ? ai : ai + 1, 0, id);
  return rest;
}

// Roving focus in the sidebar list (one tab stop): which item gets focus for
// a key, given the items' labels and the current index. ↑/↓ step without
// wrapping, Home/End jump, a printable character jumps to the next label
// starting with it (wrapping). Null = not a roving key / no match.
export function rovingTarget(labels: string[], from: number, key: string): number | null {
  const n = labels.length;
  if (n === 0) return null;
  if (key === "ArrowDown") return Math.min(from + 1, n - 1);
  if (key === "ArrowUp") return Math.max(from - 1, 0);
  if (key === "Home") return 0;
  if (key === "End") return n - 1;
  if (key.length !== 1 || !key.trim()) return null;
  const c = key.toLowerCase();
  for (let k = 1; k <= n; k++) {
    const i = (from + k + n) % n;
    if (labels[i].toLowerCase().startsWith(c)) return i;
  }
  return null;
}

// Short labels for the collapsed rail's chips: the ticket prefix (≤ 3 chars)
// when set, else the first 2 letters/digits of the name, widened to 3 when two
// name-based labels would collide.
export function railLabels(
  projects: { id: string; name: string; ticket_prefix: string | null }[]
): Record<string, string> {
  const clean = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "").toUpperCase();
  const fromName = projects.filter((p) => !p.ticket_prefix);
  const two = fromName.map((p) => clean(p.name).slice(0, 2));
  const out: Record<string, string> = {};
  for (const p of projects) {
    if (p.ticket_prefix) out[p.id] = clean(p.ticket_prefix).slice(0, 3) || "?";
  }
  fromName.forEach((p, i) => {
    const clash = two.filter((t) => t === two[i]).length > 1;
    out[p.id] = clean(p.name).slice(0, clash ? 3 : 2) || "?";
  });
  return out;
}
