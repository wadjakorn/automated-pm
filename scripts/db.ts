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
 *   tsx scripts/db.ts export  [--out <file>]         # default: data/backups/pm-<ts>.tgz
 *                             [--db-only]             # legacy single .db (no images)
 *   tsx scripts/db.ts restore --in <file> [--yes]    # replaces live DB + uploads (snapshots first)
 *   tsx scripts/db.ts info                           # show DB path + row counts
 *
 * Why a binary .db copy: SQLite's file format is architecture-independent, so a
 * backup taken on macOS restores cleanly on the dietpi (ARM) home server. The
 * native online-backup API folds the WAL in, so an open dev server can't produce
 * a torn copy the way a plain `cp` of pm.db (with a live -wal) would.
 *
 * Archive (.tgz) export bundles pm.db + the uploads/ image dir so a single file
 * carries everything. Restore accepts EITHER a .tgz archive or a bare .db
 * (legacy/back-compat) — detected by gzip magic bytes, not the extension.
 */
import Database from "better-sqlite3";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  closeSync,
  rmSync,
  statSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, basename } from "node:path";

const DB_PATH = process.env.PM_DB_PATH ?? join(process.cwd(), "data", "pm.db");
// Image attachments live beside the DB (mirrors lib/uploads.ts). Bundled into
// archive exports so a backup carries both the data and its images.
const UPLOADS_DIR = process.env.PM_DB_PATH
  ? join(dirname(DB_PATH), "uploads")
  : join(process.cwd(), "data", "uploads");

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

// True if the file starts with the gzip magic bytes (1f 8b) -> treat as a
// .tgz archive regardless of its name; otherwise it's a bare .db.
function isGzip(path: string): boolean {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(2);
    readSync(fd, buf, 0, 2, 0);
    return buf[0] === 0x1f && buf[1] === 0x8b;
  } finally {
    closeSync(fd);
  }
}

