import { nanoid } from "nanoid";
import { getDb } from "./db";
import { buildDefaultStateMachine, canTransition } from "./statemachine";
import { badRequest, conflict, illegalTransition, notFound, unauthorized } from "./api-errors";
import { hashPassword, newApiToken, verifyPassword } from "./auth";
import { DEFAULT_PRIORITY, isPriority, type Priority } from "./priority";
import { isRemoteRepoUrl, normalizeRemoteRepoUrl } from "./repo-url";
import {
  edgeFromOption,
  linkLabel,
  parseTicketRef,
  type LinkOption,
} from "./ticket-link";
import type {
  Project,
  Status,
  Task,
  StateMachine,
  User,
  PublicUser,
  LinkedTicket,
} from "./types";

// Validate an optional priority input; returns the canonical value or throws.
function normPriority(p: unknown, fallback: Priority): Priority {
  if (p === undefined || p === null || p === "") return fallback;
  if (!isPriority(p)) throw badRequest(`unknown priority "${p}"`);
  return p;
}

// SQL fragment ordering a column top→bottom: now → high → medium → low.
const PRIORITY_ORDER_SQL =
  "CASE t.priority WHEN 'now' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END";

const now = () => new Date().toISOString();
const id = () => nanoid(12);

// ---- row mappers (SQLite stores booleans as 0/1) ----
function mapStatus(r: any): Status {
  return { ...r, is_final: !!r.is_final };
}

const publicUser = (u: User): PublicUser => ({
  id: u.id,
  username: u.username,
  created_at: u.created_at,
});

// ---------------- Users ----------------

export function createUser(username: string, password: string): User {
  const uname = username?.trim();
  if (!uname) throw badRequest("username is required");
  if (!password) throw badRequest("password is required");
  const db = getDb();
  const dup = db.prepare("SELECT 1 FROM users WHERE username = ?").get(uname);
  if (dup) throw badRequest(`username "${uname}" already exists`);
  const uid = id();
  const ts = now();
  db.prepare(
    "INSERT INTO users (id, username, password_hash, api_token, created_at, updated_at) VALUES (?,?,?,?,?,?)"
  ).run(uid, uname, hashPassword(password), newApiToken(), ts, ts);
  return getUser(uid);
}

// Resolve a user by id OR username (id first, mirrors getProject).
export function getUser(ref: string): User {
  const db = getDb();
  const byId = db.prepare("SELECT * FROM users WHERE id = ?").get(ref) as User | undefined;
  if (byId) return byId;
  const byName = db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(ref) as User | undefined;
  if (!byName) throw notFound("user");
  return byName;
}

export function resolveUserId(ref: string): string {
  return getUser(ref).id;
}

export function verifyLogin(username: string, password: string): User {
  const db = getDb();
  const u = db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(username?.trim() ?? "") as User | undefined;
  if (!u || !verifyPassword(password ?? "", u.password_hash))
    throw unauthorized("invalid username or password");
  return u;
}

export function listUsers(): PublicUser[] {
  return (
    getDb().prepare("SELECT * FROM users ORDER BY username").all() as User[]
  ).map(publicUser);
}

// ---------------- Projects ----------------

export function listProjects(): Project[] {
  return getDb()
    .prepare("SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY created_at")
    .all() as Project[];
}

// Resolve a project by its id OR its (unique) name. Id is tried first so an
// id can never be shadowed by a name; names are unique among live projects
// (enforced in createProject/updateProject + a partial unique index).
export function getProject(ref: string): Project {
  const db = getDb();
  const byId = db
    .prepare("SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL")
    .get(ref) as Project | undefined;
  if (byId) return byId;
  const byName = db
    .prepare("SELECT * FROM projects WHERE name = ? AND deleted_at IS NULL")
    .get(ref) as Project | undefined;
  if (!byName) throw notFound("project");
  return byName;
}

// Resolve any project ref (id or name) to its canonical id.
export function resolveProjectId(ref: string): string {
  return getProject(ref).id;
}

