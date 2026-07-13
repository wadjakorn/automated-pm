"use client";

import { useCallback, useEffect, useState } from "react";
import type { Task } from "@/lib/types";
import { api, ApiClientError } from "@/lib/client";
import { useProjects } from "./useApp";
import { AppShell } from "./AppShell";
import { ListSkeleton } from "./ui";
import { toast } from "./Toast";

export function Trash() {
  const { projects, selectedId, select, reload, loaded } = useProjects();
  const [deleted, setDeleted] = useState<Task[]>([]);
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

  useEffect(() => {
    if (selectedId) load(selectedId).catch(() => {});
  }, [selectedId, load]);

  async function restore(id: string) {
    try {
      await api.restoreTask(id);
      toast("Restored", "success");
      if (selectedId) load(selectedId);
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
