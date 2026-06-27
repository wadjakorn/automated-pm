// Browser-side typed fetch helpers. Throw an ApiClientError carrying the
// parsed JSON body so callers can branch on .code (e.g. conflict, illegal).
import type { Project, Task, StateMachine, PublicUser, LinkedTicket } from "./types";

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
  // auth (cookie-based; browser uses the session, no token handling here)
  me: () => req<PublicUser | null>("GET", "/api/auth/me"),
  login: (username: string, password: string) =>
    req<{ user: PublicUser }>("POST", "/api/auth/login", { username, password }),
  register: (username: string, password: string) =>
    req<{ user: PublicUser; api_token: string }>("POST", "/api/auth/register", {
      username,
      password,
    }),
  logout: () => req<{ ok: true }>("POST", "/api/auth/logout"),
  listUsers: () => req<PublicUser[]>("GET", "/api/users"),

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
  getTask: (id: string) => req<Task>("GET", `/api/tasks/${id}`),
  createTask: (
    projectId: string,
    title: string,
    description?: string,
    status?: string,
    assignee?: string | null,
    priority?: string
  ) =>
    req<Task>("POST", "/api/tasks", {
      project: projectId,
      title,
      description,
      status,
      assignee,
      priority,
    }),
  moveTask: (id: string, status: string, version: number) =>
    req<Task>("PATCH", `/api/tasks/${id}`, { status, version }),
  updateTask: (
    id: string,
    patch: {
      title?: string;
      description?: string | null;
      assignee?: string | null;
      priority?: string;
    },
    version: number
  ) => req<Task>("PATCH", `/api/tasks/${id}`, { ...patch, version }),
  deleteTask: (id: string) => req<{ ok: true }>("DELETE", `/api/tasks/${id}`),
  restoreTask: (id: string) => req<Task>("POST", `/api/tasks/${id}/restore`),

  // image upload (multipart, separate from the JSON `req` helper above).
  uploadImage: async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/uploads", { method: "POST", body: fd, cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new ApiClientError(res.status, json);
    return json as { id: string; url: string; mime: string; size: number };
  },

  // ticket links
  listLinks: (taskId: string) =>
    req<LinkedTicket[]>("GET", `/api/tasks/${taskId}/links`),
  addLink: (taskId: string, targetRef: string, type: string) =>
    req<LinkedTicket>("POST", `/api/tasks/${taskId}/links`, { targetRef, type }),
  removeLink: (taskId: string, linkId: string) =>
    req<{ ok: true }>("DELETE", `/api/tasks/${taskId}/links/${linkId}`),
};
