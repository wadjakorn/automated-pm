// Pure helpers for the board filter bar: the filter state, its URL encoding
// (?q=&assignee=&priority= so a filtered board is shareable), and the match
// predicate. Free of React/DOM so they are unit-testable.
import type { Task } from "@/lib/types";
import { isPriority, type Priority } from "@/lib/priority";

// assignee: "" = anyone, "me" = the viewer, "none" = unassigned, otherwise a
// username (readable in a shared link; an id is accepted too).
export interface BoardFilter {
  q: string;
  assignee: string;
  priority: Priority | "";
}

export const EMPTY_FILTER: BoardFilter = { q: "", assignee: "", priority: "" };

export const FILTER_KEYS = ["q", "assignee", "priority"] as const;

type ParamsLike = { get(name: string): string | null };

export function readFilter(params: ParamsLike): BoardFilter {
  const priority = params.get("priority") ?? "";
  return {
    q: params.get("q") ?? "",
    assignee: (params.get("assignee") ?? "").trim(),
    priority: isPriority(priority) ? priority : "",
  };
}

// Return a copy of `params` with the filter applied: empty fields are removed
// so an unfiltered board keeps a clean URL. Other params (project, task) stay.
export function writeFilter(params: URLSearchParams | string, f: BoardFilter): URLSearchParams {
  const sp = new URLSearchParams(params);
  const set = (k: string, v: string) => (v ? sp.set(k, v) : sp.delete(k));
  set("q", f.q);
  set("assignee", f.assignee);
  set("priority", f.priority);
  return sp;
}

export function isFilterActive(f: BoardFilter): boolean {
  return !!(f.q.trim() || f.assignee || f.priority);
}

// Does a card pass the filter? Text: every whitespace-separated term must
// appear (case-insensitive) in the title, ticket key or description.
export function matchesFilter(
  t: Pick<Task, "title" | "ticket_key" | "description" | "assignee_id" | "assignee_username" | "priority">,
  f: BoardFilter,
  meId: string | null
): boolean {
  if (f.priority && t.priority !== f.priority) return false;
  if (f.assignee === "me") {
    if (!meId || t.assignee_id !== meId) return false;
  } else if (f.assignee === "none") {
    if (t.assignee_id) return false;
  } else if (f.assignee) {
    const a = f.assignee.toLocaleLowerCase();
    if (t.assignee_id !== f.assignee && (t.assignee_username ?? "").toLocaleLowerCase() !== a)
      return false;
  }
  const terms = f.q.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length) {
    const hay = `${t.title}\n${t.ticket_key ?? ""}\n${t.description ?? ""}`.toLocaleLowerCase();
    if (!terms.every((term) => hay.includes(term))) return false;
  }
  return true;
}

// Column header count: "3/12" while filtering, plain "12" otherwise.
export function countLabel(shown: number, total: number, active: boolean): string {
  return active ? `${shown}/${total}` : String(total);
}
