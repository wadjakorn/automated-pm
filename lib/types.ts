// Shared domain types. Used by API routes, repo, CLI, and UI.
import type { Priority } from "./priority";

export interface Project {
  id: string;
  name: string;
  description: string | null;
  // Git/remote URL the project tracks (agents read it to know which repo to
  // operate on). Nullable; edited only via the guarded updateProject path.
  remote_repo_url: string | null;
  // Status key new tasks land in when none is given. Null → first status.
  // A stale key (status since removed) also falls back to the first status.
  default_status_key: string | null;
  // Per-project theme (web UI): the theme pack + accent applied when this
  // project is selected. Null → default pack/accent. Light/dark MODE is a
  // separate per-browser preference and is not stored on the project.
  theme_pack: string | null;
  theme_accent: string | null;
  // Prefix for human-readable ticket ids (PREFIX-NNNN). New projects get a
  // random 2-char default; null on pre-migration projects until set in
  // Settings. 2–100 chars, no whitespace when set.
  ticket_prefix: string | null;
  // Sidebar ordering: a per-project integer the user controls (up/down in the
  // sidebar). Backfilled by created_at on migration; new projects get MAX+1.
  sort_order: number;
  // Hide this project from the WEB sidebar only (view preference, mirrors
  // Status.hidden). Hidden projects stay live, listed by the API, and reachable
  // by direct URL — the sidebar just filters them behind a "Show hidden" toggle.
  hidden: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  // Filed off the sidebar but still live (openable by id), mirroring
  // Task.archived_at. Independent of deleted_at (Trash). Null = not archived.
  archived_at: string | null;
}

export interface Status {
  id: string;
  project_id: string;
  key: string;
  label: string;
  sort_order: number;
  is_final: boolean;
  // Hide this column from the WEB board only (project-level view preference).
  // Tasks in a hidden status stay live, listed, and movable.
  hidden: boolean;
}

export interface Transition {
  id: string;
  project_id: string;
  from_key: string;
  to_key: string;
}

export interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status_key: string;
  priority: Priority;
  rank: number;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  // Archived = filed away off the board, but still live (direct link + search
  // find it). Independent of deleted_at (Trash). Null = not archived.
  archived_at: string | null;
  // Per-project incrementing counter (stored). Null for pre-migration tickets.
  ticket_number: number | null;
  // Derived (NOT stored): PREFIX-NNNN for display, computed from the project's
  // ticket_prefix + ticket_number at read time. Null when either is missing,
  // in which case the UI falls back to the nanoid `id`.
  ticket_key: string | null;
  // Attribution (nullable, backward compat). *_username are joined for display
  // and are not stored columns.
  creator_id: string | null;
  assignee_id: string | null;
  creator_username: string | null;
  assignee_username: string | null;
}

// A ready-to-work ticket as served by GET /api/cc-bridge/ready: the minimal
// fields the poll routine needs, with the project's repo URL joined in.
export interface ReadyTicket {
  ticket: string;        // task id
  project: string;       // project id
  projectName: string;
  repo: string;          // projects.remote_repo_url (non-null by query filter)
  title: string;
  priority: Priority;
  description: string | null;
}

// A user account. password_hash and api_token are secrets — never serialize
// them to clients. PublicUser is the safe shape returned by the API.
export interface User {
  id: string;
  username: string;
  password_hash: string;
  api_token: string;
  created_at: string;
  updated_at: string;
}

export interface PublicUser {
  id: string;
  username: string;
  created_at: string;
}

// A project's full state machine: ordered statuses + allowed transition edges.
export interface StateMachine {
  statuses: Status[];
  transitions: Transition[];
}

export interface TransitionCheck {
  ok: boolean;
  reason?: string;
}

// Stored verb for a ticket link. One directed row per link; the inverse label
// (e.g. "blocked by") is derived at read time. `relates` is symmetric.
export type LinkVerb = "blocks" | "causes" | "relates";

// A link as seen from a given viewer ticket: the verb, whether the viewer is
// the edge's source (drives the displayed label), and the other ticket's
// display fields. `task.deleted_at` non-null = the other ticket was trashed.
export interface LinkedTicket {
  link_id: string;
  verb: LinkVerb;
  is_source: boolean;
  label: string;
  task: {
    id: string;
    title: string;
    status_key: string;
    project_id: string;
    deleted_at: string | null;
  };
}
