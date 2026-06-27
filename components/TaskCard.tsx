"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { Task } from "@/lib/types";
import type { Priority } from "@/lib/priority";
import { markdownToPlainText } from "@/lib/markdown";

// Color per priority. now/high stand out; medium is the quiet default; low dims.
const PRIORITY_STYLE: Record<Priority, string> = {
  now: "bg-red-500/15 text-red-400 ring-1 ring-red-500/30",
  high: "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30",
  medium: "bg-bg-soft text-fg-muted",
  low: "bg-bg-soft text-fg-subtle",
};

function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${PRIORITY_STYLE[priority] ?? PRIORITY_STYLE.medium}`}
    >
      {priority}
    </span>
  );
}

export function TaskCard({
  task,
  onOpen,
  overlay = false,
}: {
  task: Task;
  onOpen?: (t: Task) => void;
  overlay?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: task.id, data: { task }, disabled: overlay });

  const style = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={() => onOpen?.(task)}
      className={`cursor-grab rounded-md border border-border bg-bg-card p-3 text-sm shadow-sm active:cursor-grabbing ${
        isDragging && !overlay ? "opacity-30" : ""
      } ${overlay ? "rotate-2 shadow-xl" : "hover:border-fg-subtle"}`}
    >
      <div className="mb-1 flex items-start gap-2">
        <PriorityBadge priority={task.priority} />
        <span className="font-medium text-fg">{task.title}</span>
      </div>
      {task.description && (
        <div className="mt-1 line-clamp-2 text-xs text-fg-muted">
          {markdownToPlainText(task.description)}
        </div>
      )}
      {task.assignee_username && (
        <div className="mt-2 flex items-center gap-1 text-[11px] text-fg-muted">
          <span className="grid h-4 w-4 place-items-center rounded-full bg-accent text-[9px] font-semibold uppercase text-white">
            {task.assignee_username[0]}
          </span>
          {task.assignee_username}
        </div>
      )}
    </div>
  );
}
