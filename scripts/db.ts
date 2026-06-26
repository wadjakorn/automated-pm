#!/usr/bin/env -S tsx
/**
 * db — export / restore the whole SQLite database (projects, tasks, statuses,
 * transitions, AND users + sessions). One self-contained script, no web UI and
 * no running server required: it talks to the SQLite file directly.
 *
 * The DB file is resolved the same way the app resolves it (lib/db.ts):
 *   PM_DB_PATH, else <cwd>/data/pm.db
 *
 * Usage:
 *   tsx scripts/db.ts export  [--out <file.db>]      # default: data/backups/pm-<ts>.db
 *   tsx scripts/db.ts restore --in <file.db> [--yes] # replaces the live DB (snapshots first)
 *   tsx scripts/db.ts info                           # show DB path + row counts
 *
 * Why a binary .db copy: SQLite's file format is architecture-independent, so a
 * backup taken on macOS restores cleanly on the dietpi (ARM) home server. The
 * native online-backup API folds the WAL in, so an open dev server can't produce
 * a torn copy the way a plain `cp` of pm.db (with a live -wal) would.
 */
import Database from "better-sqlite3";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, basename } from "node:path";

const DB_PATH = process.env.PM_DB_PATH ?? join(process.cwd(), "data", "pm.db");

// Tables that must exist for a file to count as a valid PM database.
const REQUIRED_TABLES = ["projects", "tasks", "statuses", "transitions", "users", "sessions"];

function die(msg: string): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

function ok(msg: string) {
  process.stdout.write(`${msg}\n`);
}

// Minimal flag parser: --key value / --key (boolean).
function parseFlags(argv: string[]): Record<string, string | boolean> {
  const f: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith("--")) continue;
    const key = tok.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) f[key] = true;
    else {
      f[key] = next;
      i++;
    }
  }
  return f;
}

// UTC timestamp safe for filenames: 2026-06-26T14-03-09Z
function stamp(): string {
  return new Date().toISOString().replace(/:/g, "-").replace(/\.\d+/, "");
}

// Open a DB file readonly and assert it's a real PM database.
function assertValidDb(path: string) {
  if (!existsSync(path)) die(`no such file: ${path}`);
  let db: Database.Database;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
  } catch (e: any) {
    die(`cannot open ${path}: ${e?.message ?? e}`);
  }
  try {
    const integrity = db.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") die(`integrity check failed on ${path}: ${integrity}`);
    const names = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
        name: string;
      }[]).map((r) => r.name)
    );
    const missing = REQUIRED_TABLES.filter((t) => !names.has(t));
    if (missing.length)
      die(`${path} is missing expected tables: ${missing.join(", ")} (not a PM database?)`);
  } finally {
    db.close();
  }
}

function counts(path: string): Record<string, number> {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const out: Record<string, number> = {};
    for (const t of REQUIRED_TABLES) {
      out[t] = (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    }
    return out;
  } finally {
    db.close();
  }
}

// Online backup: consolidates WAL into a single clean .db file. Async API.
async function backupTo(src: string, dest: string) {
  mkdirSync(dirname(dest), { recursive: true });
  const db = new Database(src, { readonly: true, fileMustExist: true });
  try {
    await db.backup(dest);
  } finally {
    db.close();
  }
}

async function cmdExport(f: Record<string, string | boolean>) {
  if (!existsSync(DB_PATH)) die(`live DB not found at ${DB_PATH} (set PM_DB_PATH?)`);
  const out =
    typeof f.out === "string"
      ? f.out
      : join(process.cwd(), "data", "backups", `pm-${stamp()}.db`);
  await backupTo(DB_PATH, out);
  const c = counts(out);
  const size = statSync(out).size;
  // Reading row counts opens the backup in WAL mode, leaving -wal/-shm beside
  // it. Drop them so the export is a single self-contained file.
  for (const ext of ["-wal", "-shm"]) {
    const p = out + ext;
    if (existsSync(p)) rmSync(p);
  }
  ok(`exported ${DB_PATH}`);
  ok(`      -> ${out}  (${(size / 1024).toFixed(0) } KB)`);
  ok(
    `rows: projects=${c.projects} tasks=${c.tasks} users=${c.users} sessions=${c.sessions}`
  );
}

async function cmdRestore(f: Record<string, string | boolean>) {
  const src = typeof f.in === "string" ? f.in : die("--in <file.db> is required");
  assertValidDb(src);

  if (!f.yes) {
    const c = counts(src);
    process.stderr.write(
      `About to OVERWRITE the live DB:\n` +
        `  target : ${DB_PATH}\n` +
        `  source : ${src}\n` +
        `  source rows: projects=${c.projects} tasks=${c.tasks} users=${c.users}\n` +
        `Re-run with --yes to proceed. The current DB is snapshotted first.\n`
    );
    process.exit(2);
  }

  // Snapshot the current live DB before clobbering it (skip if none exists).
  if (existsSync(DB_PATH)) {
    const snap = join(
      dirname(DB_PATH),
      "backups",
      `pre-restore-${stamp()}-${basename(DB_PATH)}`
    );
    await backupTo(DB_PATH, snap);
    ok(`snapshot of current DB -> ${snap}`);
  }

  // Replace the file, then drop any stale WAL/SHM so the restored data wins.
  mkdirSync(dirname(DB_PATH), { recursive: true });
  copyFileSync(src, DB_PATH);
  for (const ext of ["-wal", "-shm"]) {
    const p = DB_PATH + ext;
    if (existsSync(p)) rmSync(p);
  }

  const c = counts(DB_PATH);
  ok(`restored ${src}`);
  ok(`      -> ${DB_PATH}`);
  ok(
    `rows: projects=${c.projects} tasks=${c.tasks} users=${c.users} sessions=${c.sessions}`
  );
  ok(`note: restart the server if it was running so it reopens the new file.`);
}

function cmdInfo() {
  if (!existsSync(DB_PATH)) die(`live DB not found at ${DB_PATH} (set PM_DB_PATH?)`);
  const c = counts(DB_PATH);
  const size = statSync(DB_PATH).size;
  ok(`db   : ${DB_PATH}  (${(size / 1024).toFixed(0)} KB)`);
  for (const t of REQUIRED_TABLES) ok(`  ${t.padEnd(12)} ${c[t]}`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const f = parseFlags(rest);
  switch (cmd) {
    case "export":
      return cmdExport(f);
    case "restore":
      return cmdRestore(f);
    case "info":
      return cmdInfo();
    default:
      process.stdout.write(
        `db — export / restore the SQLite database (includes users)\n\n` +
          `  tsx scripts/db.ts export  [--out <file.db>]\n` +
          `  tsx scripts/db.ts restore --in <file.db> [--yes]\n` +
          `  tsx scripts/db.ts info\n\n` +
          `DB path: ${DB_PATH} (override with PM_DB_PATH)\n`
      );
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((e) => die(String(e?.message ?? e)));
