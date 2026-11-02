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
