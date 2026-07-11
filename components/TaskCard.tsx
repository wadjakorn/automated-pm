"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { Task } from "@/lib/types";
import { markdownToPlainText } from "@/lib/markdown";
import { shareLink } from "@/lib/ticket-link";
import { copyText } from "@/lib/clipboard";
import { PriorityIcon } from "./PriorityIcon";
import { toast } from "./Toast";

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

  // Copy the ticket's deep link (same link the detail drawer produces).
  // Stops propagation so it neither opens the card nor starts a drag.
  const copyIdLink = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const link = shareLink(window.location.origin, task.id);
    if (await copyText(link)) {
      toast("Link copied", "success");
    } else {
      toast(link, "success"); // last resort: surface the link to copy manually
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      role="button"
      tabIndex={overlay ? -1 : 0}
      aria-label={`Open task: ${task.title}`}
      onClick={() => onOpen?.(task)}
      onKeyDown={(e) => {
        if (!overlay && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen?.(task);
        }
      }}
      className={`cursor-grab rounded-md border border-border bg-bg-card p-3 text-sm shadow-sm transition-colors active:cursor-grabbing ${
        isDragging && !overlay ? "opacity-30" : ""
      } ${overlay ? "rotate-2 shadow-xl" : "hover:border-fg-subtle"}`}
    >
      <div className="mb-1 flex items-start gap-2">
        <span className="min-w-0 flex-1 font-medium text-fg">{task.title}</span>
        <PriorityIcon priority={task.priority} className="mt-0.5 h-4 w-4 shrink-0" />
      </div>
      {task.description && (
        <div className="mt-1 line-clamp-2 text-xs text-fg-muted">
          {markdownToPlainText(task.description)}
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        {task.assignee_username ? (
          <div className="flex min-w-0 items-center gap-1 text-[11px] text-fg-muted">
            <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-accent text-[9px] font-semibold uppercase text-white">
              {task.assignee_username[0]}
            </span>
            <span className="truncate">{task.assignee_username}</span>
          </div>
        ) : (
          <span />
        )}
        {overlay ? (
          <span className="shrink-0 font-mono text-[10px] text-fg-subtle">
            {task.id}
          </span>
        ) : (
          <button
            type="button"
            onClick={copyIdLink}
            // Stop the drag sensors (MouseSensor/TouchSensor) from activating
            // when the copy button is pressed — they listen on mousedown/touchstart.
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            title="Copy link to this ticket"
            className="shrink-0 rounded font-mono text-[10px] text-fg-subtle hover:text-fg-muted"
          >
            {task.id}
          </button>
        )}
      </div>
    </div>
  );
}