export function createProject(name: string, description?: string): Project {
  if (!name?.trim()) throw badRequest("name is required");
  const db = getDb();
  const trimmed = name.trim();
  const dup = db
    .prepare("SELECT 1 FROM projects WHERE name = ? AND deleted_at IS NULL")
    .get(trimmed);
  if (dup) throw badRequest(`project name "${trimmed}" already exists`);
  const pid = id();
  const ts = now();
  const sm = buildDefaultStateMachine(pid);

  const tx = db.transaction(() => {
    db.prepare(
      "INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?,?,?,?,?)"
    ).run(pid, trimmed, description ?? null, ts, ts);

    const insStatus = db.prepare(
      "INSERT INTO statuses (id, project_id, key, label, sort_order, is_final) VALUES (?,?,?,?,?,?)"
    );
    for (const s of sm.statuses)
      insStatus.run(s.id, s.project_id, s.key, s.label, s.sort_order, s.is_final ? 1 : 0);

    const insTr = db.prepare(
      "INSERT INTO transitions (id, project_id, from_key, to_key) VALUES (?,?,?,?)"
    );
    for (const t of sm.transitions)
      insTr.run(t.id, t.project_id, t.from_key, t.to_key);
  });
  tx();
  return getProject(pid);
}

export function updateProject(
  projectId: string,
  patch: {
    name?: string;
    description?: string | null;
    remote_repo_url?: string | null;
    // Guard: changing name or remote_repo_url is a sensitive edit (the name is
    // an identifier; the URL is what agents act on). Require an explicit
    // confirm so neither a human nor an agent changes them by accident.
    confirm?: boolean;
  }
): Project {
  const p = getProject(projectId);
  const name = patch.name?.trim() ?? p.name;
  const description =
    patch.description === undefined ? p.description : patch.description;
  const remoteRepoUrl =
    patch.remote_repo_url === undefined
      ? p.remote_repo_url
      : normalizeRemoteRepoUrl(patch.remote_repo_url);

  const nameChanged = name !== p.name;
  const urlChanged = remoteRepoUrl !== p.remote_repo_url;
  if ((nameChanged || urlChanged) && patch.confirm !== true) {
    throw badRequest(
      "changing a project name or remote repository URL is a sensitive edit; pass confirm:true (CLI: --confirm)"
    );
  }
  if (!name) throw badRequest("name is required");
  if (nameChanged) {
    const dup = getDb()
      .prepare("SELECT 1 FROM projects WHERE name = ? AND id != ? AND deleted_at IS NULL")
      .get(name, p.id);
    if (dup) throw badRequest(`project name "${name}" already exists`);
  }
  if (remoteRepoUrl !== null && !isRemoteRepoUrl(remoteRepoUrl)) {
    throw badRequest(`invalid remote repository URL "${remoteRepoUrl}"`);
  }
  getDb()
    .prepare(
      "UPDATE projects SET name=?, description=?, remote_repo_url=?, updated_at=? WHERE id=?"
    )
    .run(name, description, remoteRepoUrl, now(), p.id);
  return getProject(p.id);
}

export function softDeleteProject(projectId: string): { ok: true } {
  projectId = getProject(projectId).id;
  getDb()
    .prepare("UPDATE projects SET deleted_at=?, updated_at=? WHERE id=?")
    .run(now(), now(), projectId);
  return { ok: true };
}

// ---------------- State machine ----------------

export function getStateMachine(projectId: string): StateMachine {
  projectId = getProject(projectId).id;
  const db = getDb();
  const statuses = (
    db
      .prepare("SELECT * FROM statuses WHERE project_id=? ORDER BY sort_order")
      .all(projectId) as any[]
  ).map(mapStatus);
  const transitions = db
    .prepare("SELECT * FROM transitions WHERE project_id=? ORDER BY from_key, to_key")
    .all(projectId) as StateMachine["transitions"];
  return { statuses, transitions };
}

export function addStatus(
  projectId: string,
  data: { key: string; label: string; is_final?: boolean }
): StateMachine {
  projectId = getProject(projectId).id;
  const key = data.key?.trim();
  if (!key) throw badRequest("status key is required");
  const db = getDb();
  const existing = db
    .prepare("SELECT 1 FROM statuses WHERE project_id=? AND key=?")
    .get(projectId, key);
  if (existing) throw badRequest(`status "${key}" already exists`);
  const max =
    (db
      .prepare("SELECT MAX(sort_order) m FROM statuses WHERE project_id=?")
      .get(projectId) as any).m ?? -1;
  db.prepare(
    "INSERT INTO statuses (id, project_id, key, label, sort_order, is_final) VALUES (?,?,?,?,?,?)"
  ).run(id(), projectId, key, data.label?.trim() || key, max + 1, data.is_final ? 1 : 0);
  return getStateMachine(projectId);
}

