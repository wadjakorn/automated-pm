// Server-side image-upload storage. Bytes live on disk under data/uploads/ so
// pm.db stays small and the existing ./data Docker volume persists them across
// restarts. The `uploads` table (lib/db.ts) holds the metadata and is the
// source of truth for backups (scripts/db.ts bundles this dir).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { getDb } from "./db";

// Resolve the uploads dir relative to the same data root as the DB. When
// PM_DB_PATH is set (Docker), keep uploads beside it under <dataRoot>/uploads.
function dataRoot(): string {
  const dbPath = process.env.PM_DB_PATH;
  if (dbPath) return join(dbPath, "..", "uploads");
  return join(process.cwd(), "data", "uploads");
}

export const UPLOADS_DIR = dataRoot();

// Whitelist of accepted image types -> file extension. Anything else is
// rejected at the API layer; keeping the map here makes mime/ext the single
// authority used by both write (POST) and read (GET).
export const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB hard ceiling

export function extForMime(mime: string): string | null {
  return MIME_EXT[mime] ?? null;
}

export interface UploadRow {
  id: string;
  ext: string;
  mime: string;
  size: number;
  orig_name: string | null;
  created_at: string;
  creator_id: string | null;
}

function ensureDir() {
  mkdirSync(UPLOADS_DIR, { recursive: true });
}

function filePath(id: string, ext: string): string {
  return join(UPLOADS_DIR, `${id}.${ext}`);
}

// Persist bytes + metadata. Caller has already validated mime/size.
export function saveUpload(
  bytes: Buffer,
  mime: string,
  origName: string | null,
  creatorId: string | null
): UploadRow {
  const ext = extForMime(mime);
  if (!ext) throw new Error(`unsupported mime: ${mime}`);
  ensureDir();
  const id = nanoid(16);
  const created_at = new Date().toISOString();
  writeFileSync(filePath(id, ext), bytes);
  getDb()
    .prepare(
      "INSERT INTO uploads (id, ext, mime, size, orig_name, created_at, creator_id) VALUES (?,?,?,?,?,?,?)"
    )
    .run(id, ext, mime, bytes.length, origName, created_at, creatorId);
  return {
    id,
    ext,
    mime,
    size: bytes.length,
    orig_name: origName,
    created_at,
    creator_id: creatorId,
  };
}

export function getUpload(id: string): UploadRow | null {
  const row = getDb()
    .prepare("SELECT * FROM uploads WHERE id = ?")
    .get(id) as UploadRow | undefined;
  return row ?? null;
}

export function readUploadBytes(row: UploadRow): Buffer {
  return readFileSync(filePath(row.id, row.ext));
}
