import type { Priority } from "@/lib/priority";

// Priority as a directional-arrow SHAPE (Jira-style), not just a color: up =
// more urgent, down = less. Shape is the primary signal so it stays legible for
// colorblind users and at small sizes; a semantic theme color reinforces it
// (redundant encoding) — `now` glows red, `low` stays quiet.
const PRIORITY_COLOR: Record<Priority, string> = {
  now: "text-danger",
  high: "text-warning",
  medium: "text-fg-muted",
  low: "text-fg-subtle",
};

// Stroke paths on a 0 0 24 24 grid. now = double chevron up, high = single up,
// medium = double flat bar (equals; neither up nor down), low = chevron down.
const PRIORITY_PATH: Record<Priority, string> = {
  now: "M5 12 L12 6 L19 12 M5 18 L12 12 L19 18",
  high: "M5 15 L12 9 L19 15",
  medium: "M5 9 L19 9 M5 15 L19 15",
  low: "M5 9 L12 15 L19 9",
};

export function PriorityIcon({
  priority,
  className = "",
}: {
  priority: Priority;
  className?: string;
}) {
  const color = PRIORITY_COLOR[priority] ?? PRIORITY_COLOR.medium;
  const path = PRIORITY_PATH[priority] ?? PRIORITY_PATH.medium;
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label={`Priority: ${priority}`}
      className={`${color} ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <title>{`Priority: ${priority}`}</title>
      <path d={path} />
    </svg>
  );
}
