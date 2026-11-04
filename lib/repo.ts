import { customAlphabet, nanoid } from "nanoid";
import { getDb } from "./db";
import { COMMENT_KINDS, logActivity, type ActorCtx } from "./activity";
import { buildDefaultStateMachine, canTransition } from "./statemachine";
import {
  badRequest,
  conflict,
  forbidden,
  illegalTransition,
  notFound,
  statusChanged,
  unauthorized,
} from "./api-errors";
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
  UserKind,
  PublicUser,
  ActivityEntry,
  InboxItem,
  LinkedTicket,
  ReadyTicket,
} from "./types";

// The status the poll routines treat as "ready to work". Entering it is the
// owner's accept gate, so agents may not create tickets straight into it.
export const READY_STATUS_KEY = "todo";

// A project's ready status: its ready_status_key when that status still
// exists, else the built-in default.
export function readyStatusKeyFor(project: Project): string {
  const k = project.ready_status_key;
  if (k && getStateMachine(project.id).statuses.some((s) => s.key === k)) return k;
  return READY_STATUS_KEY;
}

function normUserKind(k: unknown): UserKind {
  if (k === undefined || k === null || k === "") return "human";
  if (k === "human" || k === "agent") return k;
  throw badRequest(`unknown user kind "${String(k)}" (expected human|agent)`);
}

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
  kind: u.kind,
  created_at: u.created_at,
});

// ---------------- Users ----------------

export function createUser(username: string, password: string, kind?: string): User {
  const uname = username?.trim();
  if (!uname) throw badRequest("username is required");
  if (!password) throw badRequest("password is required");
  const userKind = normUserKind(kind);
  const db = getDb();
  const dup = db.prepare("SELECT 1 FROM users WHERE username = ?").get(uname);
  if (dup) throw badRequest(`username "${uname}" already exists`);
  const uid = id();
  const ts = now();
  db.prepare(
    "INSERT INTO users (id, username, password_hash, api_token, kind, created_at, updated_at) VALUES (?,?,?,?,?,?,?)"
  ).run(uid, uname, hashPassword(password), newApiToken(), userKind, ts, ts);
  return getUser(uid);
}