export function updateStatus(
  projectId: string,
  key: string,
  patch: { label?: string; is_final?: boolean; sort_order?: number }
): StateMachine {
  projectId = getProject(projectId).id;
  const sm = getStateMachine(projectId);
  const s = sm.statuses.find((x) => x.key === key);
  if (!s) throw notFound("status");
  const db = getDb();
  db.prepare(
    "UPDATE statuses SET label=?, is_final=?, sort_order=? WHERE project_id=? AND key=?"
  ).run(
    patch.label?.trim() ?? s.label,
    (patch.is_final ?? s.is_final) ? 1 : 0,
    patch.sort_order ?? s.sort_order,
    projectId,
    key
  );
  return getStateMachine(projectId);
}

export function removeStatus(projectId: string, key: string): StateMachine {
  projectId = getProject(projectId).id;
  const db = getDb();
  // Guard: cannot remove a status that live tasks still use.
  const inUse = db
    .prepare(
      "SELECT 1 FROM tasks WHERE project_id=? AND status_key=? AND deleted_at IS NULL LIMIT 1"
    )
    .get(projectId, key);
  if (inUse)
    throw badRequest(`cannot remove "${key}": tasks still use it`);
  db.prepare("DELETE FROM statuses WHERE project_id=? AND key=?").run(projectId, key);
  db.prepare(
    "DELETE FROM transitions WHERE project_id=? AND (from_key=? OR to_key=?)"
  ).run(projectId, key, key);
  return getStateMachine(projectId);
}

export function addTransition(
  projectId: string,
  fromKey: string,
  toKey: string
): StateMachine {
  projectId = getProject(projectId).id;
  const sm = getStateMachine(projectId);
  const has = (k: string) => sm.statuses.some((s) => s.key === k);
  if (!has(fromKey) || !has(toKey))
    throw badRequest("from/to must be existing statuses");
  const db = getDb();
  const dup = db
    .prepare("SELECT 1 FROM transitions WHERE project_id=? AND from_key=? AND to_key=?")
    .get(projectId, fromKey, toKey);
  if (!dup)
    db.prepare(
      "INSERT INTO transitions (id, project_id, from_key, to_key) VALUES (?,?,?,?)"
    ).run(id(), projectId, fromKey, toKey);
  return getStateMachine(projectId);
}

export function removeTransition(
  projectId: string,
  fromKey: string,
  toKey: string
): StateMachine {
  projectId = getProject(projectId).id;
  getDb()
    .prepare("DELETE FROM transitions WHERE project_id=? AND from_key=? AND to_key=?")
    .run(projectId, fromKey, toKey);
  return getStateMachine(projectId);
}

// ---------------- Tasks ----------------

// Tasks always carry joined creator/assignee usernames for display. WHERE
// clauses must qualify columns with `t.` since users also has `id`.
const TASK_SELECT = `
  SELECT t.*, cu.username AS creator_username, au.username AS assignee_username
  FROM tasks t
  LEFT JOIN users cu ON cu.id = t.creator_id
  LEFT JOIN users au ON au.id = t.assignee_id`;

function nextRank(projectId: string, statusKey: string): number {
  const max = (getDb()
    .prepare(
      "SELECT MAX(rank) m FROM tasks WHERE project_id=? AND status_key=? AND deleted_at IS NULL"
    )
    .get(projectId, statusKey) as any).m;
  return (max ?? 0) + 1024;
}

export function listTasks(
  projectId: string,
  opts: {
    status?: string;
    includeDeleted?: boolean;
    includeArchived?: boolean;
    assignee?: string;
    priority?: string;
  } = {}
): Task[] {
  projectId = getProject(projectId).id;
  const clauses = ["t.project_id = ?"];
  const params: unknown[] = [projectId];
  if (!opts.includeDeleted) clauses.push("t.deleted_at IS NULL");
  // Archived tickets are live but off the board — excluded unless asked for.
  if (!opts.includeArchived) clauses.push("t.archived_at IS NULL");
  if (opts.status) {
    clauses.push("t.status_key = ?");
    params.push(opts.status);
  }
  if (opts.assignee) {
    clauses.push("t.assignee_id = ?");
    params.push(resolveUserId(opts.assignee));
  }
  if (opts.priority) {
    clauses.push("t.priority = ?");
    params.push(normPriority(opts.priority, DEFAULT_PRIORITY));
  }
  // Within a status column tasks sort by priority (now→low), then rank.
  return getDb()
    .prepare(
      `${TASK_SELECT} WHERE ${clauses.join(" AND ")} ORDER BY t.status_key, ${PRIORITY_ORDER_SQL}, t.rank`
    )
    .all(...params) as Task[];
}

