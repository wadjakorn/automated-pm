"use client";

import { useCallback, useEffect, useState } from "react";
import type { Project, StateMachine } from "@/lib/types";
import { api, ApiClientError } from "@/lib/client";
import { useProjects } from "./useApp";
import { Nav } from "./Nav";
import { toast } from "./Toast";

export function Settings() {
  const { projects, selectedId, select, reload, loaded } = useProjects();
  const [sm, setSm] = useState<StateMachine | null>(null);
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");

  const project = projects.find((p) => p.id === selectedId) ?? null;

  const load = useCallback(async (pid: string) => {
    setSm(await api.getStateMachine(pid));
  }, []);

  useEffect(() => {
    if (selectedId) load(selectedId).catch(() => {});
  }, [selectedId, load]);

  async function run(fn: () => Promise<StateMachine>) {
    try {
      setSm(await fn());
    } catch (e) {
      toast((e as ApiClientError).message ?? "Failed", "error");
    }
  }

  if (!selectedId)
    return (
      <Shell {...{ projects, selectedId, select, reload }}>
        <div className="p-6 text-fg-subtle">
          {loaded ? "Create a project first." : "Loading…"}
        </div>
      </Shell>
    );

  const statuses = sm?.statuses ?? [];
  const hasEdge = (from: string, to: string) =>
    sm?.transitions.some((t) => t.from_key === from && t.to_key === to) ?? false;

  return (
    <Shell {...{ projects, selectedId, select, reload }}>
      <div className="mx-auto max-w-4xl space-y-8 p-6">
        {/* Project metadata */}
        {project && <ProjectSection project={project} onSaved={reload} />}

        {/* Statuses */}
        <section>
          <h2 className="mb-3 text-lg font-semibold text-fg">Statuses</h2>
          <div className="space-y-2">
            {statuses.map((s, i) => (
              <div
                key={s.key}
                className="flex items-center gap-3 rounded border border-border bg-bg-soft px-3 py-2"
              >
                <span className="w-32 text-xs text-fg-subtle">{s.key}</span>
                <input
                  value={s.label}
                  onChange={(e) =>
                    setSm((cur) =>
                      cur
                        ? {
                            ...cur,
                            statuses: cur.statuses.map((x) =>
                              x.key === s.key ? { ...x, label: e.target.value } : x
                            ),
                          }
                        : cur
                    )
                  }
                  onBlur={(e) =>
                    run(() =>
                      api.updateStatus(selectedId, s.key, { label: e.target.value })
                    )
                  }
                  className="flex-1 rounded border border-border bg-bg-card px-2 py-1 text-sm outline-none"
                />
                <label className="flex items-center gap-1 text-xs text-fg-muted">
                  <input
                    type="checkbox"
                    checked={s.is_final}
                    onChange={(e) =>
                      run(() =>
                        api.updateStatus(selectedId, s.key, {
                          is_final: e.target.checked,
                        })
                      )
                    }
                  />
                  final
                </label>
                <div className="flex gap-1">
                  <button
                    disabled={i === 0}
                    onClick={() =>
                      run(async () => {
                        const prev = statuses[i - 1];
                        await api.updateStatus(selectedId, s.key, {
                          sort_order: prev.sort_order,
                        });
                        return api.updateStatus(selectedId, prev.key, {
                          sort_order: s.sort_order,
                        });
                      })
                    }
                    className="rounded px-1.5 text-fg-muted hover:text-fg disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    disabled={i === statuses.length - 1}
                    onClick={() =>
                      run(async () => {
                        const next = statuses[i + 1];
                        await api.updateStatus(selectedId, s.key, {
                          sort_order: next.sort_order,
                        });
                        return api.updateStatus(selectedId, next.key, {
                          sort_order: s.sort_order,
                        });
                      })
                    }
                    className="rounded px-1.5 text-fg-muted hover:text-fg disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() =>
                      run(() => api.removeStatus(selectedId, s.key))
                    }
                    className="rounded px-1.5 text-red-400 hover:text-red-300"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <input
              value={newKey}
              onChange={(e) => setNewKey(e.target.value.replace(/\s+/g, "_"))}
              placeholder="key (e.g. qa)"
              className="w-40 rounded border border-border bg-bg-card px-2 py-1.5 text-sm outline-none"
            />
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Label (e.g. QA)"
              className="w-48 rounded border border-border bg-bg-card px-2 py-1.5 text-sm outline-none"
            />
            <button
              onClick={() =>
                run(async () => {
                  const r = await api.addStatus(
                    selectedId,
                    newKey,
                    newLabel || newKey,
                    false
                  );
                  setNewKey("");
                  setNewLabel("");
                  return r;
                })
              }
              className="rounded bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover"
            >
              Add status
            </button>
          </div>
        </section>

        {/* Transition matrix */}
        <section>
          <h2 className="mb-1 text-lg font-semibold text-fg">
            Allowed transitions
          </h2>
          <p className="mb-3 text-xs text-fg-subtle">
            Row = from, column = to. Check to allow that move. Final statuses are
            locked at move time regardless.
          </p>
          <div className="overflow-x-auto">
            <table className="text-xs">
              <thead>
                <tr>
                  <th className="p-2 text-left text-fg-subtle">from \ to</th>
                  {statuses.map((c) => (
                    <th key={c.key} className="p-2 text-fg-muted">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {statuses.map((r) => (
                  <tr key={r.key}>
                    <td className="p-2 text-fg-muted">{r.label}</td>
                    {statuses.map((c) => (
                      <td key={c.key} className="p-2 text-center">
                        {r.key === c.key ? (
                          <span className="text-fg-subtle">—</span>
                        ) : (
                          <input
                            type="checkbox"
                            checked={hasEdge(r.key, c.key)}
                            onChange={(e) =>
                              run(() =>
                                e.target.checked
                                  ? api.addTransition(selectedId, r.key, c.key)
                                  : api.removeTransition(selectedId, r.key, c.key)
                              )
                            }
                          />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </Shell>
  );
}

// Editable project name + remote repo URL. Read-only until "Edit" is pressed
// (guard against accidental edits); renaming pops a confirm dialog because the
// name is used as an identifier (CLI --project, deep links). The server also
// requires confirm:true for name/URL changes, so the Save below sends it.
function ProjectSection({
  project,
  onSaved,
}: {
  project: Project;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [url, setUrl] = useState(project.remote_repo_url ?? "");
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setName(project.name);
    setUrl(project.remote_repo_url ?? "");
    setEditing(true);
  }

  async function save() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast("Name is required", "error");
      return;
    }
    if (
      trimmedName !== project.name &&
      !window.confirm(
        `Rename "${project.name}" to "${trimmedName}"? The name identifies the project in the CLI and deep links.`
      )
    )
      return;
    setSaving(true);
    try {
      await api.updateProject(project.id, {
        name: trimmedName,
        remote_repo_url: url.trim() || null,
        confirm: true,
      });
      setEditing(false);
      onSaved();
      toast("Project updated", "success");
    } catch (e) {
      toast((e as ApiClientError).message ?? "Failed", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-fg">Project</h2>
        {!editing && (
          <button
            onClick={startEdit}
            className="rounded border border-border px-3 py-1.5 text-sm text-fg-muted hover:bg-bg-card"
          >
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-3 rounded border border-border bg-bg-soft p-4">
          <label className="block">
            <span className="mb-1 block text-xs text-fg-subtle">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border border-border bg-bg-card px-2 py-1.5 text-sm outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-fg-subtle">
              Remote repository URL
            </span>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="git@github.com:org/repo.git"
              className="w-full rounded border border-border bg-bg-card px-2 py-1.5 text-sm outline-none"
            />
          </label>
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="rounded bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
            >
              Save
            </button>
            <button
              onClick={() => setEditing(false)}
              className="text-sm text-fg-muted hover:text-fg"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2 rounded border border-border bg-bg-soft px-4 py-3 text-sm">
          <div className="flex gap-3">
            <span className="w-40 text-fg-subtle">Name</span>
            <span className="text-fg">{project.name}</span>
          </div>
          <div className="flex gap-3">
            <span className="w-40 text-fg-subtle">Remote repository URL</span>
            <span className="text-fg">
              {project.remote_repo_url ?? (
                <span className="text-fg-subtle">— not set</span>
              )}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

function Shell({
  projects,
  selectedId,
  select,
  reload,
  children,
}: {
  projects: any[];
  selectedId: string | null;
  select: (id: string) => void;
  reload: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen flex-col">
      <Nav
        projects={projects}
        selectedId={selectedId}
        onSelect={select}
        onProjectsChanged={reload}
      />
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
