// Compact task shape for agents and dashboards: descriptions here run up to
// ~30k chars, so a full project list can be hundreds of KB. `summary` keeps
// every field but trims the description to an excerpt and says so.
import type { Task } from "./types";

export const SUMMARY_EXCERPT_CHARS = 200;

export type TaskSummary = Task & { has_more_description: boolean };

export function summarizeTask(t: Task, max = SUMMARY_EXCERPT_CHARS): TaskSummary {
  const d = t.description;
  if (d == null || d.length <= max) return { ...t, has_more_description: false };
  return { ...t, description: d.slice(0, max).trimEnd() + "…", has_more_description: true };
}

// The list-row shape agents scan to pick a ticket: identity, state, owner and
// a short excerpt. Everything else (rank, version, ids, timestamps) is one
// pm_get_task away. Keeps a 200-ticket page well under an agent's token budget.
export type TaskListRow = {
  id: string;
  ticket_key: string | null;
  title: string;
  status_key: string;
  priority: Task["priority"];
  assignee_username: string | null;
  updated_at: string;
  excerpt: string | null;
  has_more_description: boolean;
};

export const LIST_EXCERPT_CHARS = 120;

export function compactTask(t: Task, max = LIST_EXCERPT_CHARS): TaskListRow {
  const d = t.description?.trim() || null;
  const more = d != null && d.length > max;
  return {
    id: t.id,
    ticket_key: t.ticket_key ?? null,
    title: t.title,
    status_key: t.status_key,
    priority: t.priority,
    assignee_username: t.assignee_username ?? null,
    updated_at: t.updated_at,
    excerpt: more ? d!.slice(0, max).trimEnd() + "…" : d,
    has_more_description: more,
  };
}
