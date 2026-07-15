"use client";

import { useEffect, useState } from "react";
import type { Project } from "@/lib/types";
import { api } from "@/lib/client";
import { toast } from "./Toast";

// Collapsible left sidebar: the project switcher (a vertical list of buttons,
// the active one highlighted) plus the "+ New project" create flow — both moved
// out of the top <Nav>. Open/closed state is persisted per-browser in
// localStorage, matching the light/dark theme convention.
//
// Each project row carries an overflow (⋯) menu that expands inline (accordion,
// so it never clips inside the scrollable list) with reorder / hide / archive /
// delete actions. Hidden projects drop out of the list behind a "Show hidden"
// toggle; archived and deleted projects leave the list entirely (see the
// Archive and Trash views).
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
  // Which project's inline action menu is expanded (id), and whether hidden
  // projects are revealed. Both are ephemeral UI state (not persisted).
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

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

  const hiddenCount = projects.filter((p) => p.hidden).length;
  const visible = showHidden ? projects : projects.filter((p) => !p.hidden);

  // Persist a new order (full ordered id list) and refresh.
  async function reorder(next: Project[]) {
    try {
      await api.reorderProjects(next.map((p) => p.id));
      onProjectsChanged();
    } catch (e: any) {
      toast(e.message ?? "Failed to reorder", "error");
    }
  }

  // Move a project one slot within the FULL list (order is defined over every
  // live project, including hidden ones), then persist.
  function move(p: Project, dir: -1 | 1) {
    const i = projects.findIndex((x) => x.id === p.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= projects.length) return;
    const next = projects.slice();
    [next[i], next[j]] = [next[j], next[i]];
    reorder(next);
  }

  // When an action hides/removes the selected project from the visible list,
  // jump to the first remaining visible one so the board is never left on a gap.
  function selectAfter(removedId: string) {
    if (removedId !== selectedId) return;
    const next = visible.find((p) => p.id !== removedId);
    if (next) onSelect(next.id);
  }

  async function setHidden(p: Project, hidden: boolean) {
    try {
      await api.updateProject(p.id, { hidden });
      if (hidden) selectAfter(p.id);
      setMenuFor(null);
      onProjectsChanged();
    } catch (e: any) {
      toast(e.message ?? "Failed", "error");
    }
  }

  async function archive(p: Project) {
    try {
      await api.archiveProject(p.id);
      setMenuFor(null);
      onProjectsChanged();
      toast(`Archived "${p.name}"`, "success");
    } catch (e: any) {
      toast(e.message ?? "Failed to archive", "error");
    }
  }

  async function del(p: Project) {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Move project "${p.name}" to Trash? You can restore it later.`)
    )
      return;
    try {
      await api.deleteProject(p.id);
      setMenuFor(null);
      onProjectsChanged();
      toast(`Moved "${p.name}" to Trash`, "success");
    } catch (e: any) {
      toast(e.message ?? "Failed to delete", "error");
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
        {visible.length === 0 && (
          <p className="px-2 py-1 text-sm text-fg-subtle">
            {projects.length === 0 ? "No projects yet" : "No visible projects"}
          </p>
        )}
        {visible.map((p) => {
          const active = p.id === selectedId;
          const menuOpen = menuFor === p.id;
          const fullIdx = projects.findIndex((x) => x.id === p.id);
          return (
            <div key={p.id}>
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => onSelect(p.id)}
                  aria-current={active ? "true" : undefined}
                  title={p.name}
                  className={`flex min-w-0 flex-1 items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm ${
                    active
                      ? "bg-accent-soft text-accent ring-1 ring-accent-border"
                      : "text-fg-muted hover:bg-bg-soft hover:text-fg"
                  }`}
                >
                  {p.hidden ? (
                    <span
                      title="Hidden"
                      aria-label="Hidden"
                      className="shrink-0 text-fg-subtle"
                    >
                      ⦸
                    </span>
                  ) : null}
                  <span className="truncate">{p.name}</span>
                </button>
                <button
                  onClick={() => setMenuFor(menuOpen ? null : p.id)}
                  aria-label={`Actions for ${p.name}`}
                  aria-expanded={menuOpen}
                  title="Project actions"
                  className={`shrink-0 rounded px-1.5 py-1.5 text-fg-subtle hover:bg-bg-soft hover:text-fg ${
                    menuOpen ? "bg-bg-soft text-fg" : ""
                  }`}
                >
                  ⋯
                </button>
              </div>

              {menuOpen && (
                <div className="mb-1 ml-2 mt-0.5 flex flex-wrap gap-1 rounded border border-border bg-bg-card p-1">
                  <MenuBtn
                    label="↑"
                    title="Move up"
                    disabled={fullIdx <= 0}
                    onClick={() => move(p, -1)}
                  />
                  <MenuBtn
                    label="↓"
                    title="Move down"
                    disabled={fullIdx >= projects.length - 1}
                    onClick={() => move(p, 1)}
                  />
                  <MenuBtn
                    label={p.hidden ? "Show" : "Hide"}
                    title={p.hidden ? "Show in sidebar" : "Hide from sidebar"}
                    onClick={() => setHidden(p, !p.hidden)}
                  />
                  <MenuBtn label="Archive" title="Archive project" onClick={() => archive(p)} />
                  <MenuBtn
                    label="Delete"
                    title="Move to Trash"
                    danger
                    onClick={() => del(p)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {hiddenCount > 0 && (
        <button
          onClick={() => setShowHidden((v) => !v)}
          className="border-t border-border px-3 py-1.5 text-left text-xs text-fg-subtle hover:text-fg"
        >
          {showHidden ? "Hide hidden" : `Show hidden (${hiddenCount})`}
        </button>
      )}

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

// A compact button used inside a project's inline action menu.
function MenuBtn({
  label,
  title,
  onClick,
  disabled,
  danger,
}: {
  label: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`rounded border border-border px-2 py-1 text-xs disabled:opacity-40 ${
        danger
          ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
          : "text-fg-muted hover:bg-bg-soft hover:text-fg"
      }`}
    >
      {label}
    </button>
  );
}
