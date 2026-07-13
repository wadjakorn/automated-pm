"use client";

import { useCallback, useEffect, useState } from "react";
import type { Project, StateMachine } from "@/lib/types";
import { api, ApiClientError } from "@/lib/client";
import { useProjects } from "./useApp";
import { AppShell } from "./AppShell";
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
      <AppShell {...{ projects, selectedId, select, reload }}>
        <div className="p-6 text-fg-subtle">
          {loaded ? "Create a project first." : "Loading…"}
        </div>
      </AppShell>
    );

  const statuses = sm?.statuses ?? [];
  const hasEdge = (from: string, to: string) =>
    sm?.transitions.some((t) => t.from_key === from && t.to_key === to) ?? false;

  return (
    <AppShell {...{ projects, selectedId, select, reload }}>
      <div className="mx-auto max-w-4xl space-y-8 p-6">
        {/* Project metadata */}
        {project && (
          <ProjectSection
            key={project.id}
            project={project}
            statuses={statuses}
            onSaved={reload}
          />
        )}

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
                <label className="flex items-center gap-1 text-xs text-fg-muted">
                  <input
                    type="checkbox"
                    checked={s.hidden}
                    onChange={(e) =>
                      run(() =>
                        api.updateStatus(selectedId, s.key, {
                          hidden: e.target.checked,
                        })
                      )
                    }
                  />
                  hidden
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
                    className="rounded px-1.5 text-danger hover:opacity-80"
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
    </AppShell>
  );
}

// Editable project name + remote repo URL. Read-only until "Edit" is pressed
// (guard against accidental edits); renaming pops a confirm dialog because the
// name is used as an identifier (CLI --project, deep links). The server also
// requires confirm:true for name/URL changes, so the Save below sends it.
function ProjectSection({
  project,
  statuses,
  onSaved,
}: {
  project: Project;
  statuses: StateMachine["statuses"];
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [url, setUrl] = useState(project.remote_repo_url ?? "");
  const [prefix, setPrefix] = useState(project.ticket_prefix ?? "");
  const [saving, setSaving] = useState(false);

  // Default status for new tasks. Applied immediately on change (not behind the
  // name/URL "Edit" confirm gate — it is not a sensitive/identity field).
  async function setDefaultStatus(key: string) {
    try {
      await api.updateProject(project.id, { default_status_key: key || null });
      onSaved();
      toast("Default status updated", "success");
    } catch (e) {
      toast((e as ApiClientError).message ?? "Failed", "error");
    }
  }

  // Ticket prefix for human ids (PREFIX-NNNN). Applied on Save (free text, so
  // not on every keystroke). Not behind the name/URL confirm gate — changing
  // it only relabels display ids, it never renumbers existing tickets.
  async function saveTicketPrefix() {
    const next = prefix.trim();
    if (next === (project.ticket_prefix ?? "")) return;
    try {
      await api.updateProject(project.id, { ticket_prefix: next });
      onSaved();
      toast("Ticket prefix updated", "success");
    } catch (e) {
      toast((e as ApiClientError).message ?? "Failed", "error");
    }
  }

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
        <div className="theme-panel space-y-3 border border-border bg-bg-soft p-4">
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
        <div className="theme-panel space-y-2 border border-border bg-bg-soft px-4 py-3 text-sm">
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
          <div className="flex items-center gap-3">
            <span className="w-40 text-fg-subtle">Default status</span>
            <select
              value={project.default_status_key ?? ""}
              onChange={(e) => setDefaultStatus(e.target.value)}
              className="rounded border border-border bg-bg-card px-2 py-1 text-sm outline-none"
            >
              <option value="">First status</option>
              {statuses.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-40 text-fg-subtle">Ticket prefix</span>
            <input
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              onBlur={saveTicketPrefix}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              placeholder="PM"
              aria-label="Ticket prefix"
              className="w-24 rounded border border-border bg-bg-card px-2 py-1 text-sm outline-none"
            />
            <span className="text-xs text-fg-subtle">
              Human ticket ids look like {(prefix.trim() || "PM")}-0001. 2–100 chars, no spaces.
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
