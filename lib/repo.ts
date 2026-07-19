import { customAlphabet, nanoid } from "nanoid";
import { getDb } from "./db";
import { buildDefaultStateMachine, canTransition } from "./statemachine";
import { badRequest, conflict, illegalTransition, notFound, unauthorized } from "./api-errors";
import { hashPassword, newApiToken, verifyPassword } from "./auth";
import { DEFAULT_PRIORITY, isPriority, type Priority } from "./priority";
import { isRemoteRepoUrl, normalizeRemoteRepoUrl } from "./repo-url";
// Theme value guards live with the UI theme registry (pure, no React), so the
// server validates pack/accent against the same source of truth as the client.
import { isAccentChoice, isThemePack } from "../components/theme";
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
  ReadyTicket,
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

// Random ticket prefix of N uppercase letters (Jira-like).
const randomLetters = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZ", 26);
const randomPrefix = (len: number) => randomLetters(len);

// Is this prefix free? Prefixes are globally unique, case-insensitively — see
// the UNIQUE index in db.ts. `exceptProjectId` lets a project re-save its own.
function ticketPrefixTaken(prefix: string, exceptProjectId?: string): boolean {
  return !!getDb()
    .prepare(
      "SELECT 1 FROM projects WHERE lower(ticket_prefix) = lower(?) AND id IS NOT ?"
    )
    .get(prefix, exceptProjectId ?? null);
}

// Default prefix for a new project. 2 letters is only 676 values, so collisions
// start biting well before 676 projects (birthday-wise, around 30). Retry a
// bounded number of times, then widen to 3 letters (17,576) and keep going —
// the index would reject a duplicate anyway, better to never generate one.
function genTicketPrefix(): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    const len = attempt < 10 ? 2 : 3;
    const p = randomPrefix(len);
    if (!ticketPrefixTaken(p)) return p;
  }
  // Astronomically unlikely; fail loudly rather than hand back a duplicate.
  throw new Error("could not generate a free ticket prefix");
}

// Validate/normalize a ticket prefix: trimmed, 2–100 chars, letter-led and made
// only of letters/digits/underscores, upper-cased, and not already used by
// another project.
//
// The grammar is not cosmetic: the prefix becomes the leading half of a ticket
// key, and keys are handed around as URL query values and CLI arguments. Any
// character outside this set would either need escaping in a share link or make
// the key unrecognisable to getTask(). Upper-casing keeps stored prefixes in one
// canonical form, so the display key always matches what the resolver accepts.
function normTicketPrefix(v: unknown, exceptProjectId?: string): string {
  if (typeof v !== "string") throw badRequest("ticket prefix must be a string");
  const s = v.trim();
  if (s.length < 2 || s.length > 100)
    throw badRequest("ticket prefix must be 2–100 characters");
  if (/\s/.test(s)) throw badRequest("ticket prefix cannot contain whitespace");
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(s))
    throw badRequest(
      "ticket prefix must start with a letter and contain only letters, digits and underscores"
    );
  const prefix = s.toUpperCase();
  if (ticketPrefixTaken(prefix, exceptProjectId))
    throw badRequest(`ticket prefix "${prefix}" is already in use by another project`);
  return prefix;
}

// Human-readable id from a project prefix + per-project number, zero-padded to
// at least 4 digits (grows past 4 when the number is larger).
function formatTicketKey(prefix: string, num: number): string {
  return `${prefix}-${String(num).padStart(4, "0")}`;
}

// ---- row mappers (SQLite stores booleans as 0/1) ----
function mapStatus(r: any): Status {
  return { ...r, is_final: !!r.is_final, hidden: !!r.hidden };
}

