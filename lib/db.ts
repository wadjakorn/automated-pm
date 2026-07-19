import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// Single shared connection. SQLite file lives under ./data so it persists
// across `npm run dev` restarts and is shared by the API and (indirectly) CLI.
const DB_PATH = process.env.PM_DB_PATH ?? join(process.cwd(), "data", "pm.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  _db = db;
  return db;
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      deleted_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS statuses (
      id         TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      key        TEXT NOT NULL,
      label      TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      is_final   INTEGER NOT NULL DEFAULT 0,
      UNIQUE(project_id, key)
    );

    CREATE TABLE IF NOT EXISTS transitions (
      id         TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      from_key   TEXT NOT NULL,
      to_key     TEXT NOT NULL,
      UNIQUE(project_id, from_key, to_key)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id          TEXT PRIMARY KEY,
      project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      description TEXT,
      status_key  TEXT NOT NULL,
      rank        REAL NOT NULL,
      version     INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      deleted_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      api_token     TEXT NOT NULL UNIQUE,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    -- Image attachments embedded in task descriptions. The bytes live on disk
    -- under data/uploads/<id>.<ext> (NOT in the DB, to keep pm.db small); this
    -- row is the metadata + the source of truth for what to back up. Anonymous
    -- uploads have creator_id NULL (auth is attribution-only, like tasks).
    CREATE TABLE IF NOT EXISTS uploads (
      id         TEXT PRIMARY KEY,
      ext        TEXT NOT NULL,
      mime       TEXT NOT NULL,
      size       INTEGER NOT NULL,
      orig_name  TEXT,
      created_at TEXT NOT NULL,
      creator_id TEXT REFERENCES users(id)
    );

    -- Directed link between two tasks. One row per link; the inverse direction
    -- is derived at read time. ON DELETE CASCADE cleans up on hard delete (the
    -- UI only soft-deletes, so links survive a trashed task and show "deleted").
    CREATE TABLE IF NOT EXISTS task_links (
      id         TEXT PRIMARY KEY,
      source_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      target_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      type       TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(source_id, target_id, type)
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_task_links_source ON task_links(source_id);
    CREATE INDEX IF NOT EXISTS idx_task_links_target ON task_links(target_id);
    CREATE INDEX IF NOT EXISTS idx_statuses_project ON statuses(project_id);
    CREATE INDEX IF NOT EXISTS idx_transitions_project ON transitions(project_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  `);

  // Task attribution columns are added by ALTER so existing DBs migrate in
  // place. Nullable + no default → old rows stay NULL (backward compat).
  // Idempotent via a table_info check since SQLite lacks ADD COLUMN IF NOT EXISTS.
  const taskCols = new Set(
    (db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[]).map((c) => c.name)
  );
  if (!taskCols.has("creator_id")) {
    db.exec("ALTER TABLE tasks ADD COLUMN creator_id TEXT REFERENCES users(id)");
  }
  if (!taskCols.has("assignee_id")) {
    db.exec("ALTER TABLE tasks ADD COLUMN assignee_id TEXT REFERENCES users(id)");
  }
  // Priority: fixed scale, defaults to 'medium' so existing rows migrate in
  // place (NOT NULL is safe because the column literal supplies the default).
  if (!taskCols.has("priority")) {
    db.exec("ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium'");
  }
  // Archive: a ticket "filed away" once it reaches a final status. Distinct
  // from deleted_at (Trash) — archived rows stay live (direct link + future
  // search still find them) but are hidden from every board. Nullable, no
  // default → old rows stay un-archived (backward compat).
  if (!taskCols.has("archived_at")) {
    db.exec("ALTER TABLE tasks ADD COLUMN archived_at TEXT");
  }
  // Human-readable ticket number: a per-project incrementing counter that,
  // paired with projects.ticket_prefix, forms a Jira-style id (e.g. PM-0001).
  // Nullable + no default → pre-migration tickets stay NULL and keep showing
  // their nanoid (NO backfill). Only tickets created after this ships get one.
  if (!taskCols.has("ticket_number")) {
    db.exec("ALTER TABLE tasks ADD COLUMN ticket_number INTEGER");
  }

  // Hidden: hide a status column from the WEB board only (project-level view
  // preference — every viewer sees the same board). Tasks in a hidden status
  // stay live, listed, and movable; the CLI `pm board` still shows it tagged.
  // INTEGER with a literal default so old rows migrate to 0 (not hidden).
  const statusCols = new Set(
    (db.prepare("PRAGMA table_info(statuses)").all() as { name: string }[]).map((c) => c.name)
  );
  if (!statusCols.has("hidden")) {
    db.exec("ALTER TABLE statuses ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0");
  }

  // Remote repository URL: the Git/remote URL the project tracks (agents read
  // it to know which repo to operate on). Nullable, no default → old rows stay
  // NULL (backward compat). Same idempotent table_info guard as the task cols.
  const projectCols = new Set(
    (db.prepare("PRAGMA table_info(projects)").all() as { name: string }[]).map((c) => c.name)
  );
  if (!projectCols.has("remote_repo_url")) {
    db.exec("ALTER TABLE projects ADD COLUMN remote_repo_url TEXT");
  }
  // Default status for new tasks: the status key a created task lands in when
  // none is given. Nullable → NULL falls back to the first status (current
  // behavior). A stale key (its status was removed) also falls back at create
  // time, so no guard is needed on status removal.
  if (!projectCols.has("default_status_key")) {
    db.exec("ALTER TABLE projects ADD COLUMN default_status_key TEXT");
  }
  // Per-project theme (web UI): the theme pack + accent applied when this
  // project is selected. Nullable → NULL falls back to the default pack/accent.
  // Light/dark MODE stays a per-browser preference and is NOT stored here.
  if (!projectCols.has("theme_pack")) {
    db.exec("ALTER TABLE projects ADD COLUMN theme_pack TEXT");
  }
  if (!projectCols.has("theme_accent")) {
    db.exec("ALTER TABLE projects ADD COLUMN theme_accent TEXT");
  }
  // Ticket prefix: the per-project string prepended to a ticket_number to make
  // a human id (PREFIX-NNNN). New projects get a random 2-char default at
  // create time; existing projects stay NULL (their new tasks fall back to the
  // nanoid) until a prefix is set in Settings. Editable, no backfill of ids.
  if (!projectCols.has("ticket_prefix")) {
    db.exec("ALTER TABLE projects ADD COLUMN ticket_prefix TEXT");
  }
  // Prefixes are globally unique so a ticket key (PREFIX-NNNN) names exactly
  // one task — that is what makes keys usable as ids in URLs, the API and the
  // CLI. Case-insensitive: "pm" and "PM" would print the same key. NULL is
  // exempt (SQLite allows many NULLs in a UNIQUE index), so the pre-prefix
  // projects that never got one stay valid.
  //
  // No backfill: if real duplicates already exist this CREATE throws and
  // startup fails loudly. That is deliberate — silently renaming someone's
  // prefix would break every link that already used it. Resolve by hand.
  try {
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_ticket_prefix ON projects (lower(ticket_prefix))"
    );
  } catch (e) {
    const dupes = db
      .prepare(
        `SELECT lower(ticket_prefix) p, group_concat(name, ', ') names
           FROM projects WHERE ticket_prefix IS NOT NULL
          GROUP BY 1 HAVING count(*) > 1`
      )
      .all() as { p: string; names: string }[];
    if (!dupes.length) throw e;
    throw new Error(
      "ticket prefixes must be unique across projects, but duplicates exist:\n" +
        dupes.map((d) => `  "${d.p}" — ${d.names}`).join("\n") +
        "\nRename all but one of each (Settings → Ticket prefix) and restart."
    );
  }
  // Sidebar ordering: a user-controlled integer. Added nullable (SQLite can't
  // ADD a NOT NULL column without a constant default), then backfilled by
  // created_at so the initial order matches the old ORDER BY created_at. New
  // projects get MAX+1 at insert time (see createProject).
  if (!projectCols.has("sort_order")) {
    db.exec("ALTER TABLE projects ADD COLUMN sort_order INTEGER");
    db.exec(
      `UPDATE projects SET sort_order = (
         SELECT COUNT(*) FROM projects p2
         WHERE p2.created_at < projects.created_at
            OR (p2.created_at = projects.created_at AND p2.id <= projects.id)
       ) WHERE sort_order IS NULL`
    );
  }
  // Hide a project from the WEB sidebar only (mirrors statuses.hidden). INTEGER
  // with a literal default so old rows migrate to 0 (not hidden).
  if (!projectCols.has("hidden")) {
    db.exec("ALTER TABLE projects ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0");
  }
  // Archive: file a project off the sidebar while keeping it live (mirrors
  // tasks.archived_at). Nullable, no default → old rows stay un-archived.
  if (!projectCols.has("archived_at")) {
    db.exec("ALTER TABLE projects ADD COLUMN archived_at TEXT");
  }

  // Project names are unique among live (non-deleted) projects, so `--project`
  // can take a name instead of an id. Partial index ignores soft-deleted rows,
  // so a name frees up after its project is trashed. Best-effort: if a legacy
  // DB already holds duplicate live names, the index can't be created — the
  // app-level checks in createProject/updateProject still enforce it forward.
  try {
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS uniq_projects_name ON projects(name) WHERE deleted_at IS NULL"
    );
  } catch {
    // pre-existing duplicate live names; leave to app-level guards
  }
}