export function getTask(taskId: string, includeDeleted = false): Task {
  const t = getDb()
    .prepare(
      `${TASK_SELECT} WHERE t.id=? ${includeDeleted ? "" : "AND t.deleted_at IS NULL"}`
    )
    .get(taskId) as Task | undefined;
  if (!t) throw notFound("task");
  return t;
}

export function createTask(
  projectId: string,
  data: {
    title: string;
    description?: string;
    status?: string;
    // creatorId from the authenticated caller (null = anonymous, backward
    // compat). assignee is an id or username, validated if present.
    creatorId?: string | null;
    assignee?: string | null;
    priority?: string;
  }
): Task {
  projectId = getProject(projectId).id;
  if (!data.title?.trim()) throw badRequest("title is required");
  const sm = getStateMachine(projectId);
  const statusKey = data.status ?? sm.statuses[0]?.key;
  if (!sm.statuses.some((s) => s.key === statusKey))
    throw badRequest(`unknown status "${statusKey}"`);
  const assigneeId =
    data.assignee == null || data.assignee === "" ? null : resolveUserId(data.assignee);
  const priority = normPriority(data.priority, DEFAULT_PRIORITY);
  const tid = id();
  const ts = now();
  getDb()
    .prepare(
      "INSERT INTO tasks (id, project_id, title, description, status_key, priority, rank, version, created_at, updated_at, creator_id, assignee_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
    )
    .run(
      tid,
      projectId,
      data.title.trim(),
      data.description ?? null,
      statusKey,
      priority,
      nextRank(projectId, statusKey),
      1,
      ts,
      ts,
      data.creatorId ?? null,
      assigneeId
    );
  return getTask(tid);
}

// Check optimistic version when caller supplied one.
function assertVersion(task: Task, version?: number) {
  if (version !== undefined && version !== task.version) throw conflict(task);
}

export function updateTask(
  taskId: string,
  patch: {
    title?: string;
    description?: string | null;
    version?: number;
    // assignee: undefined = leave as-is; null = unassign; string = id|username.
    assignee?: string | null;
    // priority: undefined = leave as-is; otherwise validated against the scale.
    priority?: string;
  }
): Task {
  const t = getTask(taskId);
  assertVersion(t, patch.version);
  const title = patch.title?.trim() ?? t.title;
  if (!title) throw badRequest("title cannot be empty");
  const description =
    patch.description === undefined ? t.description : patch.description;
  const assigneeId =
    patch.assignee === undefined
      ? t.assignee_id
      : patch.assignee === null || patch.assignee === ""
        ? null
        : resolveUserId(patch.assignee);
  const priority =
    patch.priority === undefined ? t.priority : normPriority(patch.priority, t.priority);
  getDb()
    .prepare(
      "UPDATE tasks SET title=?, description=?, assignee_id=?, priority=?, version=version+1, updated_at=? WHERE id=?"
    )
    .run(title, description, assigneeId, priority, now(), taskId);
  return getTask(taskId);
}

export function moveTask(
  taskId: string,
  toStatus: string,
  opts: { version?: number; rank?: number } = {}
): Task {
  const t = getTask(taskId);
  assertVersion(t, opts.version);
  const sm = getStateMachine(t.project_id);
  const check = canTransition(sm, t.status_key, toStatus);
  if (!check.ok) throw illegalTransition(check.reason ?? "illegal transition");
  const rank = opts.rank ?? nextRank(t.project_id, toStatus);
  getDb()
    .prepare(
      "UPDATE tasks SET status_key=?, rank=?, version=version+1, updated_at=? WHERE id=?"
    )
    .run(toStatus, rank, now(), taskId);
  return getTask(taskId);
}

export function softDeleteTask(taskId: string): { ok: true } {
  getTask(taskId);
  getDb()
    .prepare("UPDATE tasks SET deleted_at=?, version=version+1, updated_at=? WHERE id=?")
    .run(now(), now(), taskId);
  return { ok: true };
}

export function restoreTask(taskId: string): Task {
  const t = getTask(taskId, true);
  if (!t.deleted_at) return t;
  getDb()
    .prepare("UPDATE tasks SET deleted_at=NULL, version=version+1, updated_at=? WHERE id=?")
    .run(now(), taskId);
  return getTask(taskId);
}

// ---------------- Archive ----------------
// Archiving files a finished ticket off the board while keeping it live. Only
// tickets in a *final* status may be archived (the feature is for done work);
// archiving is independent of soft delete. getTask includes archived rows, so
// direct links keep working.