// Map a task row (from TASK_SELECT) to the Task shape: derive the display
// ticket_key from the joined project prefix + stored ticket_number, and drop
// the join-only helper column. Null key → UI falls back to the nanoid id.
function mapTask(r: any): Task {
  const { project_ticket_prefix, ...rest } = r;
  const ticket_key =
    project_ticket_prefix != null && rest.ticket_number != null
      ? formatTicketKey(project_ticket_prefix, rest.ticket_number)
      : null;
  return { ...rest, ticket_key } as Task;
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

// Live projects for the sidebar, ordered by the user-controlled sort_order.
// Hidden projects are ALWAYS returned (the sidebar filters them behind a "Show
// hidden" toggle, mirroring how hidden-status tasks stay listed). Archived and
// deleted projects are excluded unless explicitly requested (Archive / Trash).
export function listProjects(
  opts: { includeArchived?: boolean; includeDeleted?: boolean } = {}
): Project[] {
  const where: string[] = [];
  if (!opts.includeDeleted) where.push("deleted_at IS NULL");
  if (!opts.includeArchived) where.push("archived_at IS NULL");
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return getDb()
    .prepare(
      `SELECT * FROM projects ${clause} ORDER BY sort_order IS NULL, sort_order, created_at`
    )
    .all() as Project[];
}

// Resolve a project by its id OR its (unique) name. Id is tried first so an
// id can never be shadowed by a name; names are unique among live projects
// (enforced in createProject/updateProject + a partial unique index).
// Archived (but not deleted) projects resolve normally, so their direct links
// keep working; pass includeDeleted to reach a trashed project (for restore).
export function getProject(ref: string, includeDeleted = false): Project {
  const db = getDb();
  const del = includeDeleted ? "" : " AND deleted_at IS NULL";
  const byId = db
    .prepare(`SELECT * FROM projects WHERE id = ?${del}`)
    .get(ref) as Project | undefined;
  if (byId) return byId;
  const byName = db
    .prepare(`SELECT * FROM projects WHERE name = ?${del}`)
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

  const ticketPrefix = genTicketPrefix();

  // New projects sort after every existing one (including archived/deleted, so
  // a restore/unarchive keeps a stable slot).
  const nextOrder =
    ((db.prepare("SELECT MAX(sort_order) m FROM projects").get() as { m: number | null }).m ??
      0) + 1;

  const tx = db.transaction(() => {
    db.prepare(
      "INSERT INTO projects (id, name, description, ticket_prefix, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?)"
    ).run(pid, trimmed, description ?? null, ticketPrefix, nextOrder, ts, ts);

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
    // Status key new tasks land in when none is given. undefined = leave as-is;
    // null/"" = clear (fall back to first status); a string must be an existing
    // status key. Not guarded by confirm — it is not an identity/safety field.
    default_status_key?: string | null;
    // Per-project theme (web UI). undefined = leave as-is; null/"" = clear (→
    // default pack/accent). A set value must be a known pack/accent. Not a
    // guarded field — theme is cosmetic, not identity/safety.
    theme_pack?: string | null;
    theme_accent?: string | null;
    // Prefix for human ticket ids (PREFIX-NNNN). undefined = leave as-is; a set
    // value is validated (2–100 chars, no whitespace). Not a guarded field —
    // changing it only relabels display ids, it doesn't renumber anything.
    ticket_prefix?: string | null;
    // Hide/show the project in the web sidebar. undefined = leave as-is. Not a
    // guarded field — it is a cosmetic view preference, not identity/safety.
    hidden?: boolean;
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
  const defaultStatusKey =
    patch.default_status_key === undefined
      ? p.default_status_key
      : patch.default_status_key === null || patch.default_status_key === ""
        ? null
        : patch.default_status_key;
  const themePack =
    patch.theme_pack === undefined
      ? p.theme_pack
      : patch.theme_pack === null || patch.theme_pack === ""
        ? null
        : patch.theme_pack;
  const themeAccent =
    patch.theme_accent === undefined
      ? p.theme_accent
      : patch.theme_accent === null || patch.theme_accent === ""
        ? null
        : patch.theme_accent;
  // A prefix always exists once set: undefined leaves it; null/"" is rejected
  // by normTicketPrefix rather than clearing (there is no "no prefix" state).
  const ticketPrefix =
    patch.ticket_prefix === undefined
      ? p.ticket_prefix
      : normTicketPrefix(patch.ticket_prefix, p.id);
  const hidden = patch.hidden === undefined ? p.hidden : patch.hidden;

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
  // A set default must name an existing status of this project.
  if (
    defaultStatusKey !== null &&
    defaultStatusKey !== p.default_status_key &&
    !getStateMachine(p.id).statuses.some((s) => s.key === defaultStatusKey)
  ) {
    throw badRequest(`unknown status "${defaultStatusKey}"`);
  }
  if (themePack !== null && !isThemePack(themePack)) {
    throw badRequest(`unknown theme pack "${themePack}"`);
  }
  if (themeAccent !== null && !isAccentChoice(themeAccent)) {
    throw badRequest(`unknown theme accent "${themeAccent}"`);
  }
  getDb()
    .prepare(
      "UPDATE projects SET name=?, description=?, remote_repo_url=?, default_status_key=?, theme_pack=?, theme_accent=?, ticket_prefix=?, hidden=?, updated_at=? WHERE id=?"
    )
    .run(name, description, remoteRepoUrl, defaultStatusKey, themePack, themeAccent, ticketPrefix, hidden ? 1 : 0, now(), p.id);
  return getProject(p.id);
}

export function softDeleteProject(projectId: string): { ok: true } {
  projectId = getProject(projectId).id;
  getDb()
    .prepare("UPDATE projects SET deleted_at=?, updated_at=? WHERE id=?")
    .run(now(), now(), projectId);
  return { ok: true };
}

// Bring a trashed project back onto the sidebar. Idempotent for a live one.
export function restoreProject(projectId: string): Project {
  const p = getProject(projectId, true);
  if (!p.deleted_at) return p;
  // A live project must still own its (unique) name — a same-name project may
  // have been created while this one sat in the trash.
  const clash = getDb()
    .prepare("SELECT 1 FROM projects WHERE name=? AND id!=? AND deleted_at IS NULL")
    .get(p.name, p.id);
  if (clash)
    throw badRequest(
      `cannot restore "${p.name}": another live project already uses that name`
    );
  getDb()
    .prepare("UPDATE projects SET deleted_at=NULL, updated_at=? WHERE id=?")
    .run(now(), p.id);
  return getProject(p.id);
}

// Archive: file the project off the sidebar while it stays live (openable by
// id). Independent of soft delete. Idempotent.
export function archiveProject(projectId: string): Project {
  const p = getProject(projectId);
  if (p.archived_at) return p;
  getDb()
    .prepare("UPDATE projects SET archived_at=?, updated_at=? WHERE id=?")
    .run(now(), now(), p.id);
  return getProject(p.id);
}

export function unarchiveProject(projectId: string): Project {
  const p = getProject(projectId);
  if (!p.archived_at) return p;
  getDb()
    .prepare("UPDATE projects SET archived_at=NULL, updated_at=? WHERE id=?")
    .run(now(), p.id);
  return getProject(p.id);
}

// Persist a new sidebar order. `orderedIds` is the full ordered list of live
// project ids; each is written sort_order = its index. Unknown/deleted ids are
// no-ops. Returns the freshly ordered live list.
export function reorderProjects(orderedIds: string[]): Project[] {
  const db = getDb();
  const tx = db.transaction(() => {
    const ts = now();
    const upd = db.prepare(
      "UPDATE projects SET sort_order=?, updated_at=? WHERE id=? AND deleted_at IS NULL"
    );
    orderedIds.forEach((pid, i) => upd.run(i + 1, ts, pid));
  });
  tx();
  return listProjects({ includeArchived: true });
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
  patch: { label?: string; is_final?: boolean; sort_order?: number; hidden?: boolean }
): StateMachine {
  projectId = getProject(projectId).id;
  const sm = getStateMachine(projectId);
  const s = sm.statuses.find((x) => x.key === key);
  if (!s) throw notFound("status");
  const db = getDb();
  db.prepare(
    "UPDATE statuses SET label=?, is_final=?, sort_order=?, hidden=? WHERE project_id=? AND key=?"
  ).run(
    patch.label?.trim() ?? s.label,
    (patch.is_final ?? s.is_final) ? 1 : 0,
    patch.sort_order ?? s.sort_order,
    (patch.hidden ?? s.hidden) ? 1 : 0,
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
  SELECT t.*, cu.username AS creator_username, au.username AS assignee_username,
         p.ticket_prefix AS project_ticket_prefix
  FROM tasks t
  LEFT JOIN users cu ON cu.id = t.creator_id
  LEFT JOIN users au ON au.id = t.assignee_id
  LEFT JOIN projects p ON p.id = t.project_id`;

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
  return (
    getDb()
      .prepare(
        `${TASK_SELECT} WHERE ${clauses.join(" AND ")} ORDER BY t.status_key, ${PRIORITY_ORDER_SQL}, t.rank`
      )
      .all(...params) as any[]
  ).map(mapTask);
}

// cc-bridge poll: the ready-work queue. One row per ticket in the ready status
// that belongs to an opted-in project (one with a remote_repo_url), with that
// URL joined so the poll routine knows which repo to work in. Cross-project by
// default; `projectRef` (id or name) narrows to one project, `assignee` (id or
// username) to one user — an unknown project OR assignee ref yields []. A fleet
// of pollers pins distinct assignees to split work with no overlap.
// `status` defaults to "todo" (the route passes CC_BRIDGE_READY_STATUS).
export function listReadyTickets(
  opts: { projectRef?: string; assignee?: string; status?: string } = {}
): ReadyTicket[] {
  const status = opts.status ?? "todo";
  let pid: string | null = null;
  if (opts.projectRef) {
    try {
      pid = getProject(opts.projectRef).id;
    } catch {
      return []; // unknown project → no ready work, not an error
    }
  }
  let aid: string | null = null;
  if (opts.assignee) {
    try {
      aid = resolveUserId(opts.assignee);
    } catch {
      return []; // unknown assignee → no ready work, not an error
    }
  }
  return getDb()
    .prepare(
      `SELECT t.id AS ticket, t.project_id AS project, p.name AS projectName,
              p.remote_repo_url AS repo, t.title AS title,
              t.priority AS priority, t.description AS description
         FROM tasks t
         JOIN projects p ON p.id = t.project_id
        WHERE p.deleted_at IS NULL
          AND p.remote_repo_url IS NOT NULL
          AND t.deleted_at IS NULL
          AND t.archived_at IS NULL
          AND t.status_key = ?
          AND (? IS NULL OR p.id = ?)
          AND (? IS NULL OR t.assignee_id = ?)
        ORDER BY ${PRIORITY_ORDER_SQL}, t.rank`
    )
    .all(status, pid, pid, aid, aid) as ReadyTicket[];
}

// Shape of a human ticket key: an uppercase-letter-led prefix, then 4+ digits.
// This does NOT prove a string is a key rather than a storage id — a nanoid is
// drawn from [A-Za-z0-9_-], so "ABC-12345678" is a perfectly possible id that
// matches this shape. getTask() therefore resolves ids FIRST and only falls
// back to a key lookup; this regex just avoids a pointless second query.
const TICKET_KEY_RE = /^[A-Z][A-Za-z0-9_]*-\d{4,}$/;

export function isTicketKey(s: string): boolean {
  return TICKET_KEY_RE.test(s.trim());
}

// Resolve a PREFIX-NNNN key to its task. Prefix match is case-insensitive to
// mirror the uniqueness index; the number is exact.
export function getTaskByTicketKey(key: string, includeDeleted = false): Task {
  const m = key.trim().match(/^(.+)-(\d+)$/);
  if (!m) throw notFound("task");
  const t = getDb()
    .prepare(
      `${TASK_SELECT} WHERE lower(p.ticket_prefix)=lower(?) AND t.ticket_number=?
       ${includeDeleted ? "" : "AND t.deleted_at IS NULL"}`
    )
    .get(m[1], Number(m[2])) as any;
  if (!t) throw notFound("task");
  return mapTask(t);
}

// Accepts either storage id (nanoid) or human ticket key — everything that
// takes a task id routes through here, so keys work in the API and CLI too.
export function getTask(taskId: string, includeDeleted = false): Task {
  // Storage id wins. A nanoid can coincidentally look like a ticket key, so
  // checking the key shape first could hijack a legacy link to another task.
  // An id is exact and unique, so trying it first can never mis-resolve.
  const t = getDb()
    .prepare(
      `${TASK_SELECT} WHERE t.id=? ${includeDeleted ? "" : "AND t.deleted_at IS NULL"}`
    )
    .get(taskId) as any;
  if (t) return mapTask(t);
  if (isTicketKey(taskId)) return getTaskByTicketKey(taskId, includeDeleted);
  throw notFound("task");
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
  const project = getProject(projectId);
  projectId = project.id;
  if (!data.title?.trim()) throw badRequest("title is required");
  const sm = getStateMachine(projectId);
  // Status resolution: explicit > project default (if it still names a live
  // status — stale defaults fall back gracefully) > first status.
  const validDefault =
    project.default_status_key &&
    sm.statuses.some((s) => s.key === project.default_status_key)
      ? project.default_status_key
      : undefined;
  const statusKey = data.status ?? validDefault ?? sm.statuses[0]?.key;
  if (!sm.statuses.some((s) => s.key === statusKey))
    throw badRequest(`unknown status "${statusKey}"`);
  const assigneeId =
    data.assignee == null || data.assignee === "" ? null : resolveUserId(data.assignee);
  const priority = normPriority(data.priority, DEFAULT_PRIORITY);
  const tid = id();
  const ts = now();
  const db = getDb();
  // Wrap the ticket_number read-max-then-insert in a transaction so concurrent
  // creates in the same project can't hand out a duplicate number (the bare
  // INSERT used to race). nextRank is read inside the tx for the same reason.
  const insert = db.transaction(() => {
    const maxNum = (
      db
        .prepare("SELECT MAX(ticket_number) m FROM tasks WHERE project_id=?")
        .get(projectId) as any
    ).m;
    const ticketNumber = (maxNum ?? 0) + 1;
    db.prepare(
      "INSERT INTO tasks (id, project_id, title, description, status_key, priority, rank, version, created_at, updated_at, creator_id, assignee_id, ticket_number) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ).run(
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
      assigneeId,
      ticketNumber
    );
  });
  insert();
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
  taskId = t.id; // caller may have passed a ticket key
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
  taskId = t.id;
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
  taskId = getTask(taskId).id;
  getDb()
    .prepare("UPDATE tasks SET deleted_at=?, version=version+1, updated_at=? WHERE id=?")
    .run(now(), now(), taskId);
  return { ok: true };
}

export function restoreTask(taskId: string): Task {
  const t = getTask(taskId, true);
  taskId = t.id;
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
  taskId = t.id;
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
  taskId = t.id;
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
  // Both endpoints may arrive as a nanoid or a ticket key; resolve to storage
  // ids before building the edge so links are always keyed consistently.
  thisId = getTask(thisId).id; // 404 if the source ticket is gone
  const otherRef = parseTicketRef(targetRef ?? "");
  if (!otherRef) throw badRequest("could not read a ticket id from that link");
  // target must be a live task (not_found if missing/deleted)
  const otherId = getTask(otherRef).id;
  if (otherId === thisId) throw badRequest("a ticket cannot link to itself");
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
  taskId = getTask(taskId).id;
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
