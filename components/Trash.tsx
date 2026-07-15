"use client";

import { useCallback, useEffect, useState } from "react";
import type { Project, Task } from "@/lib/types";
import { api, ApiClientError } from "@/lib/client";
import { useProjects } from "./useApp";
import { AppShell } from "./AppShell";
import { ListSkeleton } from "./ui";
import { toast } from "./Toast";

export function Trash() {
  const { projects, selectedId, select, reload, loaded } = useProjects();
  const [deleted, setDeleted] = useState<Task[]>([]);
  const [deletedProjects, setDeletedProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (pid: string) => {
    setLoading(true);
    try {
      const all = await api.listTasks(pid, true);
      setDeleted(all.filter((t) => t.deleted_at));
    } finally {
      setLoading(false);
    }
  }, []);

  // Trashed projects are global (not scoped to the selected project).
  const loadProjects = useCallback(async () => {
    try {
      const all = await api.listProjects({ includeDeleted: true });
      setDeletedProjects(all.filter((p) => p.deleted_at));
    } catch {
      setDeletedProjects([]);
    }
  }, []);

  useEffect(() => {
    if (selectedId) load(selectedId).catch(() => {});
  }, [selectedId, load]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  async function restore(id: string) {
    try {
      await api.restoreTask(id);
      toast("Restored", "success");
      if (selectedId) load(selectedId);
    } catch (e) {
      toast((e as ApiClientError).message ?? "Failed", "error");
    }
  }

  async function restoreProject(id: string) {
    try {
      await api.restoreProject(id);
      toast("Project restored", "success");
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
        <h2 className="mb-4 text-lg font-semibold text-fg">Trash</h2>

        {deletedProjects.length > 0 && (
          <div className="mb-6">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
              Deleted projects
            </h3>
            <div className="space-y-2">
              {deletedProjects.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded border border-border bg-bg-soft px-3 py-2"
                >
                  <div className="flex-1">
                    <div className="text-sm text-fg">{p.name}</div>
                    <div className="text-xs text-fg-subtle">
                      deleted{" "}
                      {p.deleted_at && new Date(p.deleted_at).toLocaleString()}
                    </div>
                  </div>
                  <button
                    onClick={() => restoreProject(p.id)}
                    className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-bg-card"
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
          Deleted tasks
        </h3>
        {!selectedId ? (
          loaded ? (
            <div className="text-fg-subtle">Create a project first.</div>
          ) : (
            <ListSkeleton />
          )
        ) : loading ? (
          <ListSkeleton />
        ) : deleted.length === 0 ? (
          <div className="text-fg-subtle">No deleted tasks.</div>
        ) : (
          <div className="space-y-2">
            {deleted.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-3 rounded border border-border bg-bg-soft px-3 py-2"
              >
                <div className="flex-1">
                  <div className="text-sm text-fg">{t.title}</div>
                  <div className="text-xs text-fg-subtle">
                    was {t.status_key} · deleted{" "}
                    {t.deleted_at && new Date(t.deleted_at).toLocaleString()}
                  </div>
                </div>
                <button
                  onClick={() => restore(t.id)}
                  className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-bg-card"
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
