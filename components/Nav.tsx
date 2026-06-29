"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { Project } from "@/lib/types";
import { api } from "@/lib/client";
import { useAuth } from "./useApp";
import { toast } from "./Toast";
import { useTheme } from "./ThemeProvider";
import { nextChoice } from "./theme";

// Top bar: project switcher + create + nav links. Selected project is carried
// in the ?project= query string so it survives navigation across pages.
export function Nav({
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
  const pathname = usePathname();
  const { user, refresh } = useAuth();
  const { choice, setChoice, resolved } = useTheme();
  const themeIcon = resolved === "dark" ? "🌙" : "☀️";
  const themeLabel = `Theme: ${choice}`;
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  async function logout() {
    try {
      await api.logout();
      await refresh();
      toast("Logged out", "success");
    } catch (e: any) {
      toast(e.message ?? "Logout failed", "error");
    }
  }

  const link = (href: string, label: string) => {
    const active = pathname === href;
    const q = selectedId ? `?project=${selectedId}` : "";
    return (
      <Link
        href={href + q}
        className={`rounded px-3 py-1.5 text-sm ${
          active ? "bg-bg-card text-fg" : "text-fg-muted hover:text-fg"
        }`}
      >
        {label}
      </Link>
    );
  };

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

  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-border bg-bg-soft px-3 py-2 sm:gap-4 sm:px-5 sm:py-3">
      <span className="font-semibold text-fg">📋 PM</span>

      <select
        value={selectedId ?? ""}
        onChange={(e) => onSelect(e.target.value)}
        aria-label="Select project"
        className="max-w-[40vw] rounded border border-border bg-bg-card px-2 py-1.5 text-sm text-fg outline-none focus:border-accent sm:max-w-none"
      >
        {projects.length === 0 && <option value="">No projects</option>}
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      {creating ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="Project name"
            className="rounded border border-border bg-bg-card px-2 py-1.5 text-sm outline-none"
          />
          <button
            onClick={create}
            className="rounded bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover"
          >
            Add
          </button>
          <button
            onClick={() => setCreating(false)}
            className="text-sm text-fg-muted hover:text-fg"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="rounded border border-border px-3 py-1.5 text-sm text-fg-muted hover:bg-bg-card"
        >
          + New project
        </button>
      )}

      <nav className="ml-auto flex items-center gap-1 overflow-x-auto">
        {link("/", "Board")}
        {link("/settings", "Settings")}
        {link("/archive", "Archive")}
        {link("/trash", "Trash")}
        <button
          onClick={() => setChoice(nextChoice(choice))}
          title={themeLabel}
          aria-label={themeLabel}
          className="rounded px-2 py-1.5 text-sm text-fg-muted hover:text-fg"
        >
          {themeIcon}
        </button>
        <span className="mx-1 h-5 w-px bg-border" />
        {user ? (
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-fg-muted sm:inline">
              👤 {user.username}
            </span>
            <button
              onClick={logout}
              className="rounded px-2 py-1.5 text-sm text-fg-muted hover:text-fg"
            >
              Logout
            </button>
          </div>
        ) : (
          <>
            <Link
              href="/login"
              className="rounded px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
            >
              Login
            </Link>
            <Link
              href="/register"
              className="rounded border border-border px-3 py-1.5 text-sm text-fg-muted hover:bg-bg-card"
            >
              Register
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
