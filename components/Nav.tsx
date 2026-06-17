"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { Project } from "@/lib/types";
import { api } from "@/lib/client";
import { toast } from "./Toast";

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
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const link = (href: string, label: string) => {
    const active = pathname === href;
    const q = selectedId ? `?project=${selectedId}` : "";
    return (
      <Link
        href={href + q}
        className={`rounded px-3 py-1.5 text-sm ${
          active ? "bg-bg-card text-white" : "text-gray-400 hover:text-gray-200"
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
    <header className="flex items-center gap-4 border-b border-border bg-bg-soft px-5 py-3">
      <span className="font-semibold text-white">📋 PM</span>

      <select
        value={selectedId ?? ""}
        onChange={(e) => onSelect(e.target.value)}
        className="rounded border border-border bg-bg-card px-2 py-1.5 text-sm text-gray-200 outline-none"
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
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500"
          >
            Add
          </button>
          <button
            onClick={() => setCreating(false)}
            className="text-sm text-gray-400 hover:text-gray-200"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="rounded border border-border px-3 py-1.5 text-sm text-gray-300 hover:bg-bg-card"
        >
          + New project
        </button>
      )}

      <nav className="ml-auto flex items-center gap-1">
        {link("/", "Board")}
        {link("/settings", "Settings")}
        {link("/trash", "Trash")}
      </nav>
    </header>
  );
}
