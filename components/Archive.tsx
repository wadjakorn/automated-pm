"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Task } from "@/lib/types";
import { api, ApiClientError } from "@/lib/client";
import { useProjects } from "./useApp";
import { Nav } from "./Nav";
import { toast } from "./Toast";

// Archived tickets: filed off the board but still live (openable by link,
// searchable in future). Mirrors Trash, but Unarchive instead of Restore.
export function Archive() {
  const { projects, selectedId, select, reload, loaded } = useProjects();
  const [archived, setArchived] = useState<Task[]>([]);

  const load = useCallback(async (pid: string) => {
    const all = await api.listArchivedTasks(pid);
    setArchived(all.filter((t) => t.archived_at && !t.deleted_at));
  }, []);

  useEffect(() => {
    if (selectedId) load(selectedId).catch(() => {});
  }, [selectedId, load]);

  async function unarchive(id: string) {
    try {
      await api.unarchiveTask(id);
      toast("Unarchived", "success");
      if (selectedId) load(selectedId);
    } catch (e) {
      toast((e as ApiClientError).message ?? "Failed", "error");
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <Nav
        projects={projects}
        selectedId={selectedId}
        onSelect={select}
        onProjectsChanged={reload}
      />
      <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto p-6">
        <h2 className="mb-4 text-lg font-semibold text-fg">Archive</h2>
        {!selectedId ? (
          <div className="text-fg-subtle">
            {loaded ? "Create a project first." : "Loading…"}
          </div>
        ) : archived.length === 0 ? (
          <div className="text-fg-subtle">No archived tickets.</div>
        ) : (
          <div className="space-y-2">
            {archived.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-3 rounded border border-border bg-bg-soft px-3 py-2"
              >
                <Link
                  href={`/?project=${t.project_id}&task=${t.id}`}
                  className="flex-1"
                >
                  <div className="text-sm text-fg hover:underline">{t.title}</div>
                  <div className="text-xs text-fg-subtle">
                    {t.status_key} · archived{" "}
                    {t.archived_at && new Date(t.archived_at).toLocaleString()}
                  </div>
                </Link>
                <button
                  onClick={() => unarchive(t.id)}
                  className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-bg-card"
                >
                  Unarchive
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
