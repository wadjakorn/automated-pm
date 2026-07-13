"use client";

import { useEffect, useState } from "react";
import type { Project } from "@/lib/types";
import { api } from "@/lib/client";
import { toast } from "./Toast";

// Collapsible left sidebar: the project switcher (a vertical list of buttons,
// the active one highlighted) plus the "+ New project" create flow — both moved
// out of the top <Nav>. Open/closed state is persisted per-browser in
// localStorage, matching the light/dark theme convention.
const SIDEBAR_KEY = "sidebar:open";

export function Sidebar({
  projects,
  selectedId,
  onSelect,
  onProjectsChanged,
}: {
  projects: Project[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onProjectsChanged: () => void;
}) {
  // Default open; the stored preference is restored on mount (below) so the
  // server render and first client render agree (no hydration mismatch).
  const [open, setOpen] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    const stored =
      typeof localStorage !== "undefined" ? localStorage.getItem(SIDEBAR_KEY) : null;
    if (stored === "0") setOpen(false);
  }, []);

  const toggle = () =>
    setOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });

  async function create() {
    if (!name.trim()) return;
    try {
      const p = await api.createProject(name.trim());
      setName("");
      setCreating(false);
      onProjectsChanged();
      onSelect(p.id);
      toast(`Project "${p.name}" created`, "success");
    } catch (e: any) {
      toast(e.message ?? "Failed to create project", "error");
    }
  }

  // Collapsed: a narrow rail with just the expand toggle.
  if (!open) {
    return (
      <aside className="theme-nav flex h-full w-11 shrink-0 flex-col items-center border-r border-border py-3">
        <button
          onClick={toggle}
          title="Show projects"
          aria-label="Show sidebar"
          aria-expanded={false}
          className="rounded px-2 py-1.5 text-fg-muted hover:text-fg"
        >
          »
        </button>
      </aside>
    );
  }

  return (
    <aside className="theme-nav flex h-full w-56 shrink-0 flex-col border-r border-border">
      <div className="flex items-center justify-between px-3 py-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
          Projects
        </span>
        <button
          onClick={toggle}
          title="Hide projects"
          aria-label="Hide sidebar"
          aria-expanded={true}
          className="rounded px-2 py-0.5 text-fg-muted hover:text-fg"
        >
          «
        </button>
      </div>

      <nav aria-label="Projects" className="flex-1 space-y-0.5 overflow-y-auto px-2">
        {projects.length === 0 && (
          <p className="px-2 py-1 text-sm text-fg-subtle">No projects yet</p>
        )}
        {projects.map((p) => {
          const active = p.id === selectedId;
          return (
            <button
              key={p.id}
              onClick={() => onSelect(p.id)}
              aria-current={active ? "true" : undefined}
              title={p.name}
              className={`block w-full truncate rounded px-2 py-1.5 text-left text-sm ${
                active
                  ? "bg-accent-soft text-accent ring-1 ring-accent-border"
                  : "text-fg-muted hover:bg-bg-soft hover:text-fg"
              }`}
            >
              {p.name}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-border p-2">
        {creating ? (
          <div className="space-y-2">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") create();
                if (e.key === "Escape") setCreating(false);
              }}
              placeholder="Project name"
              className="w-full rounded border border-border bg-bg-card px-2 py-1.5 text-sm outline-none focus:border-accent"
            />
            <div className="flex gap-2">
              <button
                onClick={create}
                className="flex-1 rounded bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover"
              >
                Add
              </button>
              <button
                onClick={() => setCreating(false)}
                className="rounded px-2 py-1.5 text-sm text-fg-muted hover:text-fg"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="w-full rounded border border-border px-3 py-1.5 text-sm text-fg-muted hover:bg-bg-card"
          >
            + New project
          </button>
        )}
      </div>
    </aside>
  );
}