function mkTmpDir(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}-${stamp()}-${basename(DB_PATH)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// This is a synchronous one-shot CLI (not a server), so execFileSync is fine —
// it blocks this process only, with no event loop to starve. We still wrap tar
// so a missing binary or a failed archive surfaces a clear error instead of a
// raw stack trace.
function runTar(args: string[], what: string) {
  try {
    execFileSync("tar", args, { stdio: ["ignore", "ignore", "pipe"] });
  } catch (e: any) {
    const stderr = e?.stderr ? `: ${String(e.stderr).trim()}` : "";
    if (e?.code === "ENOENT")
      die(`'tar' not found on PATH — required to ${what}`);
    die(`tar failed while trying to ${what}${stderr}`);
  }
}

function tarCreate(archive: string, cwd: string, entries: string[]) {
  runTar(["-czf", archive, "-C", cwd, ...entries], "create the archive");
}

function tarExtract(archive: string, destDir: string) {
  runTar(["-xzf", archive, "-C", destDir], "extract the archive");
}

async function cmdExport(f: Record<string, string | boolean>) {
  if (!existsSync(DB_PATH)) die(`live DB not found at ${DB_PATH} (set PM_DB_PATH?)`);
  const dbOnly = f["db-only"] === true;

  // Legacy: single .db file, no images.
  if (dbOnly) {
    const out =
      typeof f.out === "string"
        ? f.out
        : join(process.cwd(), "data", "backups", `pm-${stamp()}.db`);
    await backupTo(DB_PATH, out);
    const c = counts(out);
    const size = statSync(out).size;
    for (const ext of ["-wal", "-shm"]) {
      const p = out + ext;
      if (existsSync(p)) rmSync(p);
    }
    ok(`exported ${DB_PATH}`);
    ok(`      -> ${out}  (${(size / 1024).toFixed(0)} KB, db only)`);
    ok(`rows: projects=${c.projects} tasks=${c.tasks} users=${c.users} sessions=${c.sessions}`);
    return;
  }

  // Default: .tgz bundling pm.db + uploads/.
  const out =
    typeof f.out === "string"
      ? f.out
      : join(process.cwd(), "data", "backups", `pm-${stamp()}.tgz`);
  const stage = mkTmpDir("pm-export");
  try {
    // Clean db copy via online backup, drop its WAL/SHM in the staging dir.
    await backupTo(DB_PATH, join(stage, "pm.db"));
    for (const ext of ["-wal", "-shm"]) {
      const p = join(stage, "pm.db" + ext);
      if (existsSync(p)) rmSync(p);
    }
    const c = counts(join(stage, "pm.db"));
    const entries = ["pm.db"];
    let nImages = 0;
    if (existsSync(UPLOADS_DIR)) {
      cpSync(UPLOADS_DIR, join(stage, "uploads"), { recursive: true });
      entries.push("uploads");
      nImages = (db_listFiles(join(stage, "uploads"))).length;
    }
    mkdirSync(dirname(out), { recursive: true });
    tarCreate(out, stage, entries);
    const size = statSync(out).size;
    ok(`exported ${DB_PATH} + uploads`);
    ok(`      -> ${out}  (${(size / 1024).toFixed(0)} KB)`);
    ok(
      `rows: projects=${c.projects} tasks=${c.tasks} users=${c.users} sessions=${c.sessions} | images=${nImages}`
    );
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

// Count files in a dir (non-recursive is fine; uploads is flat).
function db_listFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((n) => statSync(join(dir, n)).isFile());
  } catch {
    return [];
  }
}

async function cmdRestore(f: Record<string, string | boolean>) {
  const src = typeof f.in === "string" ? f.in : die("--in <file> is required");
  if (!existsSync(src)) die(`no such file: ${src}`);

  // Resolve the source to a concrete pm.db (+ optional uploads dir), unpacking
  // a .tgz archive to a temp dir if needed.
  const archive = isGzip(src);
  let dbFile = src;
  let uploadsFrom: string | null = null;
  let unpackDir: string | null = null;
  if (archive) {
    unpackDir = mkTmpDir("pm-restore");
    tarExtract(src, unpackDir);
    dbFile = join(unpackDir, "pm.db");
    if (!existsSync(dbFile)) {
      rmSync(unpackDir, { recursive: true, force: true });
      die(`archive ${src} has no pm.db (not a PM backup?)`);
    }
    if (existsSync(join(unpackDir, "uploads"))) uploadsFrom = join(unpackDir, "uploads");
  }

  try {
    assertValidDb(dbFile);

    if (!f.yes) {
      const c = counts(dbFile);
      const nImg = uploadsFrom ? db_listFiles(uploadsFrom).length : 0;
      process.stderr.write(
        `About to OVERWRITE the live DB${archive ? " + uploads" : ""}:\n` +
          `  target : ${DB_PATH}\n` +
          `  source : ${src}${archive ? " (archive)" : ""}\n` +
          `  source rows: projects=${c.projects} tasks=${c.tasks} users=${c.users}` +
          (archive ? ` images=${nImg}` : "") +
          `\n` +
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

    // Replace the DB file, then drop any stale WAL/SHM so restored data wins.
    mkdirSync(dirname(DB_PATH), { recursive: true });
    copyFileSync(dbFile, DB_PATH);
    for (const ext of ["-wal", "-shm"]) {
      const p = DB_PATH + ext;
      if (existsSync(p)) rmSync(p);
    }

    // Replace uploads dir from the archive (snapshot the old one first).
    let nImages = 0;
    if (uploadsFrom) {
      if (existsSync(UPLOADS_DIR)) {
        const snap = join(dirname(DB_PATH), "backups", `pre-restore-${stamp()}-uploads`);
        cpSync(UPLOADS_DIR, snap, { recursive: true });
        rmSync(UPLOADS_DIR, { recursive: true, force: true });
      }
      cpSync(uploadsFrom, UPLOADS_DIR, { recursive: true });
      nImages = db_listFiles(UPLOADS_DIR).length;
    }

    const c = counts(DB_PATH);
    ok(`restored ${src}`);
    ok(`      -> ${DB_PATH}${uploadsFrom ? ` + ${UPLOADS_DIR}` : ""}`);
    ok(
      `rows: projects=${c.projects} tasks=${c.tasks} users=${c.users} sessions=${c.sessions}` +
        (uploadsFrom ? ` | images=${nImages}` : "")
    );
    ok(`note: restart the server if it was running so it reopens the new file.`);
  } finally {
    if (unpackDir) rmSync(unpackDir, { recursive: true, force: true });
  }
}

function cmdInfo() {
  if (!existsSync(DB_PATH)) die(`live DB not found at ${DB_PATH} (set PM_DB_PATH?)`);
  const c = counts(DB_PATH);
  const size = statSync(DB_PATH).size;
  ok(`db   : ${DB_PATH}  (${(size / 1024).toFixed(0)} KB)`);
  for (const t of REQUIRED_TABLES) ok(`  ${t.padEnd(12)} ${c[t]}`);
  const nImg = db_listFiles(UPLOADS_DIR).length;
  ok(`uploads: ${UPLOADS_DIR}  (${nImg} image${nImg === 1 ? "" : "s"})`);
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
        `db — export / restore the SQLite database (includes users) + image uploads\n\n` +
          `  tsx scripts/db.ts export  [--out <file>] [--db-only]\n` +
          `  tsx scripts/db.ts restore --in <file> [--yes]\n` +
          `  tsx scripts/db.ts info\n\n` +
          `DB path : ${DB_PATH} (override with PM_DB_PATH)\n` +
          `Uploads : ${UPLOADS_DIR}\n`
      );
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((e) => die(String(e?.message ?? e)));
