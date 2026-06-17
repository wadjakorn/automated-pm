// Browser-side typed fetch helpers. Throw an ApiClientError carrying the
// parsed JSON body so callers can branch on .code (e.g. conflict, illegal).
import type { Project, Task, StateMachine } from "./types";

export class ApiClientError extends Error {
  status: number;
  code: string;
  body: any;
  constructor(status: number, body: any) {
    super(body?.message ?? `HTTP ${status}`);
    this.status = status;
    this.code = body?.error ?? "http_error";
    this.body = body;
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiClientError(res.status, json);
  return json as T;
}

export const api = {
  // projects
  listProjects: () => req<Project[]>("GET", "/api/projects"),
  createProject: (name: string, description?: string) =>
    req<Project>("POST", "/api/projects", { name, description }),
  deleteProject: (id: string) => req<{ ok: true }>("DELETE", `/api/projects/${id}`),

  // state machine
  getStateMachine: (projectId: string) =>
    req<StateMachine>("GET", `/api/projects/${projectId}/statuses`),
  addStatus: (projectId: string, key: string, label: string, is_final: boolean) =>
    req<StateMachine>("POST", `/api/projects/${projectId}/statuses`, {
      key,
      label,
      is_final,
    }),
  updateStatus: (
    projectId: string,
    key: string,
    patch: { label?: string; is_final?: boolean; sort_order?: number }
  ) =>
    req<StateMachine>("PATCH", `/api/projects/${projectId}/statuses`, {
      key,
      ...patch,
    }),
  removeStatus: (projectId: string, key: string) =>
    req<StateMachine>(
      "DELETE",
      `/api/projects/${projectId}/statuses?key=${encodeURIComponent(key)}`
    ),
  addTransition: (projectId: string, from: string, to: string) =>
    req<StateMachine>("POST", `/api/projects/${projectId}/transitions`, { from, to }),
  removeTransition: (projectId: string, from: string, to: string) =>
    req<StateMachine>(
      "DELETE",
      `/api/projects/${projectId}/transitions?from=${encodeURIComponent(
        from
      )}&to=${encodeURIComponent(to)}`
    ),

  // tasks
  listTasks: (projectId: string, includeDeleted = false) =>
    req<Task[]>(
      "GET",
      `/api/tasks?project=${projectId}${includeDeleted ? "&includeDeleted=true" : ""}`
    ),
  createTask: (projectId: string, title: string, description?: string, status?: string) =>
    req<Task>("POST", "/api/tasks", { project: projectId, title, description, status }),
  moveTask: (id: string, status: string, version: number) =>
    req<Task>("PATCH", `/api/tasks/${id}`, { status, version }),
  updateTask: (
    id: string,
    patch: { title?: string; description?: string | null },
    version: number
  ) => req<Task>("PATCH", `/api/tasks/${id}`, { ...patch, version }),
  deleteTask: (id: string) => req<{ ok: true }>("DELETE", `/api/tasks/${id}`),
  restoreTask: (id: string) => req<Task>("POST", `/api/tasks/${id}/restore`),
};