function isFinalStatus(projectId: string, statusKey: string): boolean {
  return getStateMachine(projectId).statuses.some(
    (s) => s.key === statusKey && s.is_final
  );
}

export function archiveTask(taskId: string, opts: { version?: number } = {}): Task {
  const t = getTask(taskId);
  assertVersion(t, opts.version);
  if (t.archived_at) return t; // idempotent
  if (!isFinalStatus(t.project_id, t.status_key))
    throw badRequest("only tickets in a final status can be archived");
  getDb()
    .prepare("UPDATE tasks SET archived_at=?, version=version+1, updated_at=? WHERE id=?")
    .run(now(), now(), taskId);
  return getTask(taskId);
}

export function unarchiveTask(taskId: string): Task {
  const t = getTask(taskId);
  if (!t.archived_at) return t;
  getDb()
    .prepare("UPDATE tasks SET archived_at=NULL, version=version+1, updated_at=? WHERE id=?")
    .run(now(), taskId);
  return getTask(taskId);
}

// Bulk-archive every live, un-archived ticket in a final-status column.
// Returns the archived tickets. Throws if the status isn't final.
export function bulkArchiveColumn(
  projectId: string,
  statusKey: string
): { archived: Task[] } {
  projectId = getProject(projectId).id;
  if (!isFinalStatus(projectId, statusKey))
    throw badRequest(`status "${statusKey}" is not a final status`);
  const db = getDb();
  const ts = now();
  const rows = db
    .prepare(
      "SELECT id FROM tasks WHERE project_id=? AND status_key=? AND deleted_at IS NULL AND archived_at IS NULL"
    )
    .all(projectId, statusKey) as { id: string }[];
  const tx = db.transaction(() => {
    const upd = db.prepare(
      "UPDATE tasks SET archived_at=?, version=version+1, updated_at=? WHERE id=?"
    );
    for (const r of rows) upd.run(ts, ts, r.id);
  });
  tx();
  return { archived: rows.map((r) => getTask(r.id)) };
}

// ---------------- Task links ----------------

// Map a stored edge row to the shape a *viewer* ticket sees: the label flips
// depending on whether the viewer is the edge's source. The other ticket is
// fetched with includeDeleted so a link to a trashed task still renders.
function toLinkedTicket(row: any, viewerId: string): LinkedTicket {
  const isSource = row.source_id === viewerId;
  const otherId = isSource ? row.target_id : row.source_id;
  const other = getTask(otherId, true);
  return {
    link_id: row.id,
    verb: row.type,
    is_source: isSource,
    label: linkLabel(row.type, isSource),
    task: {
      id: other.id,
      title: other.title,
      status_key: other.status_key,
      project_id: other.project_id,
      deleted_at: other.deleted_at,
    },
  };
}

export function createLink(
  thisId: string,
  targetRef: string,
  option: LinkOption
): LinkedTicket {
  getTask(thisId); // 404 if the source ticket is gone
  const otherId = parseTicketRef(targetRef ?? "");
  if (!otherId) throw badRequest("could not read a ticket id from that link");
  if (otherId === thisId) throw badRequest("a ticket cannot link to itself");
  getTask(otherId); // target must be a live task (not_found if missing/deleted)
  const edge = edgeFromOption(thisId, otherId, option);
  const lid = id();
  try {
    getDb()
      .prepare(
        "INSERT INTO task_links (id, source_id, target_id, type, created_at) VALUES (?,?,?,?,?)"
      )
      .run(lid, edge.sourceId, edge.targetId, edge.verb, now());
  } catch (e: any) {
    if (String(e?.message ?? "").includes("UNIQUE"))
      throw badRequest("that link already exists");
    throw e;
  }
  const row = getDb().prepare("SELECT * FROM task_links WHERE id=?").get(lid);
  return toLinkedTicket(row, thisId);
}

export function listLinksFor(taskId: string): LinkedTicket[] {
  getTask(taskId);
  const rows = getDb()
    .prepare(
      "SELECT * FROM task_links WHERE source_id=? OR target_id=? ORDER BY created_at"
    )
    .all(taskId, taskId) as any[];
  return rows.map((r) => toLinkedTicket(r, taskId));
}

export function removeLink(linkId: string): { ok: true } {
  const r = getDb().prepare("DELETE FROM task_links WHERE id=?").run(linkId);
  if (r.changes === 0) throw notFound("link");
  return { ok: true };
}
