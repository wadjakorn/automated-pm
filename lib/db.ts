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

    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
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