// Mark a user as a human or an agent. Deliberately not exposed over HTTP:
// there are no roles yet, so any token could otherwise promote itself back to
// human. Run it on the host via `npm run db -- user-kind <user> <kind>`.
export function setUserKind(ref: string, kind: string): PublicUser {
  const u = getUser(ref);
  getDb()
    .prepare("UPDATE users SET kind=?, updated_at=? WHERE id=?")
    .run(normUserKind(kind), now(), u.id);
  return publicUser(getUser(u.id));
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

// Issue a new API token after re-checking the password. The old token stops
// working immediately; the new one is returned once and never shown again.
export function rotateApiToken(username: string, password: string): string {
  const u = verifyLogin(username, password);
  const token = newApiToken();
  getDb()
    .prepare("UPDATE users SET api_token=?, updated_at=? WHERE id=?")
    .run(token, now(), u.id);
  return token;
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
    // The "ready to work" status for /ready and the agent create gate.
    // undefined = leave; null/"" = clear (→ "todo"); else an existing status.
    ready_status_key?: string | null;
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
  const readyStatusKey =
    patch.ready_status_key === undefined
      ? p.ready_status_key
      : patch.ready_status_key === null || patch.ready_status_key === ""
        ? null
        : patch.ready_status_key;
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
  // Same for the ready status.
  if (
    readyStatusKey !== null &&
    readyStatusKey !== p.ready_status_key &&
    !getStateMachine(p.id).statuses.some((s) => s.key === readyStatusKey)
  ) {
    throw badRequest(`unknown status "${readyStatusKey}"`);
  }
  if (themePack !== null && !isThemePack(themePack)) {
    throw badRequest(`unknown theme pack "${themePack}"`);
  }
  if (themeAccent !== null && !isAccentChoice(themeAccent)) {
    throw badRequest(`unknown theme accent "${themeAccent}"`);
  }
  getDb()
    .prepare(
      "UPDATE projects SET name=?, description=?, remote_repo_url=?, default_status_key=?, ready_status_key=?, theme_pack=?, theme_accent=?, ticket_prefix=?, hidden=?, updated_at=? WHERE id=?"
    )
    .run(name, description, remoteRepoUrl, defaultStatusKey, readyStatusKey, themePack, themeAccent, ticketPrefix, hidden ? 1 : 0, now(), p.id);
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
    // Drop tickets sitting in a final status (released, done…).
    excludeFinal?: boolean;
    // Case-insensitive substring of the title, e.g. an epic tag "[AAUX2]".
    titleContains?: string;
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
  if (opts.excludeFinal) {
    clauses.push(
      "NOT EXISTS (SELECT 1 FROM statuses s WHERE s.project_id = t.project_id AND s.key = t.status_key AND s.is_final = 1)"
    );
  }
  if (opts.titleContains?.trim()) {
    // instr, not LIKE: no wildcard escaping for titles with % or _.
    clauses.push("instr(lower(t.title), lower(?)) > 0");
    params.push(opts.titleContains.trim());
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
// username) to one user — an unknown project OR assignee ref is a 404 (a typo
// must not read as "no work"). A fleet of pollers pins distinct assignees to
// split work with no overlap. A ticket that is still blocked — an incoming
// `blocks` link from a live ticket not yet in a final status — is not ready.
// The ready status is per project (ready_status_key, default `status`).
// Owner accept gate: if the ticket's history records how it entered its
// current status, that entry must have been made by a human. Tickets with no
// such record (history predates task_activity) are grandfathered in.
// `status` defaults to "todo" (the route passes CC_BRIDGE_READY_STATUS).
export function listReadyTickets(
  opts: { projectRef?: string; assignee?: string; status?: string } = {}
): ReadyTicket[] {
  const status = opts.status ?? READY_STATUS_KEY;
  const pid = opts.projectRef ? getProject(opts.projectRef).id : null;
  const aid = opts.assignee ? resolveUserId(opts.assignee) : null;
  const rows = getDb()
    .prepare(
      `SELECT t.id AS ticket, t.project_id AS project, p.name AS projectName,
              p.remote_repo_url AS repo, t.title AS title,
              t.priority AS priority, t.description AS description,
              t.version AS version, t.ticket_number AS ticket_number,
              p.ticket_prefix AS ticket_prefix
         FROM tasks t
         JOIN projects p ON p.id = t.project_id
        WHERE p.deleted_at IS NULL
          AND p.remote_repo_url IS NOT NULL
          AND t.deleted_at IS NULL
          AND t.archived_at IS NULL
          AND t.status_key = COALESCE(
            (SELECT s.key FROM statuses s WHERE s.project_id = p.id AND s.key = p.ready_status_key), ?)
          AND (? IS NULL OR p.id = ?)
          AND (? IS NULL OR t.assignee_id = ?)
          AND NOT EXISTS (
            SELECT 1 FROM task_links l
              JOIN tasks b ON b.id = l.source_id
              JOIN statuses bs ON bs.project_id = b.project_id AND bs.key = b.status_key
             WHERE l.target_id = t.id AND l.type = 'blocks'
               AND b.deleted_at IS NULL AND bs.is_final = 0)
          AND NOT EXISTS (
            SELECT 1 FROM task_activity e LEFT JOIN users eu ON eu.id = e.actor_id
             WHERE e.seq = (
                     SELECT MAX(e2.seq) FROM task_activity e2
                      WHERE e2.task_id = t.id
                        AND ((e2.type = 'status' AND json_extract(e2.payload, '$.to') = t.status_key)
                          OR (e2.type = 'created' AND json_extract(e2.payload, '$.status') = t.status_key)))
               AND COALESCE(eu.kind, 'anonymous') <> 'human')
        ORDER BY ${PRIORITY_ORDER_SQL}, t.rank`
    )
    .all(status, pid, pid, aid, aid) as any[];
  return rows.map(({ ticket_number, ticket_prefix, ...r }) => ({
    ...r,
    ticket_key:
      ticket_prefix != null && ticket_number != null
        ? formatTicketKey(ticket_prefix, ticket_number)
        : null,
  }));
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
    // Kind of the calling actor: null = anonymous, undefined = internal call
    // (tests, scripts) that skips the ready-gate check.
    actorKind?: UserKind | null;
  }
): Task {
  const project = getProject(projectId);
  projectId = project.id;
  assertOptionalString(data.title, "title");
  assertOptionalString(data.description, "description");
  assertOptionalString(data.status, "status");
  assertOptionalString(data.priority, "priority");
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
  // Owner accept gate: only a human may put a ticket straight into ready.
  // Agents (and anonymous callers) create it earlier and a human moves it.
  const readyKey = readyStatusKeyFor(project);
  if (data.actorKind !== undefined && data.actorKind !== "human" && statusKey === readyKey)
    throw forbidden(
      `only a human can create a ticket directly in "${readyKey}"; create it in an earlier status and let a human move it`
    );
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
  logActivity({
    taskId: tid,
    projectId,
    actorId: data.creatorId,
    type: "created",
    payload: { status: statusKey },
  });
  return getTask(tid);
}

// Reject wrongly-typed JSON fields up front with a 400, instead of letting a
// `.trim()` on a boolean surface as a 500 (e.g. `pm task update --title`).
function assertOptionalString(v: unknown, field: string) {
  if (v !== undefined && typeof v !== "string") throw badRequest(`${field} must be a string`);
}
function assertOptionalVersion(v: unknown) {
  if (v !== undefined && v !== null && !Number.isInteger(v))
    throw badRequest("version must be an integer");
}

// Create several tickets in one project atomically: all or none. Each item is
// validated exactly like createTask (same ready gate for the actor).
export function createTasks(
  projectRef: string,
  items: unknown,
  actor: { creatorId: string | null; actorKind: UserKind | null }
): Task[] {
  if (!Array.isArray(items) || items.length === 0)
    throw badRequest("tasks must be a non-empty array");
  if (items.length > 200) throw badRequest("at most 200 tasks per batch");
  const projectId = getProject(projectRef).id;
  const run = getDb().transaction(() =>
    items.map((item, i) => {
      if (!item || typeof item !== "object") throw badRequest(`tasks[${i}] must be an object`);
      try {
        return createTask(projectId, { ...(item as any), ...actor });
      } catch (e: any) {
        if (e?.message) e.message = `tasks[${i}]: ${e.message}`;
        throw e;
      }
    })
  );
  return run();
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
  },
  ctx: ActorCtx = {}
): Task {
  const t = getTask(taskId);
  taskId = t.id; // caller may have passed a ticket key
  assertVersion(t, patch.version);
  assertOptionalString(patch.title, "title");
  if (patch.description !== null) assertOptionalString(patch.description, "description");
  assertOptionalString(patch.priority, "priority");
  assertOptionalVersion(patch.version);
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
  const after = getTask(taskId);
  // Record what changed. Descriptions can be huge, so only their lengths go
  // into the log; the text itself lives on the ticket.
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (after.title !== t.title) changes.title = { from: t.title, to: after.title };
  if ((after.description ?? "") !== (t.description ?? ""))
    changes.description = { from: (t.description ?? "").length, to: (after.description ?? "").length };
  if (after.assignee_id !== t.assignee_id)
    changes.assignee = { from: t.assignee_username, to: after.assignee_username };
  if (after.priority !== t.priority) changes.priority = { from: t.priority, to: after.priority };
  if (Object.keys(changes).length)
    logActivity({ taskId, projectId: t.project_id, actorId: ctx.actorId, type: "field", payload: { changes } });
  return after;
}

export function moveTask(
  taskId: string,
  toStatus: string,
  // expectFrom: only move if the ticket is still in this status — the claim
  // primitive. Without it a move to the current status is a harmless no-op
  // (callers such as capz-loop's stale-run recovery rely on that).
  opts: { version?: number; rank?: number; expectFrom?: string } & ActorCtx = {}
): Task {
  const t = getTask(taskId);
  taskId = t.id;
  if (typeof toStatus !== "string") throw badRequest("status must be a string");
  assertOptionalVersion(opts.version);
  if (opts.expectFrom !== undefined && t.status_key !== opts.expectFrom)
    throw statusChanged(opts.expectFrom, t);
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
  if (toStatus !== t.status_key)
    logActivity({
      taskId,
      projectId: t.project_id,
      actorId: opts.actorId,
      type: "status",
      payload: { from: t.status_key, to: toStatus },
    });
  return getTask(taskId);
}

export function softDeleteTask(taskId: string, ctx: ActorCtx = {}): { ok: true } {
  const t = getTask(taskId);
  getDb()
    .prepare("UPDATE tasks SET deleted_at=?, version=version+1, updated_at=? WHERE id=?")
    .run(now(), now(), t.id);
  logActivity({ taskId: t.id, projectId: t.project_id, actorId: ctx.actorId, type: "deleted" });
  return { ok: true };
}

export function restoreTask(taskId: string, ctx: ActorCtx = {}): Task {
  const t = getTask(taskId, true);
  taskId = t.id;
  if (!t.deleted_at) return t;
  getDb()
    .prepare("UPDATE tasks SET deleted_at=NULL, version=version+1, updated_at=? WHERE id=?")
    .run(now(), taskId);
  logActivity({ taskId, projectId: t.project_id, actorId: ctx.actorId, type: "restored" });
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

export function archiveTask(taskId: string, opts: { version?: number } & ActorCtx = {}): Task {
  const t = getTask(taskId);
  taskId = t.id;
  assertVersion(t, opts.version);
  if (t.archived_at) return t; // idempotent
  if (!isFinalStatus(t.project_id, t.status_key))
    throw badRequest("only tickets in a final status can be archived");
  getDb()
    .prepare("UPDATE tasks SET archived_at=?, version=version+1, updated_at=? WHERE id=?")
    .run(now(), now(), taskId);
  logActivity({ taskId, projectId: t.project_id, actorId: opts.actorId, type: "archived" });
  return getTask(taskId);
}

export function unarchiveTask(taskId: string, ctx: ActorCtx = {}): Task {
  const t = getTask(taskId);
  taskId = t.id;
  if (!t.archived_at) return t;
  getDb()
    .prepare("UPDATE tasks SET archived_at=NULL, version=version+1, updated_at=? WHERE id=?")
    .run(now(), taskId);
  logActivity({ taskId, projectId: t.project_id, actorId: ctx.actorId, type: "unarchived" });
  return getTask(taskId);
}

// Bulk-archive every live, un-archived ticket in a final-status column.
// Returns the archived tickets. Throws if the status isn't final.
export function bulkArchiveColumn(
  projectId: string,
  statusKey: string,
  ctx: ActorCtx = {}
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
    for (const r of rows) {
      upd.run(ts, ts, r.id);
      logActivity({ taskId: r.id, projectId, actorId: ctx.actorId, type: "archived" });
    }
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
      ticket_key: other.ticket_key ?? null,
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
  option: LinkOption,
  ctx: ActorCtx = {}
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
  const linked = toLinkedTicket(row, thisId);
  logActivity({
    taskId: thisId,
    projectId: getTask(thisId).project_id,
    actorId: ctx.actorId,
    type: "link",
    payload: { verb: linked.verb, label: linked.label, other: otherId },
  });
  return linked;
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

export function removeLink(linkId: string, ctx: ActorCtx & { viewerId?: string } = {}): { ok: true } {
  const row = getDb().prepare("SELECT * FROM task_links WHERE id=?").get(linkId) as any;
  if (!row) throw notFound("link");
  getDb().prepare("DELETE FROM task_links WHERE id=?").run(linkId);
  const viewer = ctx.viewerId ?? row.source_id;
  const t = getTask(viewer, true);
  logActivity({
    taskId: t.id,
    projectId: t.project_id,
    actorId: ctx.actorId,
    type: "unlink",
    payload: { verb: row.type, other: row.source_id === t.id ? row.target_id : row.source_id },
  });
  return { ok: true };
}

// ---------------- Activity, comments, inbox ----------------

const ACTIVITY_SELECT = `
  SELECT a.*, u.username AS actor_username, u.kind AS actor_kind,
         t.title AS task_title, t.ticket_number AS ticket_number, p.ticket_prefix AS ticket_prefix
  FROM task_activity a
  LEFT JOIN users u ON u.id = a.actor_id
  JOIN tasks t ON t.id = a.task_id
  JOIN projects p ON p.id = a.project_id`;

function mapActivity(r: any): ActivityEntry {
  const { ticket_number, ticket_prefix, payload, ...rest } = r;
  return {
    ...rest,
    payload: payload ? JSON.parse(payload) : null,
    ticket_key:
      ticket_prefix != null && ticket_number != null
        ? formatTicketKey(ticket_prefix, ticket_number)
        : null,
  };
}

const MAX_COMMENT_CHARS = 20000;

// Add a comment. kind: note (default) | question (opens an inbox item) |
// answer (with reply_to = a question on the same ticket, resolves it) |
// handoff (a summary for whoever picks the ticket up next).
export function addComment(
  taskRef: string,
  data: { body?: unknown; kind?: unknown; reply_to?: unknown },
  ctx: ActorCtx = {}
): ActivityEntry {
  const t = getTask(taskRef);
  if (typeof data.body !== "string" || !data.body.trim()) throw badRequest("body is required");
  if (data.body.length > MAX_COMMENT_CHARS)
    throw badRequest(`comment is longer than ${MAX_COMMENT_CHARS} characters`);
  const kind = data.kind === undefined || data.kind === null || data.kind === "" ? "note" : data.kind;
  if (!COMMENT_KINDS.includes(kind as any))
    throw badRequest(`unknown comment kind "${String(kind)}" (note|question|answer|handoff)`);
  let replyTo: string | null = null;
  if (data.reply_to !== undefined && data.reply_to !== null && data.reply_to !== "") {
    if (typeof data.reply_to !== "string") throw badRequest("reply_to must be a comment id");
    const parent = getDb()
      .prepare("SELECT * FROM task_activity WHERE id=? AND type='comment'")
      .get(data.reply_to) as any;
    if (!parent || parent.task_id !== t.id) throw notFound("comment on this ticket");
    replyTo = parent.id;
  }
  const db = getDb();
  const aid = db.transaction(() => {
    const newId = logActivity({
      taskId: t.id,
      projectId: t.project_id,
      actorId: ctx.actorId,
      type: "comment",
      kind: kind as any,
      body: data.body as string,
      replyTo,
    });
    // An answer to an open question closes it.
    if (kind === "answer" && replyTo)
      db.prepare(
        "UPDATE task_activity SET resolved_at=? WHERE id=? AND kind='question' AND resolved_at IS NULL"
      ).run(now(), replyTo);
    return newId;
  })();
  return getActivity(aid);
}

export function getActivity(activityId: string): ActivityEntry {
  const r = getDb().prepare(`${ACTIVITY_SELECT} WHERE a.id=?`).get(activityId);
  if (!r) throw notFound("activity");
  return mapActivity(r);
}

// Mark a question resolved without writing an answer (e.g. settled elsewhere).
export function resolveComment(commentId: string, ctx: ActorCtx = {}): ActivityEntry {
  const c = getActivity(commentId);
  if (c.type !== "comment" || c.kind !== "question") throw badRequest("only questions can be resolved");
  if (!c.resolved_at) {
    getDb().prepare("UPDATE task_activity SET resolved_at=? WHERE id=?").run(now(), c.id);
    logActivity({
      taskId: c.task_id,
      projectId: c.project_id,
      actorId: ctx.actorId,
      type: "field",
      payload: { changes: { question: { from: "open", to: "resolved" } }, comment: c.id },
    });
  }
  return getActivity(c.id);
}

function clampLimit(limit: unknown, def = 200, max = 1000): number {
  const n = Number(limit);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : def;
}

// One ticket's history, oldest first. `since` = only rows with seq > since.
export function listActivity(
  taskRef: string,
  opts: { since?: unknown; limit?: unknown; type?: string } = {}
): ActivityEntry[] {
  const t = getTask(taskRef, true);
  const since = Number(opts.since) || 0;
  const rows = getDb()
    .prepare(
      `${ACTIVITY_SELECT} WHERE a.task_id=? AND a.seq>? ${opts.type ? "AND a.type=?" : ""} ORDER BY a.seq LIMIT ?`
    )
    .all(...[t.id, since, ...(opts.type ? [opts.type] : []), clampLimit(opts.limit)]);
  return rows.map(mapActivity);
}

// Everything that happened since a cursor, across tickets (optionally one
// project) — the feed agents and live views poll. Oldest first.
export function listEvents(opts: { since?: unknown; project?: string; limit?: unknown } = {}): ActivityEntry[] {
  const since = Number(opts.since) || 0;
  const pid = opts.project ? getProject(opts.project).id : null;
  const rows = getDb()
    .prepare(`${ACTIVITY_SELECT} WHERE a.seq>? AND (? IS NULL OR a.project_id=?) ORDER BY a.seq LIMIT ?`)
    .all(since, pid, pid, clampLimit(opts.limit));
  return rows.map(mapActivity);
}

// Open questions on live tickets, oldest first — what is waiting on a human.
export function listInbox(opts: { project?: string; assignee?: string } = {}): InboxItem[] {
  const pid = opts.project ? getProject(opts.project).id : null;
  const aid = opts.assignee ? resolveUserId(opts.assignee) : null;
  const rows = getDb()
    .prepare(
      `SELECT a.*, u.username AS actor_username, u.kind AS actor_kind,
              t.title AS task_title, t.ticket_number AS ticket_number, p.ticket_prefix AS ticket_prefix,
              p.name AS project_name, t.status_key AS task_status, au.username AS task_assignee
         FROM task_activity a
         LEFT JOIN users u ON u.id = a.actor_id
         JOIN tasks t ON t.id = a.task_id
         JOIN projects p ON p.id = a.project_id
         LEFT JOIN users au ON au.id = t.assignee_id
        WHERE a.type='comment' AND a.kind='question' AND a.resolved_at IS NULL
          AND t.deleted_at IS NULL AND p.deleted_at IS NULL
          AND (? IS NULL OR a.project_id=?) AND (? IS NULL OR t.assignee_id=?)
        ORDER BY a.seq`
    )
    .all(pid, pid, aid, aid);
  return rows.map((r: any) => mapActivity(r) as InboxItem);
}

// ---------------- Search & overview ----------------

export interface SearchHit {
  task: Task & { has_more_description: boolean };
  project_name: string;
  // Matched text with [brackets] around the hit, from title/description/comments.
  snippet: string | null;
}

const MIN_TRIGRAM = 3;

// Full-text search across projects (title, description, comments), archived
// tickets included. A ticket key or id is an exact hit first. Terms of 3+
// characters use the trigram index (substring match, works for Thai); shorter
// terms filter with LIKE on title/description.
export function searchTasks(opts: {
  q?: unknown;
  project?: string;
  status?: string;
  assignee?: string;
  includeDeleted?: boolean;
  limit?: unknown;
}): SearchHit[] {
  const q = typeof opts.q === "string" ? opts.q.trim() : "";
  if (!q) throw badRequest("q is required");
  const limit = clampLimit(opts.limit, 20, 100);
  const pid = opts.project ? getProject(opts.project).id : null;
  const aid = opts.assignee ? resolveUserId(opts.assignee) : null;
  const terms = q.split(/\s+/).filter(Boolean);
  const long = terms.filter((t) => [...t].length >= MIN_TRIGRAM);
  const short = terms.filter((t) => [...t].length < MIN_TRIGRAM);

  const where = [
    "(? IS NULL OR t.project_id = ?)",
    "(? IS NULL OR t.status_key = ?)",
    "(? IS NULL OR t.assignee_id = ?)",
    "p.deleted_at IS NULL",
  ];
  const params: unknown[] = [pid, pid, opts.status ?? null, opts.status ?? null, aid, aid];
  if (!opts.includeDeleted) where.push("t.deleted_at IS NULL");
  for (const s of short) {
    where.push("(t.title LIKE ? OR t.description LIKE ?)");
    params.push(`%${s}%`, `%${s}%`);
  }

  let rows: { id: string; snippet: string | null }[];
  if (long.length) {
    const match = long.map((t) => `"${t.replace(/"/g, '""')}"`).join(" ");
    rows = getDb()
      .prepare(
        `SELECT t.id, snippet(task_fts, -1, '[', ']', '…', 24) AS snippet
           FROM task_fts JOIN tasks t ON t.rowid = task_fts.rowid
           JOIN projects p ON p.id = t.project_id
          WHERE task_fts MATCH ? AND ${where.join(" AND ")}
          ORDER BY bm25(task_fts, 10.0, 3.0, 1.0), t.updated_at DESC
          LIMIT ?`
      )
      .all(match, ...params, limit) as any[];
  } else {
    rows = getDb()
      .prepare(
        `SELECT t.id, NULL AS snippet FROM tasks t JOIN projects p ON p.id = t.project_id
          WHERE ${where.join(" AND ")} ORDER BY t.updated_at DESC LIMIT ?`
      )
      .all(...params, limit) as any[];
  }

  // An exact ticket key / id goes first (and is found even if the text isn't).
  let exact: Task | null = null;
  try {
    exact = getTask(q, !!opts.includeDeleted);
  } catch {
    exact = null;
  }
  const ids = rows.map((r) => r.id);
  if (exact && (!pid || exact.project_id === pid)) {
    rows = [{ id: exact.id, snippet: null }, ...rows.filter((r) => r.id !== exact!.id)].slice(0, limit);
  } else if (!ids.length) {
    return [];
  }
  const names = new Map<string, string>();
  return rows.map((r) => {
    const t = getTask(r.id, true);
    if (!names.has(t.project_id)) names.set(t.project_id, getProject(t.project_id, true).name);
    return { task: summarize(t), project_name: names.get(t.project_id)!, snippet: r.snippet };
  });
}

// Inline excerpt (same rule as lib/task-view summarizeTask; kept local to
// avoid a repo → view import cycle).
function summarize(t: Task): Task & { has_more_description: boolean } {
  const d = t.description;
  if (d == null || d.length <= 200) return { ...t, has_more_description: false };
  return { ...t, description: d.slice(0, 200).trimEnd() + "…", has_more_description: true };
}

// How long an agent's in-progress ticket may sit untouched before it counts
// as stale (matches capz-loop's crashed-run threshold).
export const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

export interface Overview {
  user: PublicUser | null;
  // Open tickets assigned to the user, across projects (not in a final status).
  mine: (Task & { has_more_description: boolean; project_name: string })[];
  // Tickets agents are working on: assigned to an agent user, in a status
  // ordered after the project's ready status and not final (so backlog,
  // blocked and todo don't count). `stale` = untouched for STALE_AFTER_MS.
  agents: (Task & { has_more_description: boolean; project_name: string; stale: boolean })[];
  inbox_count: number;
}

export function overview(userRef?: string | null): Overview {
  const db = getDb();
  const user = userRef ? publicUser(getUser(userRef)) : null;
  const open = `t.deleted_at IS NULL AND t.archived_at IS NULL AND p.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM statuses s WHERE s.project_id = t.project_id AND s.key = t.status_key AND s.is_final = 1)`;
  const withProject = (r: any) => ({ ...summarize(getTask(r.id)), project_name: r.project_name as string });

  const mine = user
    ? (db
        .prepare(
          `SELECT t.id, p.name AS project_name FROM tasks t JOIN projects p ON p.id = t.project_id
            WHERE t.assignee_id = ? AND ${open}
            ORDER BY ${PRIORITY_ORDER_SQL}, t.updated_at DESC LIMIT 200`
        )
        .all(user.id) as any[]).map(withProject)
    : [];

  const cutoff = Date.now() - STALE_AFTER_MS;
  const agents = (db
    .prepare(
      `SELECT t.id, p.name AS project_name FROM tasks t
         JOIN projects p ON p.id = t.project_id
         JOIN users u ON u.id = t.assignee_id AND u.kind = 'agent'
        WHERE ${open}
          AND (SELECT s.sort_order FROM statuses s WHERE s.project_id = t.project_id AND s.key = t.status_key)
              > COALESCE(
                  (SELECT s.sort_order FROM statuses s WHERE s.project_id = p.id AND s.key = p.ready_status_key),
                  (SELECT s.sort_order FROM statuses s WHERE s.project_id = p.id AND s.key = '${READY_STATUS_KEY}'),
                  0)
        ORDER BY t.updated_at LIMIT 200`
    )
    .all() as any[]).map((r) => {
    const t = withProject(r);
    return { ...t, stale: Date.parse(t.updated_at) < cutoff };
  });

  const inbox_count = (db
    .prepare(
      `SELECT count(*) n FROM task_activity a JOIN tasks t ON t.id = a.task_id
        WHERE a.type='comment' AND a.kind='question' AND a.resolved_at IS NULL AND t.deleted_at IS NULL`
    )
    .get() as { n: number }).n;

  return { user, mine, agents, inbox_count };
}
