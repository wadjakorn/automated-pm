// Authentication primitives: password hashing (scrypt, no external dep) and
// request → user resolution. Auth is OPTIONAL/ADDITIVE — currentUser() returns
// null for anonymous callers and every caller must tolerate that.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { nanoid } from "nanoid";
import { getDb } from "./db";
import type { User } from "./types";

// ---- password hashing ----
// Stored format: scrypt$<saltHex>$<hashHex>. scrypt is memory-hard and ships
// with Node, so no bcrypt/argon native dependency.
const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  if (salt.length === 0 || expected.length !== SCRYPT_KEYLEN) return false;
  const actual = scryptSync(password, salt, SCRYPT_KEYLEN);
  return timingSafeEqual(actual, expected);
}

export function newApiToken(): string {
  return nanoid(32);
}

// ---- sessions ----
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SESSION_COOKIE = "pm_session";

export function createSession(userId: string): { id: string; expires_at: string } {
  const id = nanoid(24);
  const created = new Date();
  const expires = new Date(created.getTime() + SESSION_TTL_MS);
  getDb()
    .prepare(
      "INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?,?,?,?)"
    )
    .run(id, userId, created.toISOString(), expires.toISOString());
  return { id, expires_at: expires.toISOString() };
}

export function destroySession(id: string): void {
  getDb().prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

export const sessionMaxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000);

// ---- request → user ----
// Resolve the caller: a live session cookie OR an `Authorization: Bearer
// <api_token>` header. Returns null when neither is present/valid.
export function currentUser(req: Request): User | null {
  const db = getDb();

  // Bearer token (CLI / agents).
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    if (token) {
      const u = db
        .prepare("SELECT * FROM users WHERE api_token = ?")
        .get(token) as User | undefined;
      if (u) return u;
    }
  }

  // Session cookie (browser).
  const sid = readCookie(req, SESSION_COOKIE);
  if (sid) {
    const row = db
      .prepare(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id = ? AND s.expires_at > ?`
      )
      .get(sid, new Date().toISOString()) as User | undefined;
    if (row) return row;
  }

  return null;
}

export function sessionIdFromRequest(req: Request): string | null {
  return readCookie(req, SESSION_COOKIE);
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}
