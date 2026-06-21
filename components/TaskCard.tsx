"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { Task } from "@/lib/types";

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
      } ${overlay ? "rotate-2 shadow-xl" : "hover:border-gray-500"}`}
    >
      <div className="font-medium text-gray-100">{task.title}</div>
      {task.description && (
        <div className="mt-1 line-clamp-2 text-xs text-gray-400">
          {task.description}
        </div>
      )}
      {task.assignee_username && (
        <div className="mt-2 flex items-center gap-1 text-[11px] text-gray-400">
          <span className="grid h-4 w-4 place-items-center rounded-full bg-blue-600 text-[9px] font-semibold uppercase text-white">
            {task.assignee_username[0]}
          </span>
          {task.assignee_username}
        </div>
      )}
    </div>
  );
}
