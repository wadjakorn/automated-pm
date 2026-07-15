"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Project, Task } from "@/lib/types";
import { api, ApiClientError } from "@/lib/client";
import { useProjects } from "./useApp";
import { AppShell } from "./AppShell";
import { ListSkeleton } from "./ui";
import { toast } from "./Toast";

// Archived tickets: filed off the board but still live (openable by link,
// searchable in future). Mirrors Trash, but Unarchive instead of Restore.
export function Archive() {
  const { projects, selectedId, select, reload, loaded } = useProjects();
  const [archived, setArchived] = useState<Task[]>([]);
  const [archivedProjects, setArchivedProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (pid: string) => {
    setLoading(true);
    try {
      const all = await api.listArchivedTasks(pid);
      setArchived(all.filter((t) => t.archived_at && !t.deleted_at));
    } finally {
      setLoading(false);
    }
  }, []);

  // Archived projects are global (not scoped to the selected project).
  const loadProjects = useCallback(async () => {
    try {
      const all = await api.listProjects({ includeArchived: true });
      setArchivedProjects(all.filter((p) => p.archived_at && !p.deleted_at));
    } catch {
      setArchivedProjects([]);
    }
  }, []);

  useEffect(() => {
    if (selectedId) load(selectedId).catch(() => {});
  }, [selectedId, load]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  async function unarchive(id: string) {
    try {
      await api.unarchiveTask(id);
      toast("Unarchived", "success");
      if (selectedId) load(selectedId);
    } catch (e) {
      toast((e as ApiClientError).message ?? "Failed", "error");
    }
  }

  async function unarchiveProject(id: string) {
    try {
      await api.unarchiveProject(id);
      toast("Project unarchived", "success");
      loadProjects();
      reload();
    } catch (e) {
      toast((e as ApiClientError).message ?? "Failed", "error");
    }
  }

  return (
    <AppShell
      projects={projects}
      selectedId={selectedId}
      select={select}
      reload={reload}
    >
      <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
        <h2 className="mb-4 text-lg font-semibold text-fg">Archive</h2>

        {archivedProjects.length > 0 && (
          <div className="mb-6">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
              Archived projects
            </h3>
            <div className="space-y-2">
              {archivedProjects.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded border border-border bg-bg-soft px-3 py-2"
                >
                  <Link href={`/?project=${p.id}`} className="flex-1">
                    <div className="text-sm text-fg hover:underline">{p.name}</div>
                    <div className="text-xs text-fg-subtle">
                      archived{" "}
                      {p.archived_at && new Date(p.archived_at).toLocaleString()}
                    </div>
                  </Link>
                  <button
                    onClick={() => unarchiveProject(p.id)}
                    className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-bg-card"
                  >
                    Unarchive
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
          Archived tickets
        </h3>
        {!selectedId ? (
          loaded ? (
            <div className="text-fg-subtle">Create a project first.</div>
          ) : (
            <ListSkeleton />
          )
        ) : loading ? (
          <ListSkeleton />
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
    </AppShell>
  );
}
